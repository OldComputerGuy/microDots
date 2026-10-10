// MiniDot custom tool "probe_fs" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "probe_fs",
    "description": "Probe writable paths in the sandbox filesystem.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
};
export const code = "const out = { cwd: (ctx.fs && ctx.fs.cwd) || null, tries: [] };\nconst paths = [\"/tmp/dot_test.md\", \"test_rel.md\", \"./test_rel.md\", \"spaces/main/x.md\", \"/root/test.md\", \"/home/test.md\"];\nfor (const p of paths) {\n  try { await ctx.fs.writeFile(p, \"hi\"); out.tries.push({ p, ok: true }); }\n  catch (e) { out.tries.push({ p, err: String(e && e.message || e) }); }\n}\ntry { out.ls = await ctx.fs.readdir(\".\"); } catch (e) { out.lsErr = String(e && e.message || e); }\nreturn out;";

export async function run(args, ctx) {
const out = { cwd: (ctx.fs && ctx.fs.cwd) || null, tries: [] };
const paths = ["/tmp/dot_test.md", "test_rel.md", "./test_rel.md", "spaces/main/x.md", "/root/test.md", "/home/test.md"];
for (const p of paths) {
  try { await ctx.fs.writeFile(p, "hi"); out.tries.push({ p, ok: true }); }
  catch (e) { out.tries.push({ p, err: String(e && e.message || e) }); }
}
try { out.ls = await ctx.fs.readdir("."); } catch (e) { out.lsErr = String(e && e.message || e); }
return out;
}
