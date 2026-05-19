import fs from "node:fs";

const TARGET = "src/engine/v9_main_bottom_gap.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-stretch-policy] patched ${path}`);
  } else {
    console.log(`[v9-stretch-policy] no changes needed for ${path}`);
  }
}

function replaceOnce(source, search, replacement, label, marker) {
  if (marker && source.includes(marker)) return source;
  if (!source.includes(search)) {
    throw new Error(`[v9-stretch-policy] anchor not found: ${label}`);
  }
  return source.replace(search, replacement);
}

function patchMainBottomGap(source) {
  source = source.replace(/\r\n/g, "\n");

  source = replaceOnce(
    source,
    `import { applyV9OpeningWordsFromMetadata } from "./v9_opening_words_from_metadata.js";`,
    `import { applyV9OpeningWordsFromMetadata } from "./v9_opening_words_from_metadata.js";
import { normalizeV9StretchPolicy } from "./v9_stretch_policy.js";`,
    "stretch policy import",
    `normalizeV9StretchPolicy`
  );

  source = replaceOnce(
    source,
    `  const openingWords = applyV9OpeningWordsFromMetadata(container);

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-main-bottom-gap]", { desiredGapPx, changedPages: results.length, results, openingWords });
  }`,
    `  const openingWords = applyV9OpeningWordsFromMetadata(container);
  const stretchPolicy = normalizeV9StretchPolicy(container);

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-main-bottom-gap]", { desiredGapPx, changedPages: results.length, results, openingWords, stretchPolicy });
  }`,
    "stretch policy post-window hook",
    `const stretchPolicy = normalizeV9StretchPolicy(container);`
  );

  return source;
}

const before = readFile(TARGET);
const after = patchMainBottomGap(before);
writeIfChanged(TARGET, before, after);
