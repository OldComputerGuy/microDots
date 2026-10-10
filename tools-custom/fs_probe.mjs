// MiniDot custom tool "fs_probe" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "fs_probe",
    "description": "Probe the ctx.fs API surface and locate a file.",
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
export const code = "const fsKeys = ctx.fs ? Object.keys(ctx.fs) : null;\nconst proto = ctx.fs ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.fs) || {}) : null;\nlet resolved = null, exists = null, stat = null, err = null;\ntry {\n  if (ctx.fs.resolve) resolved = ctx.fs.resolve(args.path);\n  if (ctx.fs.exists) exists = await ctx.fs.exists(args.path);\n  if (ctx.fs.stat) stat = await ctx.fs.stat(args.path);\n  if (ctx.fs.list) resolved = { list: await ctx.fs.list('.') };\n} catch (e) { err = String(e); }\nreturn { fsKeys, proto, resolved, exists, stat, err };\n";

export async function run(args, ctx) {
const fsKeys = ctx.fs ? Object.keys(ctx.fs) : null;
const proto = ctx.fs ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.fs) || {}) : null;
let resolved = null, exists = null, stat = null, err = null;
try {
  if (ctx.fs.resolve) resolved = ctx.fs.resolve(args.path);
  if (ctx.fs.exists) exists = await ctx.fs.exists(args.path);
  if (ctx.fs.stat) stat = await ctx.fs.stat(args.path);
  if (ctx.fs.list) resolved = { list: await ctx.fs.list('.') };
} catch (e) { err = String(e); }
return { fsKeys, proto, resolved, exists, stat, err };

}
