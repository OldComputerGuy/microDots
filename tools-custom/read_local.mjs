// MicroDot custom tool "read_local" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "read_local",
    "description": "Read a text file from the sandbox and report length + head.",
    "parameters": {
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ],
      "type": "object"
    }
  }
};
export const code = "const path = args.path;\nlet text;\nif (ctx.fs && ctx.fs.readFile) {\n  text = await ctx.fs.readFile(path, 'utf8');\n} else if (ctx.fs && ctx.fs.read) {\n  text = await ctx.fs.read(path);\n} else {\n  const fs = await import('fs');\n  text = fs.readFileSync(path, 'utf8');\n}\nreturn { len: text.length, head: text.slice(0, 300) };";

export async function run(args, ctx) {
const path = args.path;
let text;
if (ctx.fs && ctx.fs.readFile) {
  text = await ctx.fs.readFile(path, 'utf8');
} else if (ctx.fs && ctx.fs.read) {
  text = await ctx.fs.read(path);
} else {
  const fs = await import('fs');
  text = fs.readFileSync(path, 'utf8');
}
return { len: text.length, head: text.slice(0, 300) };
}
