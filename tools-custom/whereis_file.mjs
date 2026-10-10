// MiniDot custom tool "whereis_file" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "whereis_file",
    "description": "Report absolute sandbox path and existence of a file.",
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
export const code = "let cwd = null;\ntry { cwd = ctx.fs.cwd ? (typeof ctx.fs.cwd === 'function' ? ctx.fs.cwd() : ctx.fs.cwd) : null; } catch (e) {}\nlet root = null;\ntry { root = ctx.fs.root || ctx.fs.baseDir || null; } catch (e) {}\nconst exists = await ctx.fs.exists ? await ctx.fs.exists(args.path).catch(()=>null) : null;\nconst st = await ctx.fs.stat(args.path).catch(() => null);\nconst names = await ctx.fs.readdir('.').catch(() => null);\nreturn { requestedPath: args.path, sandboxCwd: cwd, sandboxRoot: root, exists, stat: st, cwdListing: names };\n";

export async function run(args, ctx) {
let cwd = null;
try { cwd = ctx.fs.cwd ? (typeof ctx.fs.cwd === 'function' ? ctx.fs.cwd() : ctx.fs.cwd) : null; } catch (e) {}
let root = null;
try { root = ctx.fs.root || ctx.fs.baseDir || null; } catch (e) {}
const exists = await ctx.fs.exists ? await ctx.fs.exists(args.path).catch(()=>null) : null;
const st = await ctx.fs.stat(args.path).catch(() => null);
const names = await ctx.fs.readdir('.').catch(() => null);
return { requestedPath: args.path, sandboxCwd: cwd, sandboxRoot: root, exists, stat: st, cwdListing: names };

}
