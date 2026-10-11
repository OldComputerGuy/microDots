// MicroDot custom tool "rada_raw" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "rada_raw",
    "description": "Dump raw text preceding a given year tag on RADA profile pages.",
    "parameters": {
      "properties": {
        "pages": {
          "items": {
            "type": "integer"
          },
          "type": "array"
        },
        "year": {
          "type": "string"
        }
      },
      "required": [
        "year"
      ],
      "type": "object"
    }
  }
};
export const code = "const yr = String(args.year);\nconst pages = args.pages || [69];\nconst out = [];\nfor (const p of pages){\n  await ctx.browser.open(`https://www.rada.ac.uk/profiles?a&page=${p}`);\n  const t = await ctx.browser.text();\n  const raw = typeof t === 'string' ? t : (t && t.text ? t.text : JSON.stringify(t));\n  const i = raw.indexOf(yr);\n  out.push({page:p, idx:i, slice: i>=0 ? raw.slice(Math.max(0,i-400), i+200) : raw.slice(0,800)});\n}\nreturn out;";

export async function run(args, ctx) {
const yr = String(args.year);
const pages = args.pages || [69];
const out = [];
for (const p of pages){
  await ctx.browser.open(`https://www.rada.ac.uk/profiles?a&page=${p}`);
  const t = await ctx.browser.text();
  const raw = typeof t === 'string' ? t : (t && t.text ? t.text : JSON.stringify(t));
  const i = raw.indexOf(yr);
  out.push({page:p, idx:i, slice: i>=0 ? raw.slice(Math.max(0,i-400), i+200) : raw.slice(0,800)});
}
return out;
}
