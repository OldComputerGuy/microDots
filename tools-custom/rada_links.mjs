// MicroDot custom tool "rada_links" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "rada_links",
    "description": "Extract RADA profile names for a graduation year by parsing profile links.",
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
export const code = "const yr = String(args.year);\nconst pages = args.pages || [68,69,70];\nconst seen = new Set(); const names = [];\nfor (const p of pages){\n  const url = `https://www.rada.ac.uk/profiles?a&page=${p}`;\n  const r = await ctx.fetch(url);\n  const html = (r && typeof r.text === 'string') ? r.text : String(r);\n  // profile cards: link href=\"/profiles/slug/\" then name text, then tags year\n  const re = /\\/profiles\\/([a-z0-9\\-]+)\\/\"[\\s\\S]{0,400}?<\\/a>/g;\n  let m;\n  while((m=re.exec(html))){\n    const slug = m[1];\n    const block = m[0];\n    if (block.includes(yr)) {\n      // name text between > and <\n      const nm = block.match(/>([^<>]{2,60})<\\/a>/);\n      if (nm){ const n = nm[1].trim(); const key=n; if(!seen.has(key)){seen.add(key); names.push(n);} }\n    }\n  }\n}\nreturn {year: yr, count: names.length, names};";

export async function run(args, ctx) {
const yr = String(args.year);
const pages = args.pages || [68,69,70];
const seen = new Set(); const names = [];
for (const p of pages){
  const url = `https://www.rada.ac.uk/profiles?a&page=${p}`;
  const r = await ctx.fetch(url);
  const html = (r && typeof r.text === 'string') ? r.text : String(r);
  // profile cards: link href="/profiles/slug/" then name text, then tags year
  const re = /\/profiles\/([a-z0-9\-]+)\/"[\s\S]{0,400}?<\/a>/g;
  let m;
  while((m=re.exec(html))){
    const slug = m[1];
    const block = m[0];
    if (block.includes(yr)) {
      // name text between > and <
      const nm = block.match(/>([^<>]{2,60})<\/a>/);
      if (nm){ const n = nm[1].trim(); const key=n; if(!seen.has(key)){seen.add(key); names.push(n);} }
    }
  }
}
return {year: yr, count: names.length, names};
}
