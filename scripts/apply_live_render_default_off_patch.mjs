import fs from "node:fs";

const TARGET = "src/main.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after === before) {
    console.log(`[live-render-default-off] no changes needed for ${path}`);
    return;
  }

  fs.writeFileSync(path, after);
  console.log(`[live-render-default-off] patched ${path}`);
}

function patchLiveRenderDefault(source) {
  const alreadyOff = /return\s+v\s*===\s*null\s*\?\s*false\s*:\s*v\s*===\s*["']1["']\s*;/.test(source);
  if (alreadyOff) return source;

  const returnDefaultPattern = /return\s+v\s*===\s*null\s*\?\s*true\s*:\s*v\s*===\s*["']1["']\s*;/;
  if (returnDefaultPattern.test(source)) {
    return source.replace(returnDefaultPattern, 'return v === null ? false : v === "1";');
  }

  const functionPattern = /function\s+isLiveRenderEnabled\s*\(\)\s*\{[\s\S]*?\}\s*(?=function\s+paneManagerDocSize\s*\()/;
  if (functionPattern.test(source)) {
    return source.replace(
      functionPattern,
      `function isLiveRenderEnabled() {
  // Default OFF: live render runs only after the user enables it in the render menu.
  const v = localStorage.getItem(LIVE_RENDER_KEY);
  return v === null ? false : v === "1";
} `
    );
  }

  console.warn("[live-render-default-off] live render default anchor not found in src/main.js; leaving file unchanged");
  return source;
}

const before = readFile(TARGET);
const after = patchLiveRenderDefault(before);
writeIfChanged(TARGET, before, after);
