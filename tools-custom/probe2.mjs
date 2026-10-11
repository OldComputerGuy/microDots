// MicroDot custom tool "probe2" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "probe2",
    "description": "Debug: inspect raw fetch return shape for a URL.",
    "parameters": {
      "properties": {
        "url": {
          "type": "string"
        }
      },
      "required": [
        "url"
      ],
      "type": "object"
    }
  }
};
export const code = "const r = await ctx.fetch(args.url);\nreturn {typeof: typeof r, keys: r && typeof r==='object'?Object.keys(r):null, json: JSON.stringify(r).slice(0,3000)};";

export async function run(args, ctx) {
const r = await ctx.fetch(args.url);
return {typeof: typeof r, keys: r && typeof r==='object'?Object.keys(r):null, json: JSON.stringify(r).slice(0,3000)};
}
