// MicroDot custom tool "dump_around" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "dump_around",
    "description": "Dump HTML slice around a search term.",
    "parameters": {
      "properties": {
        "url": {
          "type": "string"
        },
        "term": {
          "type": "string"
        }
      },
      "required": [
        "url",
        "term"
      ],
      "type": "object"
    }
  }
};
export const code = "const r = await ctx.fetch(args.url);\nconst html = (r && typeof r.text === 'string') ? r.text : String(r);\nconst i = html.indexOf(args.term);\nreturn {len: html.length, index: i, around: i>=0 ? html.slice(Math.max(0,i-1500), i+1500) : html.slice(0,2000)};";

export async function run(args, ctx) {
const r = await ctx.fetch(args.url);
const html = (r && typeof r.text === 'string') ? r.text : String(r);
const i = html.indexOf(args.term);
return {len: html.length, index: i, around: i>=0 ? html.slice(Math.max(0,i-1500), i+1500) : html.slice(0,2000)};
}
