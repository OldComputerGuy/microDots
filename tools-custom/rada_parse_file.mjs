// MicroDot custom tool "rada_parse_file" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "rada_parse_file",
    "description": "Parse a saved RADA profile text file and extract Acting graduates for a year.",
    "parameters": {
      "properties": {
        "path": {
          "type": "string"
        },
        "year": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "year"
      ],
      "type": "object"
    }
  }
};
export const code = "const path = args.path;\nconst year = String(args.year);\nlet text;\nif (ctx.fs && ctx.fs.readFile) text = await ctx.fs.readFile(path, 'utf8');\nelse if (ctx.fs && ctx.fs.read) text = await ctx.fs.read(path);\nelse text = (await import('fs')).readFileSync(path, 'utf8');\nlet raw = text;\ntry { const j = JSON.parse(text); raw = j.text || text; } catch(e){}\nconst parts = raw.split('\\n').map(s=>s.trim());\nconst out = [];\nfor (let i=0;i<parts.length;i++){\n  if (parts[i]==='Graduate' && parts[i+1]==='Acting' && parts[i+2]===year){\n    // name is the nearest non-empty line before 'Graduate'\n    let n=i-1; while(n>=0 && parts[n]==='') n--;\n    out.push({name: parts[n], role:'Graduate', course:'Acting', year});\n  }\n}\nreturn {year, count: out.length, names: out.map(o=>o.name)};";

export async function run(args, ctx) {
const path = args.path;
const year = String(args.year);
let text;
if (ctx.fs && ctx.fs.readFile) text = await ctx.fs.readFile(path, 'utf8');
else if (ctx.fs && ctx.fs.read) text = await ctx.fs.read(path);
else text = (await import('fs')).readFileSync(path, 'utf8');
let raw = text;
try { const j = JSON.parse(text); raw = j.text || text; } catch(e){}
const parts = raw.split('\n').map(s=>s.trim());
const out = [];
for (let i=0;i<parts.length;i++){
  if (parts[i]==='Graduate' && parts[i+1]==='Acting' && parts[i+2]===year){
    // name is the nearest non-empty line before 'Graduate'
    let n=i-1; while(n>=0 && parts[n]==='') n--;
    out.push({name: parts[n], role:'Graduate', course:'Acting', year});
  }
}
return {year, count: out.length, names: out.map(o=>o.name)};
}
