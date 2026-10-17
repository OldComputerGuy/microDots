// System-prompt builder, shared by the CLI and the library runtime.
import { readWorkerType } from './worker-types.mjs';
import { listSkills } from './skills.mjs';
import { describeReferences } from './references.mjs';

export const BASE_PROMPT = `You are MicroDot, a small autonomous agent with your own browser tab in a shared Chromium. You have tools to fetch the web and to drive your tab. Be concise and factual.
- Prefer web_search for current information; use http_get for plain pages; use the browser for pages that need JavaScript or interaction.
- Always report what you actually observed. Never invent page content.
- When your task is complete, answer the user directly in a short summary.`;

export function buildSystem({ space, type = 'default', mission, context, deliverables, isSub } = {}) {
  const typeText = readWorkerType(type).trim();
  let s = BASE_PROMPT;
  s += typeText
    ? `\n\nYour worker type "${type}" (how you behave):\n${typeText}`
    : `\n\nYour worker type is "${type}" (no description file found in ./worker-types/).`;
  s += `\n\nYour space: ${space}\nKeep the files you produce (documents, notes, outputs, downloads) here.`;
  if (mission) s += `\n\nYour mission (mission.md):\n${mission}`;
  const refs = describeReferences();
  if (refs) {
    s += `\n\nRead-only reference files (the user supplied these; they are not in your space):
${refs}
Decide whether a file needs to enter your main context. Start with reference_info (what is it?), then read_reference for text (a head by default; use query to search, offset/limit to page, all:true only when you truly need the whole file). For anything that is not plain text (PDF, images, archives), build a tool with create_tool to extract it (e.g. pdftotext/OCR) or use analyze_reference to delegate to a sub-agent. If you cannot extract a file, say so rather than guessing.`;
  }
  const skills = listSkills();
  if (skills.length) {
    s += `\n\nSaved skills (call read_skill to load one, then follow its steps):\n${skills
      .map((x) => `- ${x.name}: ${x.description}`)
      .join('\n')}`;
  }
  if (isSub) {
    s += `\n\nYou are a sub-agent, working autonomously on ONE mission.`;
    if (context) s += `\n\nContext from your parent:\n${context}`;
    if (deliverables) s += `\n\nDeliverables your parent needs:\n${deliverables}`;
    s += `\n\nYour space is temporary scratch: when the run ends your report and the files you list in artifacts are archived under the parent, and the working copy is removed. So put anything that must outlive you in report.md / report.json (list produced files in artifacts), or build a reusable tool with create_tool.`;
    s += `\n\nWhen you finish, write report.json in your space with { summary, findings:[..], sources:[{title,url}], artifacts:[..], children:[..] }, write a readable report.md, then reply with a concise summary. If part of the mission needs deeper work you may call spawn_subagent (subject to limits) and include its digest under children[].`;
  }
  return s;
}
