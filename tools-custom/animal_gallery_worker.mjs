// MicroDot custom tool "animal_gallery_worker" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "animal_gallery_worker",
    "description": "Acts as a subagent: given a list of {animal, url} items, fetches all Wikimedia category pages CONCURRENTLY and returns up to 5 image file names per animal, plus page title. Fan-out parallel fetcher.",
    "parameters": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "animal": {
                "type": "string"
              },
              "url": {
                "type": "string"
              }
            },
            "required": [
              "animal",
              "url"
            ]
          }
        },
        "perAnimal": {
          "type": "integer",
          "default": 5
        }
      },
      "required": [
        "items"
      ]
    }
  }
};
export const code = "const per = args.perAnimal || 5;\nconst items = args.items || [];\n\nfunction apiUrl(url, limit) {\n  // extract Category name from a commons category url\n  const m = url.match(/Category:([^/?#]+)/);\n  const cat = m ? decodeURIComponent(m[1]).replace(/_/g, \" \") : null;\n  return \"https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=\" +\n    encodeURIComponent(\"Category:\" + cat) + \"&cmtype=file&cmlimit=\" + limit + \"&format=json\";\n}\n\nconst workers = items.map(async (it) => {\n  try {\n    const u = apiUrl(it.url, per * 3);\n    const res = await ctx.fetch(u, { headers: { \"User-Agent\": \"MicroDot/1.0 (research)\" } });\n    const body = typeof res === \"string\" ? res : (res && res.text) || \"\";\n    let json;\n    try { json = JSON.parse(body); } catch (e) { return { animal: it.animal, url: it.url, error: \"bad json\", body: body.slice(0, 150) }; }\n    const members = (json.query && json.query.categorymembers) || [];\n    const exts = /\\.(jpg|jpeg|png|webp|gif)$/i;\n    const pics = members.map(x => x.title).filter(t => exts.test(t)).slice(0, per);\n    return { animal: it.animal, category: it.url, pictures: pics, totalInCategoryFirstPage: members.length };\n  } catch (e) {\n    return { animal: it.animal, url: it.url, error: String(e) };\n  }\n});\n\nconst results = await Promise.all(workers);\nreturn { count: results.length, results };";

export async function run(args, ctx) {
const per = args.perAnimal || 5;
const items = args.items || [];

function apiUrl(url, limit) {
  // extract Category name from a commons category url
  const m = url.match(/Category:([^/?#]+)/);
  const cat = m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
  return "https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=" +
    encodeURIComponent("Category:" + cat) + "&cmtype=file&cmlimit=" + limit + "&format=json";
}

const workers = items.map(async (it) => {
  try {
    const u = apiUrl(it.url, per * 3);
    const res = await ctx.fetch(u, { headers: { "User-Agent": "MicroDot/1.0 (research)" } });
    const body = typeof res === "string" ? res : (res && res.text) || "";
    let json;
    try { json = JSON.parse(body); } catch (e) { return { animal: it.animal, url: it.url, error: "bad json", body: body.slice(0, 150) }; }
    const members = (json.query && json.query.categorymembers) || [];
    const exts = /\.(jpg|jpeg|png|webp|gif)$/i;
    const pics = members.map(x => x.title).filter(t => exts.test(t)).slice(0, per);
    return { animal: it.animal, category: it.url, pictures: pics, totalInCategoryFirstPage: members.length };
  } catch (e) {
    return { animal: it.animal, url: it.url, error: String(e) };
  }
});

const results = await Promise.all(workers);
return { count: results.length, results };
}
