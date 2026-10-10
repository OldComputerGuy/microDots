// MiniDot custom tool "root_path" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "root_path",
    "description": "Return the sandbox root and absolute path of a file.",
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
export const code = "const root = ctx.fs.root;\nlet joined = null;\nif (root) joined = root.replace(/[\\\\\\/]+$/,'') + '/' + args.path;\nreturn { root, absolutePath: joined, cwd: ctx.cwd || null, agentId: ctx.agentId || null };\n";

export async function run(args, ctx) {
const root = ctx.fs.root;
let joined = null;
if (root) joined = root.replace(/[\\\/]+$/,'') + '/' + args.path;
return { root, absolutePath: joined, cwd: ctx.cwd || null, agentId: ctx.agentId || null };

}
