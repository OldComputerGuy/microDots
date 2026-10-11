// MicroDot custom tool "rada_cohort" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "rada_cohort",
    "description": "Extract RADA graduate names for a year using rendered browser text.",
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
export const code = "const yr = String(args.year);\nconst pages = args.pages || [69];\nconst seen = new Set(); const names = [];\nfor (const p of pages){\n  const url = `https://www.rada.ac.uk/profiles?a&page=${p}`;\n  await ctx.browser.open(url);\n  const t = await ctx.browser.text();\n  const raw = typeof t === 'string' ? t : (t && t.text ? t.text : JSON.stringify(t));\n  // split into records by the pattern Name \\n Role \\n Course \\n Year\n  const re = /([A-Z][A-Za-z'’.\\- ]{1,50}?)\\s+Graduate\\s+Acting\\s+(\\d{4})/g;\n  let m;\n  while((m=re.exec(raw))){\n    if (m[2] === yr){ const n = m[1].trim(); const key=n.slice(-40); if(!seen.has(key)){seen.add(key); names.push(n);} }\n  }\n}\nreturn {year: yr, count: names.length, names};";

export async function run(args, ctx) {
const yr = String(args.year);
const pages = args.pages || [69];
const seen = new Set(); const names = [];
for (const p of pages){
  const url = `https://www.rada.ac.uk/profiles?a&page=${p}`;
  await ctx.browser.open(url);
  const t = await ctx.browser.text();
  const raw = typeof t === 'string' ? t : (t && t.text ? t.text : JSON.stringify(t));
  // split into records by the pattern Name \n Role \n Course \n Year
  const re = /([A-Z][A-Za-z'’.\- ]{1,50}?)\s+Graduate\s+Acting\s+(\d{4})/g;
  let m;
  while((m=re.exec(raw))){
    if (m[2] === yr){ const n = m[1].trim(); const key=n.slice(-40); if(!seen.has(key)){seen.add(key); names.push(n);} }
  }
}
return {year: yr, count: names.length, names};
}
