// MicroDot custom tool "save_file" - auto-generated, safe to edit or delete.
// The code below runs only in the isolated Linux sandbox worker.
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
