// MiniDot custom tool "probe_fetch" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "probe_fetch",
    "description": "Probe what ctx.fetch returns in this backend.",
    "parameters": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        }
      },
      "required": [
        "url"
      ]
    }
  }
};
export const code = "const r = await ctx.fetch(args.url, { headers: { \"User-Agent\": \"MiniDot/1.0\" } });\nreturn {\n  type: typeof r,\n  keys: r && typeof r === \"object\" ? Object.keys(r) : null,\n  ctor: r && r.constructor ? r.constructor.name : null,\n  hasText: !!(r && typeof r.text === \"function\"),\n  sample: typeof r === \"string\" ? r.slice(0, 200) : JSON.stringify(r).slice(0, 400)\n};";

export async function run(args, ctx) {
const r = await ctx.fetch(args.url, { headers: { "User-Agent": "MiniDot/1.0" } });
return {
  type: typeof r,
  keys: r && typeof r === "object" ? Object.keys(r) : null,
  ctor: r && r.constructor ? r.constructor.name : null,
  hasText: !!(r && typeof r.text === "function"),
  sample: typeof r === "string" ? r.slice(0, 200) : JSON.stringify(r).slice(0, 400)
};
}
