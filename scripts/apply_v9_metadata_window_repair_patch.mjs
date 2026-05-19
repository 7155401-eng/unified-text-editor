import fs from "node:fs";

const TARGET = "src/engine/v9_opening_words_from_metadata.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-window-repair] patched ${path}`);
  } else {
    console.log(`[v9-window-repair] no changes needed for ${path}`);
  }
}

function replaceOnce(source, search, replacement, label, marker) {
  if (marker && source.includes(marker)) return source;
  if (!source.includes(search)) {
    throw new Error(`[v9-window-repair] anchor not found: ${label}`);
  }
  return source.replace(search, replacement);
}

const WINDOW_REPAIR_HELPERS = `
function clearV9OpeningWindowStretch(line) {
  if (!line?.style) return;
  line.classList?.remove("v9-continuation-manual-stretch", "justify");
  line.style.wordSpacing = "";
  line.style.letterSpacing = "";
  line.style.transform = "";
  line.style.transformOrigin = "";
  line.dataset.v9OpeningWindowStretchCleared = "1";
}

function isOpeningWindowGeometryFollower(host, line, hostTop, lineTop, windowBottom) {
  if (!host || !line) return false;
  if (!isMainLine(line)) return false;
  if (pageSortIndex(line) !== pageSortIndex(host)) return false;

  const top = Number(lineTop);
  const startTop = Number(hostTop);
  const bottom = Number(windowBottom);
  if (!Number.isFinite(top) || !Number.isFinite(startTop) || !Number.isFinite(bottom)) return false;
  if (top <= startTop + 0.5 || top >= bottom) return false;

  const hostLeft = stylePx(host, "left");
  const lineLeft = stylePx(line, "left");
  const hostWidth = stylePx(host, "width");
  const lineWidth = stylePx(line, "width");
  if (hostWidth <= 0 || lineWidth <= 0) return true;

  const hostRight = hostLeft + hostWidth;
  const lineRight = lineLeft + lineWidth;
  return Math.abs(hostLeft - lineLeft) < 4 ||
    Math.abs(hostRight - lineRight) < 4 ||
    lineWidth >= hostWidth - 0.5;
}

`;

function patchMetadataWindowRepair(source) {
  source = source.replace(/\r\n/g, "\n");

  if (!source.includes("function clearV9OpeningWindowStretch")) {
    source = replaceOnce(
      source,
      "function applyDroppedOpeningWindowIndents(container) {",
      WINDOW_REPAIR_HELPERS + "function applyDroppedOpeningWindowIndents(container) {",
      "insert V9 opening-window repair helpers"
    );
  }

  source = replaceOnce(
    source,
    `  const settings = getOpeningWordSettings();
  if (!settings?.enabled) return { applied: 0, reason: "disabled" };

  const blocked = blockContinuationOpeningWords(container);`,
    `  const settings = getOpeningWordSettings();
  const settingsEnabled = !!settings?.enabled;

  const blocked = blockContinuationOpeningWords(container);`,
    "keep measured-window repair active even when late settings are disabled",
    "const settingsEnabled = !!settings?.enabled;"
  );

  source = replaceOnce(
    source,
    `  const allowLateMetadataOpeningWords = settings?.allowLateMetadataOpeningWords === true;`,
    `  const allowLateMetadataOpeningWords = settingsEnabled && settings?.allowLateMetadataOpeningWords === true;`,
    "gate late metadata creation on enabled settings",
    "settingsEnabled && settings?.allowLateMetadataOpeningWords === true"
  );

  source = replaceOnce(
    source,
    `      if (!sameParagraph(host, line)) break;

      const top = stylePx(line, "top");`,
    `      const top = stylePx(line, "top");
      const geometryFollower = isOpeningWindowGeometryFollower(host, line, hostTop, top, windowBottom);
      if (!sameParagraph(host, line) && !geometryFollower) break;`,
    "use geometry fallback for V9 opening-window followers",
    "const geometryFollower = isOpeningWindowGeometryFollower(host, line, hostTop, top, windowBottom);"
  );

  source = replaceOnce(
    source,
    `      line.dataset.v9OpeningWindowReservePx = String(Math.round(reserve));
      line.dataset.v9OpeningWindowHost = host.dataset.v9ParagraphId || host.textContent?.slice(0, 16) || "unknown";
      followers += 1;
      adjusted += 1;`,
    `      line.dataset.v9OpeningWindowReservePx = String(Math.round(reserve));
      line.dataset.v9OpeningWindowHost = host.dataset.v9ParagraphId || host.textContent?.slice(0, 16) || "unknown";
      clearV9OpeningWindowStretch(line);
      followers += 1;
      adjusted += 1;`,
    "clear manual stretch inside repaired opening window",
    "clearV9OpeningWindowStretch(line);"
  );

  return source;
}

const before = readFile(TARGET);
const after = patchMetadataWindowRepair(before);
writeIfChanged(TARGET, before, after);
