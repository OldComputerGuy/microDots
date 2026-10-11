// MicroDot custom tool "rada_summary" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "rada_summary",
    "description": "Summarise role/course/year triples found in a saved RADA text file.",
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
export const code = "const path = args.path;\nlet text;\nif (ctx.fs && ctx.fs.readFile) text = await ctx.fs.readFile(path, 'utf8');\nelse if (ctx.fs && ctx.fs.read) text = await ctx.fs.read(path);\nelse text = (await import('fs')).readFileSync(path, 'utf8');\nlet raw = text;\ntry { const j = JSON.parse(text); raw = j.text || text; } catch(e){}\nconst parts = raw.split('\\n').map(s=>s.trim());\nconst triples = [];\nfor (let i=0;i<parts.length-2;i++){\n  if ((parts[i]==='Student'||parts[i]==='Graduate') && /^\\d{4}$/.test(parts[i+2])){\n    triples.push(parts[i]+'/'+parts[i+1]+'/'+parts[i+2]);\n  }\n}\nconst years = {}; triples.forEach(t=>{const y=t.split('/')[2]; years[y]=(years[y]||0)+1;});\nreturn {len: raw.length, total: triples.length, years, first: triples.slice(0,5), last: triples.slice(-5)};";

export async function run(args, ctx) {
const path = args.path;
let text;
if (ctx.fs && ctx.fs.readFile) text = await ctx.fs.readFile(path, 'utf8');
else if (ctx.fs && ctx.fs.read) text = await ctx.fs.read(path);
else text = (await import('fs')).readFileSync(path, 'utf8');
let raw = text;
try { const j = JSON.parse(text); raw = j.text || text; } catch(e){}
const parts = raw.split('\n').map(s=>s.trim());
const triples = [];
for (let i=0;i<parts.length-2;i++){
  if ((parts[i]==='Student'||parts[i]==='Graduate') && /^\d{4}$/.test(parts[i+2])){
    triples.push(parts[i]+'/'+parts[i+1]+'/'+parts[i+2]);
  }
}
const years = {}; triples.forEach(t=>{const y=t.split('/')[2]; years[y]=(years[y]||0)+1;});
return {len: raw.length, total: triples.length, years, first: triples.slice(0,5), last: triples.slice(-5)};
}
