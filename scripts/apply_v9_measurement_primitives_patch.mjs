import fs from "node:fs";

const TARGET = "src/engine/v9_main_bottom_gap.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-measurement-primitives] patched ${path}`);
  } else {
    console.log(`[v9-measurement-primitives] no changes needed for ${path}`);
  }
}

function patch(source) {
  source = source.replace(/\r\n/g, "\n");

  const missing = [];
  if (!/\bfunction\s+leftOf\s*\(/.test(source)) {
    missing.push(`function leftOf(el) {
  return px(el?.style?.left, el?.offsetLeft || 0);
}`);
  }
  if (!/\bfunction\s+widthOf\s*\(/.test(source)) {
    missing.push(`function widthOf(el) {
  return px(el?.style?.width, el?.getBoundingClientRect?.().width || 0);
}`);
  }
  if (!/\bfunction\s+bottomOf\s*\(/.test(source)) {
    missing.push(`function bottomOf(el) {
  return topOf(el) + heightOf(el);
}`);
  }

  if (!missing.length) return source;

  const anchor = `function setTop(el, top) {`;
  if (!source.includes(anchor)) {
    console.warn("[v9-measurement-primitives] anchor not found; skipped");
    return source;
  }

  return source.replace(anchor, `${missing.join("\n\n")}\n\n${anchor}`);
}

const before = readFile(TARGET);
const after = patch(before);
writeIfChanged(TARGET, before, after);
