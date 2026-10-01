import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  emptyPageTweaks,
  normalizePageTweaks,
  getPageTweak,
  withPageTweak,
  resolveV9PageConstraint,
  updatePageTweakMeasurements,
  approvePageTweakWithMeasurements,
} from "../../src/page_tweaks.js";

test("legacy flat page_tweaks.json shape migrates into document state", () => {
  const state = normalizePageTweaks({
    "3": { lines_diff: 2 },
    "7": { lines_diff: -4, notes: "בדוק שוב" },
    junk: { lines_diff: 9 },
  });
  assert.equal(state.version, 1);
  assert.equal(state.pages["3"].linesDiff, 2);
  assert.equal(state.pages["7"].linesDiff, -4);
  assert.equal(state.pages["7"].notes, "בדוק שוב");
  assert.equal(state.pages.junk, undefined);
});

test("editing an approved page marks it changed", () => {
  let state = emptyPageTweaks();
  state = withPageTweak(state, 2, { status: "approved" });
  assert.equal(getPageTweak(state, 2).status, "approved");
  state = withPageTweak(state, 2, { linesDiff: -1 });
  assert.equal(getPageTweak(state, 2).status, "changed");
});

test("negative lines reserve real planner height while positive lines never enlarge physical page", () => {
  const base = 18;
  const common = { baseReservedBottom: base, pageHeight: 500, padding: 20, lineHeight: 16 };

  const pushed = resolveV9PageConstraint({ pages: { "1": { linesDiff: -3 } } }, 0, common);
  assert.equal(pushed.pushLines, 3);
  assert.equal(pushed.pullLines, 0);
  assert.equal(pushed.reservedBottom, base + 48);

  const pulled = resolveV9PageConstraint({ pages: { "1": { linesDiff: 3 } } }, 0, common);
  assert.equal(pulled.pushLines, 0);
  assert.equal(pulled.pullLines, 3);
  assert.equal(pulled.reservedBottom, base);
});

test("page constraints are page-specific and clamp unsafe values", () => {
  const state = normalizePageTweaks({
    pages: {
      "1": { linesDiff: -999 },
      "2": { linesDiff: 999, footnoteShift: { "01": 999, "02": -2 } },
    },
  });
  assert.equal(getPageTweak(state, 1).linesDiff, -30);
  assert.equal(getPageTweak(state, 2).linesDiff, 30);
  assert.deepEqual(getPageTweak(state, 2).footnoteShift, { "01": 30 });

  const second = resolveV9PageConstraint(state, 1, {
    baseReservedBottom: 0,
    pageHeight: 100,
    padding: 10,
    lineHeight: 20,
  });
  assert.equal(second.pullLines, 30);
  assert.equal(second.reservedBottom, 0);
});


test("page tweaks are wired through document persistence into V9, not global settings", async () => {
  const [pane, bridge, apply, v9] = await Promise.all([
    readFile(new URL("../../src/pane_manager.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/engine_bridge.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/vilna_v9_apply.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/vilna_v9.js", import.meta.url), "utf8"),
  ]);

  assert.match(pane, /serialize\(\)[\s\S]*?pageTweaks:\s*normalizePageTweaks\(this\.pageTweaks\)/);
  assert.match(pane, /serializeForPersistence\(\)[\s\S]*?pageTweaks:\s*normalizePageTweaks\(this\.pageTweaks\)/);
  assert.match(pane, /this\.pageTweaks = normalizePageTweaks\(state\?\.pageTweaks\)/);
  assert.match(bridge, /pageTweaks:[\s\S]*?paneManager\.getPageTweaks\(\)/);
  assert.match(apply, /pageTweaks:\s*normalizePageTweaks\(opts\.pageTweaks\)/);
  assert.match(v9, /resolveV9PageConstraint\(cfg\.pageTweaks, pageIdx/);
  assert.match(v9, /cfg\.reservedBottom = __v9PageConstraint\.reservedBottom/);
});


test("approved page becomes changed only after a meaningful typographic measurement delta", () => {
  let state = emptyPageTweaks();
  state = approvePageTweakWithMeasurements(state, 4, {
    bottomGapLines: 1.2,
    overflowPx: 0,
  });
  assert.equal(getPageTweak(state, 4).status, "approved");

  state = updatePageTweakMeasurements(state, 4, {
    bottomGapLines: 1.55,
    overflowPx: 2,
    linePitchPx: 20,
  });
  assert.equal(getPageTweak(state, 4).status, "approved");

  state = updatePageTweakMeasurements(state, 4, {
    bottomGapLines: 1.9,
    overflowPx: 2,
    linePitchPx: 20,
  });
  assert.equal(getPageTweak(state, 4).status, "changed");
});


test("approved measurement baseline does not creep across repeated sub-threshold samples", () => {
  let state = approvePageTweakWithMeasurements(emptyPageTweaks(), 9, {
    bottomGapLines: 1.0,
    overflowPx: 0,
  });

  for (const gap of [1.2, 1.4]) {
    state = updatePageTweakMeasurements(state, 9, {
      bottomGapLines: gap,
      overflowPx: 1,
      linePitchPx: 20,
    });
    const entry = getPageTweak(state, 9);
    assert.equal(entry.status, "approved");
    assert.equal(entry.spaceLines, 1.0, "approved baseline must stay fixed");
    assert.equal(entry.overflowPx, 0, "approved overflow baseline must stay fixed");
  }

  state = updatePageTweakMeasurements(state, 9, {
    bottomGapLines: 1.6,
    overflowPx: 1,
    linePitchPx: 20,
  });
  assert.equal(getPageTweak(state, 9).status, "changed");
});

test("new substantial overflow marks an approved page changed", () => {
  let state = approvePageTweakWithMeasurements(emptyPageTweaks(), 1, {
    bottomGapLines: 0.8,
    overflowPx: 0,
  });
  state = updatePageTweakMeasurements(state, 1, {
    bottomGapLines: 0.8,
    overflowPx: 12,
    linePitchPx: 20,
  });
  assert.equal(getPageTweak(state, 1).status, "changed");
});

test("layout report page tweaker submits constraints through PaneManager only", async () => {
  const report = await readFile(new URL("../../src/layout_analysis_report.js", import.meta.url), "utf8");
  assert.match(report, /pm\.setPageTweak\(page\.page, \{ linesDiff: nextDiff \}\)/);
  assert.match(report, /pm\.approvePageTweak\(page\.page/);
  assert.match(report, /pm\.resetPageTweak\(page\.page\)/);
  assert.match(report, /pm\.clearPageTweaks\(\)/);
  assert.doesNotMatch(report, /\.style\.(?:top|left|height|transform)\s*=/);
});
