function normalizedCode(value) {
  return String(value ?? "").replace(/[\r\n]/g, "").trim().slice(0, 64);
}

function protectedRanges(text, literals = []) {
  const ranges = [];
  const unique = [...new Set((literals || []).map(normalizedCode).filter(Boolean))];
  for (const literal of unique) {
    let at = text.indexOf(literal);
    while (at !== -1) {
      ranges.push({ start: at, end: at + literal.length });
      at = text.indexOf(literal, at + Math.max(1, literal.length));
    }
  }
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

function overlapsProtected(start, end, ranges) {
  return ranges.some(r => start < r.end && end > r.start);
}

export function normalizeGlobalLineBreakSettings(settings = {}) {
  return {
    enabled: !!settings.globalLineBreakCodeEnabled,
    code: normalizedCode(settings.globalLineBreakCode),
  };
}

export function globalLineBreakSettingsSignature(settings = {}) {
  const s = normalizeGlobalLineBreakSettings(settings);
  return `${s.enabled ? 1 : 0}:${s.code}`;
}

// Replaces a literal source code with a real newline while moving every source
// offset through one boundary map. The caller may protect active stream symbols
// so a configured code can never eat an apparatus marker by accident.
export function applyGlobalLineBreakCode({
  text = "",
  runs = [],
  positions = [],
  settings = {},
  protectedLiterals = [],
} = {}) {
  const raw = String(text ?? "");
  const cfg = normalizeGlobalLineBreakSettings(settings);
  if (!cfg.enabled || !cfg.code || !raw.includes(cfg.code)) {
    return {
      text: raw,
      runs: (runs || []).map(r => ({ ...r, marks: { ...(r.marks || {}) } })),
      positions: (positions || []).map(Number),
      replacements: 0,
      code: cfg.code,
    };
  }

  const protectedSpans = protectedRanges(raw, protectedLiterals);
  const starts = new Set();
  let at = raw.indexOf(cfg.code);
  while (at !== -1) {
    const end = at + cfg.code.length;
    if (!overlapsProtected(at, end, protectedSpans)) starts.add(at);
    at = raw.indexOf(cfg.code, at + Math.max(1, cfg.code.length));
  }
  if (!starts.size) {
    return {
      text: raw,
      runs: (runs || []).map(r => ({ ...r, marks: { ...(r.marks || {}) } })),
      positions: (positions || []).map(Number),
      replacements: 0,
      code: cfg.code,
    };
  }

  const boundary = new Array(raw.length + 1).fill(0);
  let out = "";
  let i = 0;
  boundary[0] = 0;
  while (i < raw.length) {
    boundary[i] = out.length;
    if (starts.has(i)) {
      const end = i + cfg.code.length;
      out += "\n";
      for (let j = i + 1; j <= end; j++) boundary[j] = out.length;
      i = end;
      continue;
    }
    out += raw[i];
    i += 1;
    boundary[i] = out.length;
  }
  boundary[raw.length] = out.length;

  const mapOffset = value => {
    const pos = Math.max(0, Math.min(raw.length, Number(value) || 0));
    return boundary[pos] ?? out.length;
  };

  const mappedRuns = (runs || []).flatMap(r => {
    const start = mapOffset(r.start);
    const end = mapOffset(r.end);
    return end > start ? [{ ...r, start, end, marks: { ...(r.marks || {}) } }] : [];
  });

  return {
    text: out,
    runs: mappedRuns,
    positions: (positions || []).map(mapOffset),
    replacements: starts.size,
    code: cfg.code,
  };
}
