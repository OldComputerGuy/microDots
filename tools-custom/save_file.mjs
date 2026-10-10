// MiniDot custom tool "save_file" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "save_file",
    "description": "Write text content to a file inside the sandbox filesystem.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative file path"
        },
        "content": {
          "type": "string",
          "description": "Text content to write"
        }
      },
      "required": [
        "path",
        "content"
      ]
    }
  }
};
export const code = "await ctx.fs.writeFile(args.path, args.content, 'utf8');\nconst st = await ctx.fs.stat(args.path).catch(() => null);\nreturn { ok: true, path: args.path, bytes: st ? st.size : args.content.length };\n";

export async function run(args, ctx) {
await ctx.fs.writeFile(args.path, args.content, 'utf8');
const st = await ctx.fs.stat(args.path).catch(() => null);
return { ok: true, path: args.path, bytes: st ? st.size : args.content.length };

}
