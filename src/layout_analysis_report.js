// Final-layout analyzer for RavText pages.
//
// This ports the useful *measurement/report* contract from the desktop
// pdf_report.py/page_tweaker_ui.py, but measures the authoritative final DOM
// instead of re-parsing RavText's rasterized PDF output.
//
// Measurement itself is read-only. The report also exposes explicit Page
// Tweaker controls, but they never move final DOM: they persist a document
// constraint and request a fresh authoritative V9 render.

const PAGE_SELECTOR = ".page:not(.page-placeholder):not(.ravtext-empty-page)";
const V9_LINE_SELECTOR = ".v9-line";
const EPS = 0.75;

function number(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round((Number(value) || 0) * f) / f;
}

function median(values, fallback = 0) {
  const list = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return fallback;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

function percentile(values, p = 0.5, fallback = 0) {
  const list = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return fallback;
  const at = Math.max(0, Math.min(list.length - 1, (list.length - 1) * p));
  const lo = Math.floor(at), hi = Math.ceil(at);
  if (lo === hi) return list[lo];
  return list[lo] + (list[hi] - list[lo]) * (at - lo);
}

function pageVisualScale(page, pageRect = page?.getBoundingClientRect?.()) {
  const visualWidth = number(pageRect?.width, 0);
  const layoutWidth = number(page?.offsetWidth, 0) || number(page?.clientWidth, 0);
  if (visualWidth > 0 && layoutWidth > 0) {
    const scale = visualWidth / layoutWidth;
    if (Number.isFinite(scale) && scale > 0.05 && scale < 20) return scale;
  }
  return 1;
}

function localRect(el, pageRect) {
  const r = el.getBoundingClientRect();
  return {
    left: r.left - pageRect.left,
    right: r.right - pageRect.left,
    top: r.top - pageRect.top,
    bottom: r.bottom - pageRect.top,
    width: r.width,
    height: r.height,
  };
}

function rangeInkRect(el, pageRect) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    range.detach?.();
    if (!(r.width > 0 || r.height > 0)) return null;
    return {
      left: r.left - pageRect.left,
      right: r.right - pageRect.left,
      top: r.top - pageRect.top,
      bottom: r.bottom - pageRect.top,
      width: r.width,
      height: r.height,
    };
  } catch (_) {
    return null;
  }
}

function lineRole(el) {
  return String(el?.dataset?.v9Role || "").trim()
    || [...(el?.classList || [])].find(c => c.startsWith("v9-role-"))?.slice("v9-role-".length)
    || "unknown";
}

function lineBoxId(el) {
  return String(el?.dataset?.v9BoxId || el?.dataset?.v9SourceStream || lineRole(el) || "unknown");
}

function lineColumn(el) {
  return String(el?.dataset?.v9MainColumn || "").trim();
}

function lineSourceId(el) {
  return String(el?.dataset?.v9ParagraphId || el?.dataset?.v9SourceStream || "");
}

