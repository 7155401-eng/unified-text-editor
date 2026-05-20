import fs from "node:fs";

const MARKER = "two-column-render-integrity";
const V9_TARGET = "src/vilna_v9.js";
const BALANCED_TARGET = "src/balanced_columns.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[${MARKER}] patched ${path}`);
  } else {
    console.log(`[${MARKER}] noop ${path}`);
  }
}

function patchVilnaV9(source) {
  let out = source;

  if (!out.includes("v9-strip-y-end-guard")) {
    const oldNextStrip = `    const nextStripY = (stripIdx + 1 < strips.length) ? strips[stripIdx + 1].y_start : maxY;`;
    const newNextStrip = `    // v9-strip-y-end-guard: respect explicit strip bottoms. Without this,
    // a last/suppressed strip can consume lines down to pageBottom, while the
    // render pass later drops those lines because they are outside every y_end.
    const explicitStripEndY = Number.isFinite(Number(strip.y_end)) ? Number(strip.y_end) : null;
    const nextStripY = explicitStripEndY !== null
      ? Math.min(explicitStripEndY, maxY)
      : ((stripIdx + 1 < strips.length) ? strips[stripIdx + 1].y_start : maxY);`;

    if (!out.includes(oldNextStrip)) {
      throw new Error(`[${MARKER}] V9 nextStripY anchor not found`);
    }
    out = out.replace(oldNextStrip, newNextStrip);
  }

  const oldSideFlowMap = `      strips.map(s => ({ y_start: s.y_start, width: s.width })),`;
  const newSideFlowMap = `      // v9-strip-y-end-guard: flow must receive y_end, otherwise it may
      // consume invisible lines below a capped/suppressed strip.
      strips.map(s => ({ y_start: s.y_start, y_end: s.y_end, width: s.width })),`;
  if (out.includes(oldSideFlowMap)) {
    out = out.replace(oldSideFlowMap, newSideFlowMap);
  }

  return out;
}

function patchBalancedColumns(source) {
  let out = source;

  if (!out.includes("balanced-columns-integrity-guard")) {
    const fetchBlock = `async function fetchBalanceDecision(lineCount, settings) {
  const { getNonceHeader } = await import('./render_preflight.js');
  const res = await fetch('/api/balance/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...getNonceHeader() },
    body: JSON.stringify({ lineCount, settings }),
  });
  if (!res.ok) throw new Error(\`balance decide failed: HTTP \${res.status}\`);
  return res.json();
}`;

    const helperBlock = `${fetchBlock}

// balanced-columns-integrity-guard: the server decision is only advisory.
// If it skips/overlaps any visual line, fall back to a local contiguous split
// so every measured line is rendered exactly once.
function fallbackBalanceDecision(lineCount, settings = {}, forceBalance = false) {
  const minLines = Math.max(1, parseInt(settings?.minLinesForCols || 3, 10) || 3);
  if (!forceBalance && lineCount < minLines) return { balance: false };
  if (!Number.isFinite(lineCount) || lineCount < 2) return { balance: false };

  const centerLast = settings?.lastLineCenter !== false;
  const hasOrphan = centerLast && lineCount % 2 === 1 && lineCount > 2;
  const bodyLineCount = hasOrphan ? lineCount - 1 : lineCount;
  if (bodyLineCount < 2) return { balance: false };

  const rightEnd = Math.ceil(bodyLineCount / 2);
  return {
    balance: true,
    rightStart: 0,
    rightEnd,
    leftStart: rightEnd,
    leftEnd: bodyLineCount,
    hasOrphan,
    centerLast,
  };
}

function normalizeBalanceDecision(rawDecision, lineCount, settings = {}) {
  if (!rawDecision || rawDecision.balance === false) return { balance: false };

  const toInt = (value) => {
    const n = Number(value);
    return Number.isInteger(n) ? n : NaN;
  };

  const d = {
    ...rawDecision,
    balance: rawDecision.balance === true,
    rightStart: toInt(rawDecision.rightStart),
    rightEnd: toInt(rawDecision.rightEnd),
    leftStart: toInt(rawDecision.leftStart),
    leftEnd: toInt(rawDecision.leftEnd),
    hasOrphan: rawDecision.hasOrphan === true,
    centerLast: rawDecision.centerLast !== false,
  };

  const orphanCount = d.hasOrphan ? 1 : 0;
  const bodyEnd = lineCount - orphanCount;
  const valid = d.balance === true &&
    Number.isInteger(lineCount) &&
    Number.isInteger(d.rightStart) &&
    Number.isInteger(d.rightEnd) &&
    Number.isInteger(d.leftStart) &&
    Number.isInteger(d.leftEnd) &&
    d.rightStart === 0 &&
    d.rightEnd >= d.rightStart &&
    d.leftStart === d.rightEnd &&
    d.leftEnd === bodyEnd &&
    d.leftEnd >= d.leftStart &&
    d.leftEnd <= lineCount &&
    bodyEnd >= 0;

  if (valid) return d;

  if (typeof console !== "undefined") {
    console.warn("[balanced-columns] invalid balance decision; using contiguous fallback", {
      lineCount,
      rawDecision,
    });
  }
  return fallbackBalanceDecision(lineCount, settings, true);
}`;

    if (!out.includes(fetchBlock)) {
      throw new Error(`[${MARKER}] balanced helper anchor not found`);
    }
    out = out.replace(fetchBlock, helperBlock);
  }

  const oldDecision = `    const decision = await fetchBalanceDecision(lines.length, settings);
    if (!decision.balance) return null;`;
  const newDecision = `    let decision;
    try {
      decision = normalizeBalanceDecision(
        await fetchBalanceDecision(lines.length, settings),
        lines.length,
        settings
      );
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[balanced-columns] balance decision failed; using local fallback", err);
      }
      decision = fallbackBalanceDecision(lines.length, settings, true);
    }
    if (!decision.balance) return null;`;

  if (out.includes(oldDecision)) {
    out = out.replace(oldDecision, newDecision);
  }

  return out;
}

const beforeV9 = readFile(V9_TARGET);
const afterV9 = patchVilnaV9(beforeV9);
writeIfChanged(V9_TARGET, beforeV9, afterV9);

const beforeBalanced = readFile(BALANCED_TARGET);
const afterBalanced = patchBalancedColumns(beforeBalanced);
writeIfChanged(BALANCED_TARGET, beforeBalanced, afterBalanced);
