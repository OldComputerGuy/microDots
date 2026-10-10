// MiniDot custom tool "probe_fs2" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "probe_fs2",
    "description": "Probe the sandbox root and candidate writable paths.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
};
export const code = "const out = { info: {}, tries: [] };\n// discover fs API\ntry { out.info.fsKeys = ctx.fs ? Object.keys(ctx.fs) : null; } catch(e){ out.info.fsKeysErr=String(e); }\ntry { out.info.proto = ctx.fs ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.fs)) : null; } catch(e){}\n// try a range of paths\nconst cands = [\"a.md\",\"main/a.md\",\"sandbox/a.md\",\"workspace/a.md\",\"output/a.md\",\"out/a.md\",\n  \"files/a.md\",\"tmp/a.md\",\"./a.md\",\"../a.md\",\"../../a.md\",\n  \"/mnt/c/Users/Test/Desktop/dots/MiniDot/spaces/main/a.md\",\n  \"/mnt/c/a.md\",\"C:/a.md\",\"C:\\\\a.md\",\n  \"/mnt/c/Users/Test/Desktop/dots/MiniDot/a.md\"];\nfor (const p of cands) {\n  try { await ctx.fs.writeFile(p, \"x\"); out.tries.push({p, ok:true}); }\n  catch(e){ out.tries.push({p, err:String(e&&e.message||e)}); }\n}\nreturn out;";

export async function run(args, ctx) {
const out = { info: {}, tries: [] };
// discover fs API
try { out.info.fsKeys = ctx.fs ? Object.keys(ctx.fs) : null; } catch(e){ out.info.fsKeysErr=String(e); }
try { out.info.proto = ctx.fs ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctx.fs)) : null; } catch(e){}
// try a range of paths
const cands = ["a.md","main/a.md","sandbox/a.md","workspace/a.md","output/a.md","out/a.md",
  "files/a.md","tmp/a.md","./a.md","../a.md","../../a.md",
  "/mnt/c/Users/Test/Desktop/dots/MiniDot/spaces/main/a.md",
  "/mnt/c/a.md","C:/a.md","C:\\a.md",
  "/mnt/c/Users/Test/Desktop/dots/MiniDot/a.md"];
for (const p of cands) {
  try { await ctx.fs.writeFile(p, "x"); out.tries.push({p, ok:true}); }
  catch(e){ out.tries.push({p, err:String(e&&e.message||e)}); }
}
return out;
}
