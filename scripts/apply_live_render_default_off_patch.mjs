import fs from "node:fs";

const TARGET = "src/main.js";
const OLD_RETURN = 'const v = localStorage.getItem(LIVE_RENDER_KEY); return v === null ? true : v === "1"; }';
const NEW_RETURN = 'const v = localStorage.getItem(LIVE_RENDER_KEY); return v === null ? false : v === "1"; }';
const OLD_COMMENT = "ברירת מחדל ON — רינדור איטי אוטומטי בכל שינוי";
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

const before = readFile(TARGET);
let after = before;

if (after.includes(NEW_RETURN)) {
  after = after.replace(OLD_COMMENT, NEW_COMMENT);
  writeIfChanged(TARGET, before, after);
  process.exit(0);
}

if (!after.includes(OLD_RETURN)) {
  throw new Error("[live-render-default-off] live render default anchor not found in src/main.js");
}

after = after
  .replace(OLD_RETURN, NEW_RETURN)
  .replace(OLD_COMMENT, NEW_COMMENT);

writeIfChanged(TARGET, before, after);
