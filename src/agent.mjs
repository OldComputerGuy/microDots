// MiniDot agent: a single model + tool loop. No framework.

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
}) {
  for (let step = 0; step < maxSteps; step++) {
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
        result = await tools.execute(tc.name, args);
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
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, textLimit),
      });
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
