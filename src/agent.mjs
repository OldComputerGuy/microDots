// MicroDot agent: a single model + tool loop. No framework.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const SUMMARY_PREFIX = '[CONVERSATION SUMMARY]';

export async function chatStep({ messages, tools, model, apiKey, baseUrl, onToken }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Model HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  const toolCalls = [];

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onToken?.(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          toolCalls[i] ??= { id: '', name: '', arguments: '' };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].arguments += tc.function.arguments;
        }
      }
    }
  }
  return { content, toolCalls: toolCalls.filter(Boolean) };
}

// --- context compaction -------------------------------------------------
const messageChars = (m) => {
  let n = 0;
  if (typeof m.content === 'string') n += m.content.length;
  else if (Array.isArray(m.content)) n += JSON.stringify(m.content).length;
  if (m.tool_calls) n += JSON.stringify(m.tool_calls).length;
  return n;
};

function estTokens(messages, charsPerToken) {
  let chars = 0;
  for (const m of messages) chars += messageChars(m);
  return Math.ceil(chars / (charsPerToken || 4));
}

const summaryIndex = (messages) =>
  messages.findIndex(
    (m, i) => i > 0 && m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(SUMMARY_PREFIX),
  );

// First message we keep verbatim — never start on an orphaned tool result.
function splitIndex(messages, keepRecent) {
  let split = Math.max(1, messages.length - keepRecent);
  while (split > 1 && messages[split]?.role === 'tool') split--;
  return split;
}

async function summarizeChunk(chunk, prior, { model, fallbackModel, apiKey, baseUrl }) {
  const transcript = chunk
    .map((m) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      const calls = m.tool_calls?.length ? ` [called: ${m.tool_calls.map((t) => t.function?.name).join(', ')}]` : '';
      return `${m.role.toUpperCase()}: ${c}${calls}`;
    })
    .join('\n');
  const cap = 12000; // chars of transcript fed to the summarizer (keep the tail)
  const body = transcript.length > cap ? transcript.slice(transcript.length - cap) : transcript;
  const sys =
    'You compress an ongoing agent conversation into a concise but COMPLETE summary. Preserve: the current goal, facts learned, decisions, source URLs, file paths, important tool results, and open questions. Be specific and factual; never invent. Output only the summary.';
  const user = (prior ? `Summary so far:\n${prior}\n\n` : '') + `New conversation to fold in:\n${body}`;

  let lastErr;
  for (const candidate of [model, fallbackModel].filter(Boolean)) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: candidate,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`summarize HTTP ${res.status}`);
      const j = await res.json();
      const text = (j.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return prior || '';
}

async function compactMessages(messages, compact, cfg) {
  const sIdx = summaryIndex(messages);
  const prior = sIdx >= 0 ? messages[sIdx].content.slice(SUMMARY_PREFIX.length).trim() : '';
  const split = splitIndex(messages, compact.keepRecent);
  if (split <= 1) return false;
  const chunk = messages.slice(1, split);
  if (!chunk.length) return false;
  const summary = await summarizeChunk(chunk, prior, {
    model: compact.summaryModel || cfg.model,
    fallbackModel: compact.fallbackModel || cfg.model,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
  });
  if (!summary) return false;
  messages.splice(1, split - 1, { role: 'system', content: `${SUMMARY_PREFIX}\n${summary}` });
  return true;
}

function offloadToolResult(spaceDir, name, content) {
  const dir = resolve(spaceDir, 'notes');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${name}-${Date.now()}.txt`);
  writeFileSync(file, content);
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

// Runs the assistant↔tool loop until the model stops requesting tools.
export async function runAgent({
  messages,
  tools,
  model,
  apiKey,
  baseUrl,
  textLimit = 32768,
  maxSteps = 12,
  onToken,
  onTool,
  confirm,
  compact = {},
}) {
  const cpt = compact.charsPerToken || 4;
  for (let step = 0; step < maxSteps; step++) {
    // Compact before the next model call if the context is over budget.
    if (compact.enabled && compact.maxTokens && estTokens(messages, cpt) > compact.maxTokens) {
      try {
        if (await compactMessages(messages, compact, { model, apiKey, baseUrl })) {
          compact.onNote?.(`compacted context (~${estTokens(messages, cpt)} tokens now)`);
        }
      } catch (e) {
        compact.onNote?.(`compaction failed: ${e?.message ?? e}`);
      }
    }

    const { content, toolCalls } = await chatStep({
      messages,
      tools: tools.definitions,
      model,
      apiKey,
      baseUrl,
      onToken,
    });

    if (!toolCalls.length) {
      if (content) messages.push({ role: 'assistant', content });
      return content;
    }

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments || '{}' },
      })),
    });

    for (const tc of toolCalls) {
      let args = {};
      try {
        args = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        /* leave as {} */
      }
      onTool?.('call', tc.name, args);
      let result;
      try {
        result = await tools.execute(tc.name, args, { confirm });
      } catch (e) {
        result = { error: String(e?.message ?? e) };
      }
      onTool?.('result', tc.name, result);
      // Screenshots come back with an attached image; keep it out of the JSON
      // text result and attach it as an image the model can actually see.
      let image;
      if (result && typeof result === 'object' && result.__image) {
        image = result.__image;
        const { __image, ...rest } = result;
        result = rest;
      }

      let content = JSON.stringify(result);
      // Big tool outputs: offload the full text to the worker's space and keep
      // only a short head + a pointer in context (nothing is lost).
      const offChars = compact.enabled ? Math.round((compact.offloadTokens ?? 0) * cpt) : 0;
      if (offChars > 0 && compact.spaceDir && content.length > offChars) {
        try {
          const rel = offloadToolResult(compact.spaceDir, tc.name, content);
          const head = content.slice(0, compact.headChars ?? 2000);
          content = `${head}\n…[truncated ${content.length - head.length} chars; full output saved to ${rel}]`;
        } catch {
          content = content.slice(0, textLimit);
        }
      } else {
        content = content.slice(0, textLimit);
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content });
      if (image) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Screenshot of the current page (analyse it):' },
            { type: 'image_url', image_url: { url: image } },
          ],
        });
      }
    }
  }
  return '(stopped: reached the step limit)';
}
