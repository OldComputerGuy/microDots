// MiniDot custom tool "write_md" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "write_md",
    "description": "Write a markdown file to the sandbox using ctx.fs, returning any error.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "content": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "content"
      ]
    }
  }
};
export const code = "try {\n  if (!ctx.fs) return { error: \"no ctx.fs\" };\n  await ctx.fs.writeFile(args.path, args.content);\n  return { ok: true, path: args.path };\n} catch (e) {\n  return { error: String(e && e.message || e) };\n}";

export async function run(args, ctx) {
try {
  if (!ctx.fs) return { error: "no ctx.fs" };
  await ctx.fs.writeFile(args.path, args.content);
  return { ok: true, path: args.path };
} catch (e) {
  return { error: String(e && e.message || e) };
}
}
