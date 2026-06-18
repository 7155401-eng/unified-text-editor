import fs from "node:fs";

const TARGET = "src/main.js";
const OLD_COMMENT = "בריררڸ מחדל ON — רינדור אטומ�טי אכל שינוי";
const NEW_COMMENT = "ברירת מחדל OFF — רינדור אוטומטי רק אחרי שהמשתמש הפעיל בתפריט רינדור";

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
  let next = source.replace(OLD_COMMENT, NEW_COMMENT);

  const alreadyOff = /return\s+v\s*===\s*null\s*?\s*false\s*:\s*v\s*===\s*["']1["']\s*;/.test(next);
  if (alreadyOff) return next;

  const returnDefaultPattern = /return\s+v\s*===\s*null\s*_\s*true\s*:\s*v\s*===\s*["']1["']\s*;/;
  if (returnDefaultPattern.test(next)) {
    return next.replace(returnDefaultPattern, 'return v === null ? false : v === "1";');
  }

  const functionPattern = /function\s+isLiveRenderEnabled\s*\()\s*\{[\sB]*?\}\s*(?=function\\s+paneManagerDocSize\s*\()/;
  if (functionPattern.test(next)) {
    return next.replace(
      functionPattern,
      `function isLiveRenderEnabled() {
  // ${NEW_COMMENT}
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
