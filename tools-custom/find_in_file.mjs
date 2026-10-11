// MicroDot custom tool "find_in_file" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "find_in_file",
    "description": "Find a term in a saved local text file and show surrounding text.",
    "parameters": {
      "properties": {
        "path": {
          "type": "string"
        },
        "term": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "term"
      ],
      "type": "object"
    }
  }
};
export const code = "const path = args.path;\nlet text;\nif (ctx.fs && ctx.fs.readFile) text = await ctx.fs.readFile(path, 'utf8');\nelse if (ctx.fs && ctx.fs.read) text = await ctx.fs.read(path);\nelse text = (await import('fs')).readFileSync(path, 'utf8');\nlet raw = text;\ntry { const j = JSON.parse(text); raw = j.text || text; } catch(e){}\nconst needle = args.term;\nconst idx = raw.indexOf(needle);\nreturn {len: raw.length, idx, slice: idx>=0 ? raw.slice(Math.max(0,idx-500), idx+300) : raw.slice(0,1200)};";

export async function run(args, ctx) {
const path = args.path;
let text;
if (ctx.fs && ctx.fs.readFile) text = await ctx.fs.readFile(path, 'utf8');
else if (ctx.fs && ctx.fs.read) text = await ctx.fs.read(path);
else text = (await import('fs')).readFileSync(path, 'utf8');
let raw = text;
try { const j = JSON.parse(text); raw = j.text || text; } catch(e){}
const needle = args.term;
const idx = raw.indexOf(needle);
return {len: raw.length, idx, slice: idx>=0 ? raw.slice(Math.max(0,idx-500), idx+300) : raw.slice(0,1200)};
}
