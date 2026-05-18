import fs from 'node:fs';

function patchFile(path, patcher) {
  const beforeRaw = fs.readFileSync(path, 'utf8');
  const before = beforeRaw.replace(/\r\n/g, "\n");
  const after = patcher(before);
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-opw-patch] patched ${path}`);
  } else {
    console.log(`[v9-opw-patch] no changes needed for ${path}`);
  }
}

function mustReplace(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`[v9-opw-patch] anchor not found: ${label}`);
  return source.replace(from, to);
}

function patchVilnaV9(source) {
  const importAnchor = `import {\n  buildV9SplitPolicy,\n  buildParagraphBreakCandidates,\n  scoreV9PageCandidate,\n  splitMainTextAtOffset,\n  splitNotesByAnchor,\n  debugV9SplitDecision,\n} from "./engine/v9_split_policy.js";\n`;
  const importWithOpw = importAnchor + `import {\n  buildV9OpeningWordLayoutModel,\n  applyV9OpeningWordModelToLineElement,\n} from "./engine/v9_opening_word_layout_model.js";\n`;
  if (!source.includes('v9_opening_word_layout_model.js')) {
    source = mustReplace(source, importAnchor, importWithOpw, 'opening word import');
  }

  const helperAnchor = `\n// =====================================================================\n// בונה תוכנית עמוד\n`;
  const helperBlock = `
function debugV9OpeningWord(info) {
  if (typeof window === "undefined") return;
  window.__ravtextLastV9OpeningWord = {
    paragraphIndex: info.paragraphIndex ?? null,
    paragraphId: info.paragraphId ?? null,
    applied: !!info.applied,
    skippedReason: info.skippedReason || "",
    position: info.position || "",
    segment: info.segment || "",
    openingWordWidthPx: info.openingWordWidthPx || 0,
    reserveWidthPx: info.reserveWidthPx || 0,
    dropLines: info.dropLines || 0,
    windowApplied: !!info.windowApplied,
    continuedFromPrev: !!info.continuedFromPrev,
  };
}

function cloneV9StripsFromY(strips, startY) {
  const out = [];
  for (const strip of strips || []) {
    if (!strip || strip.y_end <= startY) continue;
    out.push({ ...strip, y_start: Math.max(strip.y_start, startY) });
  }
  return out;
}

function applyV9OpeningWindowToStrips(strips, model, metrics, pageBottom) {
  if (!model || !Array.isArray(strips) || strips.length === 0) {
    return { strips: strips || [], skippedReason: model ? "no-main-strips" : "disabled" };
  }
  const first = strips[0];
  const reserve = Math.max(0, Math.min(
    Number(model.metrics?.reserveWidthPx) || 0,
    Math.max(0, (first.width || 0) - 24)
  ));
  if (reserve <= 0) return { strips, skippedReason: "no-reserve-width" };

  const lineH = metrics.lineHeight;
  const windowLineCount = Math.max(1, Number(model.flow?.windowLineCount) || 1);
  const windowTop = first.y_start;
  const windowBottom = windowTop + windowLineCount * lineH;
  if (model.position === "dropped" && windowBottom > pageBottom + 0.5) {
    return { strips: [], skippedReason: "not-enough-page-space" };
  }

  const out = [];
  const push = (strip) => {
    if (!strip || strip.y_end <= strip.y_start || strip.width <= 0) return;
    out.push(strip);
  };

  for (const strip of strips) {
    const overlapStart = Math.max(strip.y_start, windowTop);
    const overlapEnd = Math.min(strip.y_end, windowBottom);
    if (overlapEnd <= overlapStart) {
      push({ ...strip });
      continue;
    }
    if (strip.y_start < overlapStart) push({ ...strip, y_end: overlapStart });
    push({
      ...strip,
      y_start: overlapStart,
      y_end: overlapEnd,
      width: Math.max(24, strip.width - reserve),
      openingWindow: true,
      openingHostFullWidth: strip.width,
    });
    if (overlapEnd < strip.y_end) push({ ...strip, y_start: overlapEnd });
  }
  out.sort((a, b) => a.y_start - b.y_start || a.x - b.x || a.width - b.width);
  return { strips: out, skippedReason: "" };
}

function markV9ContinuationParagraph(p) {
  if (!p) return p;
  return {
    ...p,
    _continues: true,
    _v9ContinuesFromSplit: true,
    _v9OpeningWordAllowed: false,
  };
}

function concatV9OverflowParagraphs(entries, startIdx, firstOverflowRich) {
  const parts = [];
  const first = normalizeRichTextEntry(firstOverflowRich);
  if (first.text) parts.push(first);
  for (let i = startIdx + 1; i < entries.length; i++) {
    const entry = normalizeRichTextEntry(entries[i]?.rich || entries[i]);
    if (entry.text) parts.push(entry);
  }
  return concatRichTextParts(parts, "\\n");
}

function flowMainParagraphsThroughStrips(pageContent, mainStrips, mainMetrics, cfg, pageBottom) {
  const entries = Array.isArray(pageContent.mainParagraphs) && pageContent.mainParagraphs.length
    ? pageContent.mainParagraphs
    : [{ text: pageContent.mainText || "", runs: pageContent.mainRuns || [], continues: !!pageContent.mainStartsContinued }];
  const allLines = [];
  let curY = mainStrips && mainStrips[0] ? mainStrips[0].y_start : 0;
  let lastDebug = null;

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const rich = normalizeRichTextEntry(entry.rich || { text: entry.text || "", runs: entry.runs || [] });
    if (!rich.text) continue;

    const continued = !!(entry.continues || entry._continues || entry._v9ContinuesFromSplit || entry._v9OpeningWordAllowed === false);
    const model = !continued && entry._v9OpeningWordAllowed !== false
      ? buildV9OpeningWordLayoutModel(rich.text, cfg.openingWordSettings || null, {
          isParagraphStart: true,
          continuesFromPrevious: false,
          baseFontSize: cfg.mainFontSize,
          baseLineHeight: mainMetrics.lineHeight,
        })
      : null;

    let paragraphStrips = cloneV9StripsFromY(mainStrips, curY);
    let flowInput = rich;
    let skippedReason = continued ? "continued-from-prev" : "disabled-or-no-segment";

    if (model) {
      const prepared = applyV9OpeningWindowToStrips(paragraphStrips, model, mainMetrics, pageBottom);
      skippedReason = prepared.skippedReason || "";
      if (skippedReason) {
        const overflow = concatV9OverflowParagraphs(entries, idx, rich);
        lastDebug = { entry, model, skippedReason, applied: false, continued };
        return { lines: allLines, overflowText: overflow.text, overflowRuns: overflow.runs, overflowRich: overflow, endY: curY, debug: lastDebug };
      }
      paragraphStrips = prepared.strips;
      flowInput = makeRichText(model.flow?.remainingText || "", []);
    }

    const flow = flowStreamThroughStrips(flowInput, paragraphStrips, mainMetrics, pageBottom);
    const lines = flow.lines || [];
    if (model && lines.length) {
      const first = lines[0];
      first.openingWord = { model, position: model.position, segment: model.parts?.segment || "" };
      first.openingHostFullWidth = first.openingHostFullWidth || first.width + (model.metrics?.reserveWidthPx || 0);
      first.width = first.openingHostFullWidth;
      first.naturalWidth = (first.naturalWidth || 0) + (model.metrics?.reserveWidthPx || 0);
      first.runs = [];
    }
    allLines.push(...lines);
    lastDebug = { entry, model, skippedReason, applied: !!(model && lines.length), continued };

    if (flow.overflowText) {
      const overflow = concatV9OverflowParagraphs(entries, idx, flow.overflowRich || { text: flow.overflowText, runs: flow.overflowRuns || [] });
      return { lines: allLines, overflowText: overflow.text, overflowRuns: overflow.runs, overflowRich: overflow, endY: flow.endY || curY, debug: lastDebug };
    }
    curY = flow.endY || curY;
  }

  const empty = makeRichText("", []);
  return { lines: allLines, overflowText: "", overflowRuns: [], overflowRich: empty, endY: curY, debug: lastDebug };
}
`;
  if (!source.includes('function flowMainParagraphsThroughStrips')) {
    source = mustReplace(source, helperAnchor, '\n' + helperBlock + helperAnchor, 'opening word helper block');
  }

  source = mustReplace(source, `    const mainFlow = flowStreamThroughStrips(\n      makeRichText(pageContent.mainText, pageContent.mainRuns || []),\n      mainStrips,\n      mainMetrics,\n      effectivePageBottom\n    );`, `    const mainFlow = flowMainParagraphsThroughStrips(\n      pageContent,\n      mainStrips,\n      mainMetrics,\n      cfg,\n      effectivePageBottom\n    );`, 'main flow replacement');

  source = mustReplace(source, `        lineHeightPx: mainMetrics.lineHeight,\n        runs: line.runs || [],\n      });`, `        lineHeightPx: mainMetrics.lineHeight,\n        openingWord: line.openingWord || null,\n        openingHostFullWidth: line.openingHostFullWidth || null,\n        openingWindow: !!line.openingWindow,\n        runs: line.runs || [],\n      });`, 'main line openingWord fields');

  const runsAnchor = `    // 2026-05-17:\n    // mainFlow כבר מחשב line.runs לפי wordTokens ו-offsets מקוריים.\n    // אסור להריץ כאן attachRunsToLines, כי הוא משחזר לפי indexOf ויכול\n    // להזיז bold/color למילים חוזרות או אחרי פיצולים. משאירים את line.runs\n    // כפי שחושבו ב-flowStreamThroughStrips.\n    for (const line of mainLines) {\n      if (!Array.isArray(line.runs)) line.runs = [];\n    }`;
  const debugRuns = `    const opwDebug = mainFlow.debug || null;\n    debugV9OpeningWord({\n      paragraphIndex: opwDebug?.entry?.index || null,\n      paragraphId: opwDebug?.entry?.id || null,\n      applied: !!opwDebug?.applied,\n      skippedReason: opwDebug?.skippedReason || "",\n      position: opwDebug?.model?.position || "",\n      segment: opwDebug?.model?.parts?.segment || "",\n      openingWordWidthPx: opwDebug?.model?.metrics?.openingWordWidthPx || 0,\n      reserveWidthPx: opwDebug?.model?.metrics?.reserveWidthPx || 0,\n      dropLines: opwDebug?.model?.metrics?.dropLines || 0,\n      windowApplied: !!opwDebug?.applied,\n      continuedFromPrev: !!opwDebug?.continued,\n    });\n\n` + runsAnchor;
  if (!source.includes('const opwDebug = mainFlow.debug || null;')) {
    source = mustReplace(source, runsAnchor, debugRuns, 'opening word debug block');
  }

  source = mustReplace(source, `      // משה 2026-05-13: רינדור עם inline runs — בולד/הדגשה/צבע פר-מילה.\n      // אם line.runs ריק, appendTextWithRuns ייצור textNode רגיל (זהה ל-textContent).\n      appendTextWithRuns(lineEl, line.text, line.runs);\n      pageEl.appendChild(lineEl);`, `      // משה 2026-05-13: רינדור עם inline runs — בולד/הדגשה/צבע פר-מילה.\n      // אם line.runs ריק, appendTextWithRuns ייצור textNode רגיל (זהה ל-textContent).\n      if (line.openingWord && line.openingWord.model) {\n        applyV9OpeningWordModelToLineElement(lineEl, line.openingWord.model, line.text);\n      } else {\n        appendTextWithRuns(lineEl, line.text, line.runs);\n      }\n      pageEl.appendChild(lineEl);`, 'opening word render hook');

  const aggOld = `  const mainPieces = [];\n  const mainRunsAccum = [];\n  let mainOffset = 0;\n  for (const p of paragraphs) {\n    const piece = blockToText(p);\n    if (!piece) continue;\n    if (mainPieces.length > 0) mainOffset += 1; // for the '\\n' separator\n    mainPieces.push(piece);\n    if (Array.isArray(p.mainRuns) && p.mainRuns.length) {\n      // הסר את stripStreamMarkers שעשוי לשנות תוכן בתוך הפסקה — לפסקאות\n      // טיפוסיות זה רק מנקה רווחים, ה-runs יישארו רוב הזמן נכונים.\n      for (const r of p.mainRuns) {\n        if (r.end > r.start) {\n          mainRunsAccum.push({\n            start: mainOffset + r.start,\n            end: mainOffset + r.end,\n            marks: r.marks,\n          });\n        }\n      }\n    }\n    mainOffset += piece.length;\n  }\n  const mainText = stripStreamMarkers(mainPieces.join('\\n'));\n  const mainRuns = mainRunsAccum;\n  const mainContinues = paragraphs.some(p => p && p._continues);\n`;
  const aggNew = `  const mainPieces = [];\n  const mainRunsAccum = [];\n  const mainParagraphs = [];\n  let mainOffset = 0;\n  let mainParagraphIndex = 0;\n  for (const p of paragraphs) {\n    const piece = blockToText(p);\n    if (!piece) continue;\n    const cleanPiece = stripStreamMarkers(piece);\n    const localRuns = Array.isArray(p.mainRuns) ? p.mainRuns : [];\n    mainParagraphIndex += 1;\n    mainParagraphs.push({\n      id: p.id || \`main-\${mainParagraphIndex}\`,\n      index: mainParagraphIndex,\n      text: cleanPiece,\n      runs: localRuns,\n      rich: makeRichText(cleanPiece, localRuns),\n      continues: !!(p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),\n      _v9ContinuesFromSplit: !!p._v9ContinuesFromSplit,\n      _v9OpeningWordAllowed: p._v9OpeningWordAllowed,\n    });\n    if (mainPieces.length > 0) mainOffset += 1; // for the '\\n' separator\n    mainPieces.push(piece);\n    if (Array.isArray(p.mainRuns) && p.mainRuns.length) {\n      // הסר את stripStreamMarkers שעשוי לשנות תוכן בתוך הפסקה — לפסקאות\n      // טיפוסיות זה רק מנקה רווחים, ה-runs יישארו רוב הזמן נכונים.\n      for (const r of p.mainRuns) {\n        if (r.end > r.start) {\n          mainRunsAccum.push({\n            start: mainOffset + r.start,\n            end: mainOffset + r.end,\n            marks: r.marks,\n          });\n        }\n      }\n    }\n    mainOffset += piece.length;\n  }\n  const mainText = stripStreamMarkers(mainPieces.join('\\n'));\n  const mainRuns = mainRunsAccum;\n  const mainContinues = paragraphs.some(p => p && p._continues);\n  const firstMainParagraph = mainParagraphs.find(p => p.text);\n  const mainStartsContinued = !!firstMainParagraph?.continues;\n  const mainOpeningWordAllowed = !!firstMainParagraph && !mainStartsContinued;\n`;
  if (!source.includes('const mainParagraphs = [];')) {
    source = mustReplace(source, aggOld, aggNew, 'aggregate main paragraphs');
  }

  source = source.replaceAll('return { mainText, mainRuns, mainContinues, rightStream, leftStream, footerStreams, titles };', 'return { mainText, mainRuns, mainParagraphs, mainContinues, mainStartsContinued, mainOpeningWordAllowed, rightStream, leftStream, footerStreams, titles };');
  source = source.replaceAll('pendingParagraph = splitInfo.secondHalf;', 'pendingParagraph = markV9ContinuationParagraph(splitInfo.secondHalf);');
  return source;
}

function patchVilnaV9Apply(source) {
  source = source.replace('import { applyOpeningWordsToPages } from "./opening_word.js";', 'import { getOpeningWordSettings } from "./opening_word.js";');
  source = source.replace('      preventMidLineSplit: readSpacingBool("preventMidLineSplit", true),\n    });', '      preventMidLineSplit: readSpacingBool("preventMidLineSplit", true),\n      openingWordSettings: getOpeningWordSettings(),\n    });');
  source = source.replace(`
    // 2026-05-17: engine_bridge מדלג במסלול גפ"ת/V9 על הפאסים הרגילים,
    // ולכן מילת פתיח לא הופעלה כלל במצב גפ"ת. כאן מפעילים אותה ישירות
    // אחרי בניית דפי V9, בזמן ש-opening_word.js כבר יודע לטפל ב-.v9-line.
    applyOpeningWordsToPages(container);
`, '\n');
  return source;
}

patchFile('src/vilna_v9.js', patchVilnaV9);
patchFile('src/vilna_v9_apply.js', patchVilnaV9Apply);

