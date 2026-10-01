// Shared semantics for editor block types at the editor -> layout boundary.
// Keep this module dependency-free so packers/renderers/tests can share it.

export const MAIN_BLOCK_TYPES = Object.freeze(new Set([
  "paragraph", "heading", "codeBlock", "blockquote", "table",
]));

export function normalizeMainBlockType(value) {
  const type = String(value || "paragraph");
  return MAIN_BLOCK_TYPES.has(type) ? type : "paragraph";
}

export function mainBlockTagForType(blockType, headingLevel = 1) {
  const type = normalizeMainBlockType(blockType);
  if (type === "codeBlock") return "pre";
  if (type === "blockquote") return "blockquote";
  if (type === "table") return "table";
  if (type === "heading") {
    const level = Math.max(1, Math.min(6, parseInt(headingLevel || 1, 10) || 1));
    return `h${level}`;
  }
  return "p";
}

export function v9BlockTypography(blockType, base = {}) {
  const type = normalizeMainBlockType(blockType);
  if (type === "codeBlock") {
    return {
      ...base,
      fontFamily: '"Consolas", "Menlo", "Monaco", monospace',
      fontSize: "13px",
      lineHeight: "19.5px",
      direction: "ltr",
    };
  }
  if (type === "blockquote") {
    return { ...base, fontStyle: "italic" };
  }
  return { ...base };
}
