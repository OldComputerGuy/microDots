// MicroDot custom tool "sentinel_chk" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "sentinel_chk",
    "description": "sentinel round-trip check",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
};
export const code = "await ctx.fs.writeFile('s.txt', 'ok'); return { backend: ctx.root, list: (await ctx.fs.list('.')).map(function (x) { return x.name; }) };";

export async function run(args, ctx) {
await ctx.fs.writeFile('s.txt', 'ok'); return { backend: ctx.root, list: (await ctx.fs.list('.')).map(function (x) { return x.name; }) };
}
