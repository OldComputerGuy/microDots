// MiniDot custom tool "tmp_debug_hist" - auto-generated, safe to edit or delete.
// run() is used by the in-process backend; code is shipped to the WSL sandbox.
export const definition = {
  "type": "function",
  "function": {
    "name": "tmp_debug_hist",
    "description": "Debug Yahoo history fetch inside WSL sandbox.",
    "parameters": {
      "type": "object",
      "properties": {
        "sym": {
          "type": "string",
          "default": "AAPL"
        }
      },
      "required": []
    }
  }
};
export const code = "return { note: \"deprecated debug tool — no-op\", sym: args.sym || \"AAPL\" };";

export async function run(args, ctx) {
return { note: "deprecated debug tool — no-op", sym: args.sym || "AAPL" };
}