function isVisibleLine(el) {
  if (!el?.isConnected) return false;
  const cs = getComputedStyle(el);
  const opacity = String(cs.opacity || "").trim();
  if (cs.display === "none" || cs.visibility === "hidden" || (opacity && Number(opacity) === 0)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function collectV9Lines(page, pageRect) {
  return [...page.querySelectorAll(V9_LINE_SELECTOR)]
    .filter(isVisibleLine)
    .map((el, index) => {
      const rect = localRect(el, pageRect);
      const ink = rangeInkRect(el, pageRect) || rect;
      const allocatedWidth = rect.width || number(el.style.width);
      const naturalWidth = number(el.dataset.v9NaturalWidth, ink.width);
      const lineHeight = rect.height || number(el.style.height, 0);
      return {
        index,
        el,
        role: lineRole(el),
        boxId: lineBoxId(el),
        column: lineColumn(el),
        sourceId: lineSourceId(el),
        rect,
        ink,
        x: rect.left,
        y: rect.top,
        width: allocatedWidth,
        height: lineHeight,
        naturalWidth,
        fillRatio: allocatedWidth > 0 ? Math.min(2, Math.max(0, ink.width / allocatedWidth)) : 0,
        forcedBreak: el.dataset.v9ForcedBreak === "1",
        paragraphLast: el.dataset.v9ParaLast === "1",
        openingApplied: el.dataset.opwApplied === "1" || !!el.querySelector(".v9-opening-glyph"),
        openingWindow: el.dataset.v9OpeningWindowApplied === "1",
        mainColumn: lineColumn(el),
        text: String(el.textContent || "").replace(/[\u061c\u200e\u200f\u2060]/g, "").trim(),
      };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
}

function collectFallbackBlocks(page, pageRect) {
  const selectors = [
    ".page-main p",
    ".page-main > div",
    ".stream .note",
    ".page-streams .stream-title",
    ".talmud-layout .stream",
  ];
  const nodes = [...new Set(selectors.flatMap(sel => [...page.querySelectorAll(sel)]))]
    .filter(isVisibleLine);
  return nodes.map((el, index) => {
    const rect = localRect(el, pageRect);
    const ink = rangeInkRect(el, pageRect) || rect;
    return {
      index,
      el,
      role: el.closest(".stream") ? "stream" : "main",
      boxId: el.closest(".stream")?.dataset?.stream || (el.closest(".stream")?.id || "fallback"),
      column: "",
      sourceId: "",
      rect,
      ink,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      naturalWidth: ink.width,
      fillRatio: rect.width > 0 ? Math.min(2, Math.max(0, ink.width / rect.width)) : 0,
      forcedBreak: false,
      paragraphLast: false,
      openingApplied: !!el.querySelector(".opw-dropped,.v9-opening-glyph"),
      openingWindow: false,
      mainColumn: "",
      text: String(el.textContent || "").trim(),
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
}

function groupBy(lines, keyFn) {
  const map = new Map();
  for (const line of lines) {
    const key = keyFn(line);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(line);
  }
  return map;
}

function expectedPitch(lines) {
  const ordered = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const deltas = [];
  for (let i = 1; i < ordered.length; i++) {
    const dy = ordered[i].y - ordered[i - 1].y;
    if (dy > 1 && dy < Math.max(100, (ordered[i - 1].height || 20) * 3)) deltas.push(dy);
  }
  return median(deltas, median(lines.map(l => l.height).filter(v => v > 0), 0));
}

function analyzeKnees(lines) {
  const out = [];
  const groups = groupBy(lines, l => `${l.role}:${l.boxId}:${l.column || ""}`);
  for (const [key, raw] of groups) {
    const ordered = [...raw].sort((a, b) => a.y - b.y || a.x - b.x);
    const pitch = expectedPitch(ordered);
    if (!(pitch > 0)) continue;

    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1], cur = ordered[i];
      const growth = cur.width - prev.width;
      const threshold = Math.max(12, prev.width * 0.12);
      if (growth <= threshold) continue;
      const dy = cur.y - prev.y;
      const error = dy - pitch;
      out.push({
        key,
        role: cur.role,
        boxId: cur.boxId,
        fromY: round(prev.y),
        toY: round(cur.y),
        narrowWidth: round(prev.width),
        wideWidth: round(cur.width),
        pitch: round(pitch),
        deltaY: round(dy),
        pitchError: round(error),
        ok: Math.abs(error) <= Math.max(0.9, pitch * 0.08),
      });
    }
  }
  return out;
}

function commentaryStreamSummaries(lines) {
  const groups = groupBy(
    (lines || []).filter(line => line.role !== "main" && String(line.boxId || "").trim()),
    line => String(line.boxId)
  );
  return [...groups.entries()]
    .map(([id, ls]) => ({
      id,
      roles: [...new Set(ls.map(line => line.role).filter(Boolean))],
      lines: ls.length,
      medianPitchPx: round(expectedPitch(ls)),
      yTop: round(Math.min(...ls.map(line => line.rect.top))),
      yBottom: round(Math.max(...ls.map(line => line.rect.bottom))),
    }))
    .sort((a, b) => a.yTop - b.yTop || a.id.localeCompare(b.id));
}

function analyzeOverlaps(lines) {
  const ordered = [...lines].sort((a, b) => a.rect.top - b.rect.top);
  const overlaps = [];
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j];
      if (b.rect.top >= a.rect.bottom + EPS) break;
      const xOverlap = Math.min(a.ink.right, b.ink.right) - Math.max(a.ink.left, b.ink.left);
      const yOverlap = Math.min(a.ink.bottom, b.ink.bottom) - Math.max(a.ink.top, b.ink.top);
      if (xOverlap <= 1.5 || yOverlap <= 0.9) continue;

      // A single planned opening line may contain an absolutely-positioned
      // opening glyph inside itself, but both are represented by one .v9-line.
      // Here every record is a different line, so intersection is meaningful.
      overlaps.push({
        a: { role: a.role, boxId: a.boxId, y: round(a.y), text: a.text.slice(0, 80) },
        b: { role: b.role, boxId: b.boxId, y: round(b.y), text: b.text.slice(0, 80) },
        xOverlap: round(xOverlap),
        yOverlap: round(yOverlap),
      });
    }
  }
  return overlaps;
}

function clusterColumns(lines) {
  const candidates = [...lines].filter(l => l.width > 0);
  if (candidates.length < 4) return [];

  // Explicit main-column metadata is authoritative when available.
  const explicit = groupBy(candidates.filter(l => l.mainColumn), l => l.mainColumn);
  if (explicit.size >= 2) {
    return [...explicit.entries()].map(([name, ls]) => ({ name, lines: ls }));
  }

  const centers = candidates.map(l => ({ line: l, c: l.x + l.width / 2 })).sort((a, b) => a.c - b.c);
  let bestGap = 0, bestAt = -1;
  for (let i = 1; i < centers.length; i++) {
    const gap = centers[i].c - centers[i - 1].c;
    if (gap > bestGap) { bestGap = gap; bestAt = i; }
  }
  const totalSpan = centers.at(-1).c - centers[0].c;
  if (bestAt < 2 || centers.length - bestAt < 2 || bestGap < Math.max(18, totalSpan * 0.2)) return [];
  const leftLines = centers.slice(0, bestAt).map(x => x.line);
  const rightLines = centers.slice(bestAt).map(x => x.line);
  const leftWidth = median(leftLines.map(l => l.width).filter(v => v > 0), 0);
  const rightWidth = median(rightLines.map(l => l.width).filter(v => v > 0), 0);

  // A knee (narrow rows that later expand to full width) also produces two
  // x-center clusters. It is NOT a two-column stream. Real columns have broadly
  // comparable allocated widths; reject width-transition clusters here.
  const widthRatio = Math.min(leftWidth, rightWidth) / Math.max(1, Math.max(leftWidth, rightWidth));
  if (widthRatio < 0.72) return [];

  return [
    { name: "left", lines: leftLines },
    { name: "right", lines: rightLines },
  ];
}

function columnMetrics(lines) {
  if (!lines.length) return null;
  const ordered = [...lines].sort((a, b) => a.y - b.y);
  const pitch = expectedPitch(ordered);
  const widths = ordered.map(l => l.width).filter(v => v > 0);
  const naturalWidths = ordered.map(l => l.ink.width).filter(v => v > 0);
  const medianWidth = median(widths, 0);
  const gaps = [];
  for (let i = 1; i < ordered.length; i++) {
    const dy = ordered[i].y - ordered[i - 1].y;
    if (dy > 0) gaps.push(dy);
  }
  return {
    nLines: ordered.length,
    yTop: round(ordered[0].rect.top),
    yBottom: round(Math.max(...ordered.map(l => l.rect.bottom))),
    spanPx: round(Math.max(...ordered.map(l => l.rect.bottom)) - ordered[0].rect.top),
    pitchPx: round(pitch),
    medianAllocatedWidthPx: round(medianWidth),
    medianInkWidthPx: round(median(naturalWidths, 0)),
    shortLines: medianWidth > 0 ? ordered.filter(l => l.ink.width < medianWidth * 0.8).length : 0,
    veryShortLines: medianWidth > 0 ? ordered.filter(l => l.ink.width < medianWidth * 0.3).length : 0,
    bigPitchGaps: pitch > 0 ? gaps.filter(g => g > pitch * 1.45).length : 0,
    densityLinesPer100Px: round(ordered.length * 100 / Math.max(1, Math.max(...ordered.map(l => l.rect.bottom)) - ordered[0].rect.top)),
  };
}

function twoColumnReport(key, ls, cols) {
  if (cols.length !== 2) return null;
  const metrics = cols.map(c => ({ name: c.name, ...columnMetrics(c.lines) }));
  const a = metrics[0], b = metrics[1];
  const pitch = median([a.pitchPx, b.pitchPx].filter(v => v > 0), 1);
  const topDiff = b.yTop - a.yTop;
  const bottomDiff = b.yBottom - a.yBottom;
  return {
    key,
    role: ls[0]?.role || "",
    boxId: ls[0]?.boxId || "",
    columns: metrics,
    topDiffPx: round(topDiff),
    bottomDiffPx: round(bottomDiff),
    lineCountDiff: b.nLines - a.nLines,
    topAligned: Math.abs(topDiff) <= Math.max(1.5, pitch * 0.2),
    bottomAligned: Math.abs(bottomDiff) <= Math.max(1.5, pitch * 0.35),
    densityBalanced: Math.abs(b.nLines - a.nLines) < 2,
  };
}

function analyzeTwoColumnGroups(lines) {
  const reports = [];
  const seen = new Set();

  // Main text and true multi-column boxes can expose two columns inside one
  // role/box. Prefer explicit v9MainColumn metadata when present.
  const byBox = groupBy(lines, l => `${l.role}:${l.boxId}`);
  for (const [key, ls] of byBox) {
    const cols = clusterColumns(ls);
    const report = twoColumnReport(key, ls, cols);
    if (!report) continue;
    reports.push(report);
    seen.add(key);
  }

  // Historical "one long commentary split into two columns" is represented by
  // two V9 side boxes with the SAME stream id: role=right and role=left. That
  // is the exact counterpart of pdf_report.py's L/R column analysis.
  const byStream = groupBy(
    lines.filter(l => l.boxId && l.boxId !== "main" && (l.role === "right" || l.role === "left")),
    l => l.boxId
  );
  for (const [boxId, ls] of byStream) {
    const roles = groupBy(ls, l => l.role);
    if (!roles.has("right") || !roles.has("left")) continue;
    const right = roles.get("right"), left = roles.get("left");
    if (right.length < 2 || left.length < 2) continue;

    const rw = median(right.map(l => l.width).filter(v => v > 0), 0);
    const lw = median(left.map(l => l.width).filter(v => v > 0), 0);
    const ratio = Math.min(rw, lw) / Math.max(1, Math.max(rw, lw));
    if (ratio < 0.72) continue;

    const key = `split-stream:${boxId}`;
    if (seen.has(key)) continue;
    const report = twoColumnReport(key, ls, [
      { name: "left", lines: left },
      { name: "right", lines: right },
    ]);
    if (report) reports.push(report);
  }

  return reports;
}

function detectCenteredOpeningAnomalies(lines) {
  const issues = [];
  for (const line of lines) {
    if (line.el?.dataset?.v9OpeningCompositeCentered !== "1") continue;

    const page = line.el.closest(".page");
    const pageRect = page?.getBoundingClientRect?.();
    const scale = page ? pageVisualScale(page, pageRect) : 1;
    const expectedCenterRaw = number(line.el.dataset.v9OpeningExpectedCenterPx, NaN);
    const expectedCenter = Number.isFinite(expectedCenterRaw) ? expectedCenterRaw * scale : NaN;
    const opening = line.el.querySelector(".v9-opening-glyph");
    const body = line.el.querySelector(".v9-planned-line-text");
    if (!Number.isFinite(expectedCenter) || !opening || !body || !page || !pageRect) continue;
    const openingRect = localRect(opening, pageRect);
    const bodyInk = rangeInkRect(body, pageRect);
    if (!bodyInk) continue;

    const visualLeft = Math.min(openingRect.left, bodyInk.left);
    const visualRight = Math.max(openingRect.right, bodyInk.right);
    const visualCenter = (visualLeft + visualRight) / 2;
    const error = visualCenter - expectedCenter;

    if (Math.abs(error) > 1.25) {
      issues.push({
        boxId: line.boxId,
        sourceId: line.sourceId,
        y: round(line.y),
        centerErrorPx: round(error),
        expectedCenterPx: round(expectedCenter),
        actualCenterPx: round(visualCenter),
        hostWidthPx: round(number(line.el.dataset.v9OpeningHostFullWidthPx, 0) * scale),
        compositeWidthPx: round(number(line.el.dataset.v9OpeningCompositeWidthPx, 0) * scale),
        openingWidthPx: round(openingRect.width),
        bodyInkWidthPx: round(bodyInk.width),
      });
    }
  }
  return issues;
}

export function analyzePageElement(page, pageIndex = 0, options = {}) {
  if (!page) throw new Error("Missing page element");
  const pageRect = page.getBoundingClientRect();
  const scale = pageVisualScale(page, pageRect);
  const cs = getComputedStyle(page);
  const paddingTop = number(cs.paddingTop, 0) * scale;
  const paddingBottom = number(cs.paddingBottom, 0) * scale;
  const contentTop = paddingTop;
  const contentBottom = Math.max(contentTop, pageRect.height - paddingBottom);

  let lines = collectV9Lines(page, pageRect);
  const engine = lines.length ? "v9" : "fallback";
  if (!lines.length) lines = collectFallbackBlocks(page, pageRect);

  const visible = lines.filter(l => l.text || l.openingApplied);
  const maxBottom = visible.length ? Math.max(...visible.map(l => l.ink.bottom || l.rect.bottom)) : contentTop;
  const minTop = visible.length ? Math.min(...visible.map(l => l.ink.top || l.rect.top)) : contentTop;
  const linePitch = expectedPitch(visible.filter(l => l.role === "main"))
    || expectedPitch(visible)
    || median(visible.map(l => l.height).filter(v => v > 0), 16);

  const bottomGap = Math.max(0, contentBottom - maxBottom);
  const overflowPx = Math.max(
    0,
    maxBottom - contentBottom,
    (number(page.scrollHeight, 0) - number(page.clientHeight, 0)) * scale
  );
  const fillRatio = contentBottom > contentTop
    ? Math.max(0, Math.min(1.5, (maxBottom - contentTop) / (contentBottom - contentTop)))
    : 0;

  const overlaps = analyzeOverlaps(visible);
  const knees = analyzeKnees(visible);
  const columns = analyzeTwoColumnGroups(visible);
  const openingCentering = detectCenteredOpeningAnomalies(visible);
  const commentaryStreams = commentaryStreamSummaries(visible);

  const issues = [];
  const bottomGapLines = linePitch > 0 ? bottomGap / linePitch : 0;
  if (overflowPx > 1) issues.push({
    code: "page-overflow",
    severity: "error",
    message: `גלישה של ${round(overflowPx)}px מעבר לתחום התוכן`,
    value: round(overflowPx),
  });
  if (overlaps.length) issues.push({
    code: "line-overlap",
    severity: "error",
    message: `${overlaps.length} חפיפות טקסט בעמוד`,
    value: overlaps.length,
  });
  const badKnees = knees.filter(k => !k.ok);
  if (badKnees.length) issues.push({
    code: "knee-row-gap",
    severity: "error",
    message: `${badKnees.length} מעברי ברך שאינם על רשת השורות`,
    value: badKnees.length,
  });
  if (openingCentering.length) issues.push({
    code: "opening-center",
    severity: "error",
    message: `${openingCentering.length} שורות סיום עם מילת פתיח שאינן ממורכזות כיחידה אחת`,
    value: openingCentering.length,
  });
  if (bottomGapLines > (options.bottomGapWarningLines ?? 1.5)) issues.push({
    code: "bottom-gap",
    severity: bottomGapLines > 3 ? "error" : "warning",
    message: `רווח תחתון של כ-${round(bottomGapLines, 1)} שורות`,
    value: round(bottomGapLines, 2),
  });
  for (const col of columns) {
    if (!col.topAligned || !col.bottomAligned || !col.densityBalanced) {
      issues.push({
        code: "column-imbalance",
        severity: "warning",
        message: `אי-איזון טורים ב-${col.boxId || col.key}`,
        value: {
          topDiffPx: col.topDiffPx,
          bottomDiffPx: col.bottomDiffPx,
          lineCountDiff: col.lineCountDiff,
        },
      });
    }
  }

  const byRole = {};
  for (const [role, ls] of groupBy(visible, l => l.role)) {
    byRole[role] = {
      lines: ls.length,
      yTop: round(Math.min(...ls.map(l => l.rect.top))),
      yBottom: round(Math.max(...ls.map(l => l.rect.bottom))),
      medianPitchPx: round(expectedPitch(ls)),
      medianFillRatio: round(median(ls.map(l => l.fillRatio), 0)),
      shortLines: ls.filter(l => !l.paragraphLast && l.fillRatio < 0.8).length,
      veryShortLines: ls.filter(l => !l.paragraphLast && l.fillRatio < 0.3).length,
    };
  }

  return {
    page: pageIndex + 1,
    engine,
    widthPx: round(pageRect.width),
    heightPx: round(pageRect.height),
    visualScale: round(scale, 4),
    contentTopPx: round(contentTop),
    contentBottomPx: round(contentBottom),
    textTopPx: round(minTop),
    textBottomPx: round(maxBottom),
    bottomGapPx: round(bottomGap),
    bottomGapLines: round(bottomGapLines, 2),
    overflowPx: round(overflowPx),
    fillRatio: round(fillRatio, 4),
    linePitchPx: round(linePitch),
    lineCount: visible.length,
    roles: byRole,
    knees,
    overlaps,
    columns,
    openingCentering,
    commentaryStreams,
    issues,
    overallOk: !issues.some(i => i.severity === "error"),
  };
}

export function analyzePagesContainer(pagesContainer, options = {}) {
  if (!pagesContainer) throw new Error("Missing pages container");
  const pages = [...pagesContainer.querySelectorAll(PAGE_SELECTOR)]
    .filter(p => getComputedStyle(p).display !== "none");

  const reports = pages.map((page, index) => analyzePageElement(page, index, options));
  const issueCounts = {};
  let errors = 0, warnings = 0;
  for (const page of reports) {
    for (const issue of page.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
      if (issue.severity === "error") errors++;
      else warnings++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    pages: reports.length,
    overallOk: errors === 0,
    errors,
    warnings,
    issueCounts,
    averageFillRatio: round(reports.length
      ? reports.reduce((sum, p) => sum + p.fillRatio, 0) / reports.length
      : 0, 4),
    maxBottomGapLines: round(Math.max(0, ...reports.map(p => p.bottomGapLines)), 2),
    maxOverflowPx: round(Math.max(0, ...reports.map(p => p.overflowPx)), 2),
    pageReports: reports,
  };
}

function severityLabel(issue) {
  return issue.severity === "error" ? "שגיאה" : "אזהרה";
}

function issueSummary(page) {
  if (!page.issues.length) return "תקין";
  return page.issues.map(i => `${severityLabel(i)}: ${i.message}`).join(" · ");
}

function pageTweakerManager() {
  if (typeof window === "undefined") return null;
  const pm = window.paneManager;
  return pm && typeof pm.getPageTweak === "function" ? pm : null;
}

function syncPageMemoryFromReport(report) {
  const pm = pageTweakerManager();
  if (!pm) return;
  try {
    if (typeof pm.syncPageTweakMeasurements === "function") {
      pm.syncPageTweakMeasurements(report?.pageReports || []);
      return;
    }
    if (typeof pm.updatePageTweakMeasurements !== "function") return;
    for (const page of report?.pageReports || []) {
      pm.updatePageTweakMeasurements(page.page, {
        bottomGapLines: page.bottomGapLines,
        overflowPx: page.overflowPx,
        linePitchPx: page.linePitchPx,
      });
    }
  } catch (error) {
    console.warn("[layout-report] page memory measurement sync failed", error);
  }
}

function tweakStatusLabel(tweak) {
  const status = String(tweak?.status || "pending");
  if (status === "approved") return "✓ מאושר";
  if (status === "changed") return "⚠ השתנה";
  return "ממתין";
}

function makeTweakButton(text, title, onClick, className = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.title = title;
  btn.className = ["layout-report-tweak-btn", className].filter(Boolean).join(" ");
  btn.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return btn;
}

function downloadJson(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ravtext-layout-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createReportModal(report) {
  document.querySelector(".layout-report-overlay")?.remove();
  syncPageMemoryFromReport(report);

  const overlay = document.createElement("div");
  overlay.className = "layout-report-overlay";
  overlay.dir = "rtl";

  const modal = document.createElement("section");
  modal.className = "layout-report-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "דוח עימוד");

  const header = document.createElement("header");
  header.className = "layout-report-header";
  const title = document.createElement("div");
  title.innerHTML = `
    <h2>דוח עימוד</h2>
    <p>מדידה ישירה של העמודים הסופיים לפני יצוא PDF</p>`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "layout-report-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "סגור");
  header.append(title, close);

  const summary = document.createElement("div");
  summary.className = "layout-report-summary";
  const cards = [
    ["עמודים", report.pages],
    ["שגיאות", report.errors],
    ["אזהרות", report.warnings],
    ["מילוי ממוצע", `${Math.round(report.averageFillRatio * 100)}%`],
    ["רווח תחתון מרבי", `${report.maxBottomGapLines} שורות`],
    ["גלישה מרבית", `${report.maxOverflowPx}px`],
  ];
  for (const [label, value] of cards) {
    const card = document.createElement("div");
    card.className = "layout-report-card";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    summary.appendChild(card);
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "layout-report-table-wrap";
  const table = document.createElement("table");
  table.className = "layout-report-table";
  table.innerHTML = `
    <thead><tr>
      <th>עמוד</th><th>מילוי</th><th>רווח תחתון</th><th>גלישה</th><th>שורות</th><th>מצב</th><th>תיקון ידני</th>
    </tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const page of report.pageReports) {
    const tr = document.createElement("tr");
    if (page.issues.some(i => i.severity === "error")) tr.classList.add("has-error");
    else if (page.issues.length) tr.classList.add("has-warning");
    const values = [
      String(page.page),
      `${Math.round(page.fillRatio * 100)}%`,
      `${page.bottomGapLines} ש׳`,
      `${page.overflowPx}px`,
      String(page.lineCount),
      page.issues.length ? `${page.issues.length} בעיות` : "תקין",
    ];
    values.forEach((value, index) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (index === 5) td.title = issueSummary(page);
      tr.appendChild(td);
    });

    const tweakCell = document.createElement("td");
    tweakCell.className = "layout-report-tweak-cell";
    const pm = pageTweakerManager();
    if (pm) {
      const current = pm.getPageTweak(page.page);
      const controls = document.createElement("div");
      controls.className = "layout-report-tweak-controls";

      const diff = document.createElement("span");
      diff.className = "layout-report-tweak-value";
      diff.textContent = (current.linesDiff > 0 ? "+" : "") + String(current.linesDiff || 0);
      diff.title = "מספר שורות ידני לעמוד: חיובי = נסה למשוך; שלילי = פנה מקום לעמוד הבא";

      const rerenderAndClose = (nextDiff) => {
        pm.setPageTweak(page.page, { linesDiff: nextDiff });
        overlay.remove();
      };

      controls.append(
        makeTweakButton("−", "הפחת שורה אחת מקיבולת העמוד", () => rerenderAndClose((current.linesDiff || 0) - 1)),
        diff,
        makeTweakButton("+", "נסה למשוך שורה נוספת לעמוד אם היא נכנסת בבטחה", () => rerenderAndClose((current.linesDiff || 0) + 1))
      );

      const streamShiftBox = document.createElement("div");
      streamShiftBox.className = "layout-report-footnote-shifts";
      for (const stream of page.commentaryStreams || []) {
        const row = document.createElement("div");
        row.className = "layout-report-footnote-shift-row";

        const label = document.createElement("span");
        label.className = "layout-report-footnote-shift-label";
        label.textContent = `הערות ${stream.id}`;
        label.title = `${stream.lines} שורות בעמוד; pitch≈${stream.medianPitchPx}px`;

        const shiftValue = Math.max(0, Number(current.footnoteShift?.[stream.id]) || 0);
        const value = document.createElement("span");
        value.className = "layout-report-tweak-value";
        value.textContent = String(shiftValue);
        value.title = "מספר שורות של זרם זה שיועברו לעמוד הבא";

        const setShift = (next) => {
          const footnoteShift = { ...(current.footnoteShift || {}) };
          const n = Math.max(0, Math.min(30, Math.trunc(Number(next) || 0)));
          if (n > 0) footnoteShift[stream.id] = n;
          else delete footnoteShift[stream.id];
          pm.setPageTweak(page.page, { footnoteShift });
          overlay.remove();
        };

        row.append(
          label,
          makeTweakButton("−", `החזר שורת הערות של זרם ${stream.id} לעמוד הזה`, () => setShift(shiftValue - 1)),
          value,
          makeTweakButton("+", `העבר שורת הערות נוספת של זרם ${stream.id} לעמוד הבא`, () => setShift(shiftValue + 1))
        );
        streamShiftBox.appendChild(row);
      }
      if (streamShiftBox.childElementCount) controls.append(streamShiftBox);

      const status = document.createElement("span");
      status.className = "layout-report-tweak-status";
      status.textContent = tweakStatusLabel(current);
      controls.append(status);

      if (current.status === "approved") {
        controls.append(makeTweakButton("בטל אישור", "החזר את העמוד למצב ממתין", () => {
          pm.setPageTweak(page.page, { status: "pending" }, { rerender: false });
          status.textContent = "ממתין";
        }, "secondary"));
      } else {
        controls.append(makeTweakButton("אשר", "שמור את מדדי העמוד הנוכחיים כ-baseline מאושר", () => {
          pm.approvePageTweak(page.page, {
            bottomGapLines: page.bottomGapLines,
            overflowPx: page.overflowPx,
          });
          status.textContent = "✓ מאושר";
        }, "approve"));
      }

      controls.append(makeTweakButton("אפס", "מחק את התיקון הידני והזיכרון של עמוד זה", () => {
        pm.resetPageTweak(page.page);
        overlay.remove();
      }, "reset"));

      tweakCell.appendChild(controls);
    } else {
      tweakCell.textContent = "—";
    }
    tr.appendChild(tweakCell);

    tr.addEventListener("click", () => {
      const pageEl = document.querySelectorAll(PAGE_SELECTOR)[page.page - 1];
      pageEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);

  const details = document.createElement("details");
  details.className = "layout-report-details";
  details.innerHTML = "<summary>פירוט בעיות</summary>";
  const list = document.createElement("div");
  for (const page of report.pageReports.filter(p => p.issues.length)) {
    const section = document.createElement("section");
    section.innerHTML = `<h3>עמוד ${page.page}</h3>`;
    const ul = document.createElement("ul");
    for (const issue of page.issues) {
      const li = document.createElement("li");
      li.className = issue.severity === "error" ? "error" : "warning";
      li.textContent = issue.message;
      ul.appendChild(li);
    }
    section.appendChild(ul);
    list.appendChild(section);
  }
  if (!list.children.length) list.textContent = "לא נמצאו בעיות לפי כללי הדוח.";
  details.appendChild(list);

  const footer = document.createElement("footer");
  footer.className = "layout-report-footer";
  const json = document.createElement("button");
  json.type = "button";
  json.textContent = "הורד JSON מלא";
  json.addEventListener("click", () => downloadJson(report));
  const clearTweaks = document.createElement("button");
  clearTweaks.type = "button";
  clearTweaks.textContent = "נקה תיקוני עמודים";
  clearTweaks.title = "מחק את כל תיקוני העמודים הידניים מהמסמך";
  clearTweaks.addEventListener("click", () => {
    const pm = pageTweakerManager();
    if (!pm || !Object.keys(pm.getPageTweaks?.().pages || {}).length) return;
    if (!confirm("למחוק את כל תיקוני העמודים והאישורים במסמך?")) return;
    pm.clearPageTweaks();
    overlay.remove();
  });
  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary";
  done.textContent = "סגור";
  footer.append(json, clearTweaks, done);

  modal.append(header, summary, tableWrap, details, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const dismiss = () => overlay.remove();
  close.addEventListener("click", dismiss);
  done.addEventListener("click", dismiss);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) dismiss(); });
  document.addEventListener("keydown", function esc(ev) {
    if (ev.key !== "Escape" || !overlay.isConnected) return;
    document.removeEventListener("keydown", esc);
    dismiss();
  });

  return overlay;
}

export function openLayoutAnalysisReport(pagesContainer, options = {}) {
  const report = analyzePagesContainer(pagesContainer, options);
  createReportModal(report);
  return report;
}

export function wireLayoutAnalysisReport(pagesContainer) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("layout-analysis-report-btn")) return true;
    const btn = document.createElement("button");
    btn.id = "layout-analysis-report-btn";
    btn.type = "button";
    btn.textContent = "דוח עימוד";
    btn.title = "בדיקת רווחים, גלישות, חפיפות, ברכיים ואיזון טורים בעמודים הסופיים";
    btn.addEventListener("click", () => {
      try {
        const pages = pagesContainer.querySelectorAll(PAGE_SELECTOR);
        if (!pages.length) {
          alert("אין עדיין עמודים מוכנים לבדיקה. יש לרנדר תחילה.");
          return;
        }
        openLayoutAnalysisReport(pagesContainer);
      } catch (error) {
        console.error("[layout-report]", error);
        alert("לא ניתן להפיק דוח עימוד: " + (error?.message || error));
      }
    });
    group.appendChild(btn);
    return true;
  };

  if (attach()) return;
  let tries = 0;
  const timer = setInterval(() => {
    if (attach() || ++tries > 40) clearInterval(timer);
  }, 100);
}
