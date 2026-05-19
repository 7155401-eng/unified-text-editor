import fs from "node:fs";

const V9_APPLY_PATH = "src/vilna_v9_apply.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-preflight] patched ${path}`);
  } else {
    console.log(`[v9-preflight] no changes needed for ${path}`);
  }
}

function replaceOnce(source, pattern, replacement, label, marker) {
  if (marker && source.includes(marker)) return source;
  const after = source.replace(pattern, replacement);
  if (after === source) throw new Error(`[v9-preflight] anchor not found: ${label}`);
  return after;
}

const PREPARE_HELPER = `
function __ravtextV9NextFrame() {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function __ravtextPrepareV9BeforeRender({ container, paragraphs, isCurrent }) {
  const progress = startVilnaRenderProgress({
    container,
    estimatedTotalPages: Math.max(1, estimateV9PageCount(paragraphs)),
    title: "מתארגן",
    subtitle: "טוען פונטים והגדרות לפני עימוד",
  });

  try {
    if (typeof document !== "undefined" && document.fonts) {
      const fonts = document.fonts;
      const waits = [];

      if (fonts.ready) waits.push(fonts.ready);

      try {
        const geom = readPageGeomFromContainer(container);
        const mainFont = String(geom?.fontFamily || "").trim();
        if (mainFont && typeof fonts.load === "function") {
          waits.push(fonts.load(String(geom.mainSize || 14) + "px " + mainFont, "אבגד"));
        }

        const opening = getOpeningWordSettings();
        const openingFont = String(opening?.font || "").trim();
        if (opening?.enabled && openingFont && typeof fonts.load === "function") {
          waits.push(fonts.load(String(Math.max(12, Number(geom.mainSize || 14) * Number(opening.size || 200) / 100)) + "px " + openingFont, "אבגד"));
        }
      } catch {
        // Non-fatal. fonts.ready is still the main readiness barrier.
      }

      if (waits.length) {
        await Promise.race([
          Promise.allSettled(waits),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      }
    }

    await __ravtextV9NextFrame();
    await __ravtextV9NextFrame();

    if (!isCurrent()) {
      progress.abort();
      return { aborted: true };
    }

    const openingWordSettings = getOpeningWordSettings();

    if (container?.dataset) {
      container.dataset.v9PreflightReady = "1";
      container.dataset.v9PreflightOpeningWord = openingWordSettings?.enabled ? "1" : "0";
    }
    if (typeof window !== "undefined") {
      window.__ravtextLastV9Preflight = {
        openingWordEnabled: !!openingWordSettings?.enabled,
        paragraphCount: Array.isArray(paragraphs) ? paragraphs.length : 0,
        generatedAt: new Date().toISOString(),
      };
    }

    progress.finish({ totalPages: 0 });
    return { openingWordSettings };
  } catch (error) {
    progress.fail(error);
    throw error;
  }
}
`;

function patchV9Apply(source) {
  source = replaceOnce(
    source,
    "\nexport async function applyVilnaV9FromPaneManager(paragraphs, container, opts = {}) {",
    PREPARE_HELPER + "\nexport async function applyVilnaV9FromPaneManager(paragraphs, container, opts = {}) {",
    "insert V9 preflight helper",
    "function __ravtextPrepareV9BeforeRender"
  );

  source = replaceOnce(
    source,
    /if \(typeof document !== "undefined" && document\.fonts && document\.fonts\.ready\) \{[\s\S]*?if \(!isCurrent\(\)\) return \{ aborted: true \};\s*hideVilnaRenderProgressImmediately\(\);\s*const progress = startVilnaRenderProgress\(/,
    `const preflight = await __ravtextPrepareV9BeforeRender({ container, paragraphs, isCurrent });
  if (preflight?.aborted || !isCurrent()) return { aborted: true };
  hideVilnaRenderProgressImmediately();
  const progress = startVilnaRenderProgress(`,
    "replace early font wait with V9 preflight",
    "const preflight = await __ravtextPrepareV9BeforeRender({ container, paragraphs, isCurrent });"
  );

  source = replaceOnce(
    source,
    /openingWordSettings:\s*getOpeningWordSettings\(\),/,
    "openingWordSettings: preflight.openingWordSettings,",
    "use preflight opening-word settings",
    "openingWordSettings: preflight.openingWordSettings,"
  );

  return source;
}

const before = readFile(V9_APPLY_PATH);
const after = patchV9Apply(before);
writeIfChanged(V9_APPLY_PATH, before, after);
