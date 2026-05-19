import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-side-stream-end-y-guard";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-side-stream-end-y-guard] patched ${path}`);
  } else {
    console.log(`[v9-side-stream-end-y-guard] no changes needed for ${path}`);
  }
}

function patchVilnaV9(source) {
  if (source.includes(MARKER)) return source;

  const anchor = "endY: flowResult.endY,";
  const replacement = `// ${MARKER}: footer streams must start after the actual rendered side-stream rows.\n      // flowResult.endY can be stale when split/bridge rows are later normalized,\n      // so reserve space using the bottom of the emitted line objects as well.\n      endY: Math.max(flowResult.endY, ...lines.map(line => line.y + streamLineH)),`;

  if (!source.includes(anchor)) {
    throw new Error(`[v9-side-stream-end-y-guard] anchor not found in ${TARGET}`);
  }

  return source.replace(anchor, replacement);
}

const before = readFile(TARGET);
const after = patchVilnaV9(before);
writeIfChanged(TARGET, before, after);
