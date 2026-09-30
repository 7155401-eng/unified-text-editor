import { appendTextWithRuns, sliceRuns } from './runs_dom.js';
import { extractOpeningSegmentForTest } from '../opening_word.js';
import { V9_INLINE_PLAN_VERSION } from './v9_main_inline_layout.js';

const TYPOGRAPHY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontFeatureSettings', 'fontKerning', 'lineHeight', 'letterSpacing', 'wordSpacing', 'color', 'backgroundColor', 'textDecoration', 'direction'];
const FONT_STACKS = {
  David: '"David", "David Libre", "Frank Ruhl Libre", serif',
  'David Libre': '"David Libre", "David", "Frank Ruhl Libre", serif',
  'Frank Ruhl Libre': '"Frank Ruhl Libre", "David Libre", "David", serif',
  'Segoe UI': '"Segoe UI", "David", "David Libre", sans-serif',
};
const px = (v, fallback = 0) => Number.parseFloat(v) || fallback;
const clamp = (v, fallback, lo, hi) => Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback;
const cssApply = (el, style) => { for (const key of TYPOGRAPHY) if (style?.[key] != null) el.style[key] = String(style[key]); };

function appendReference(parent, ref) {
  if (!ref.formatted) return;
  const span = document.createElement('span');
  span.className = 'stream-ref v9-main-ref';
  span.dir = 'ltr'; span.style.cssText = ref.cssText || '';
  span.style.display = 'inline-block'; span.style.unicodeBidi = 'isolate';
  // A label is one measured inline object. Row justification stretches the
  // gaps BETWEEN words, never whitespace inside a configured number label.
  if (!span.style.wordSpacing || span.style.wordSpacing === 'inherit') span.style.wordSpacing = '0px';
  span.textContent = ref.formatted;
  Object.assign(span.dataset, { v9MainRef: '1', stream: String(ref.stream || ref.code || ''),
    num: String(ref.num || ''), uid: String(ref.uid || ''), anchor: String(ref.anchor ?? ''), localPos: String(ref.localPos ?? '') });
  parent.appendChild(span);
}

function appendSemanticWhitespace(parent, text) {
  if (!text) return;
  const span = document.createElement('span');
  span.className = 'v9-source-whitespace'; span.style.display = 'none';
  span.textContent = text;
  parent.appendChild(span);
}

// Shared by the measurement probe and final paint. Reference labels and styles
// have already been resolved: painting never reads mutable settings again.
export function appendV9PlannedPart(parent, part) {
  appendSemanticWhitespace(parent, part.leadingText);
  let cursor = 0;
  for (const ref of part.refs || []) {
    const pos = Math.max(cursor, Math.min(part.text.length, Number(ref.localPos) || 0));
    if (pos > cursor) appendTextWithRuns(parent, part.text.slice(cursor, pos), sliceRuns(part.runs || [], cursor, pos));
    appendReference(parent, ref); cursor = pos;
  }
  if (cursor < part.text.length) appendTextWithRuns(parent, part.text.slice(cursor), sliceRuns(part.runs || [], cursor, part.text.length));
  appendSemanticWhitespace(parent, part.trailingText);
}

export function createV9TextLayoutContext(cfg, hooks = {}) {
  if (!document?.body) throw new Error('V9 layout requires a document with loaded fonts');
  const root = document.createElement('div');
  root.className = 'v9-page v9-layout-measurement';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:max-content;height:auto;padding:0;margin:0;border:0;transform:none;zoom:1;';
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;position:relative;white-space:pre;padding:0;margin:0;border:0;float:none;transform:none;';
  probe.style.direction = 'rtl';
  probe.style.fontFamily = cfg.mainFontFamily || 'serif';
  probe.style.fontSize = `${cfg.mainFontSize || 13}px`;
  probe.style.lineHeight = `${(cfg.mainFontSize || 13) * (cfg.lineHeightRatio || 1.55)}px`;
  hooks.decorateBase?.(probe);
  root.appendChild(probe); document.body.appendChild(root);
  const computed = getComputedStyle(probe);
  const typography = Object.fromEntries(TYPOGRAPHY.map(k => [k, computed[k]]));
  typography.direction = 'rtl'; typography.wordSpacing = '0px';
  const fontSize = px(typography.fontSize, 13);
  const lineHeight = Math.max(px(typography.lineHeight, fontSize * 1.55), fontSize);
  typography.lineHeight = `${lineHeight}px`;
  const cache = new Map();
  let generation = 0, disposed = false;
  const fontsChanged = () => { generation++; cache.clear(); };
  document.fonts?.addEventListener?.('loadingdone', fontsChanged);
  document.fonts?.addEventListener?.('loadingerror', fontsChanged);
  const context = {
    typography, fontSize, lineHeight,
    get generation() { return generation; },
    prepareEntry(entry) {
      return { ...entry, typography: { ...typography }, runs: hooks.prepareRuns?.(entry.runs || []) || entry.runs || [],
        mainRefs: hooks.prepareRefs?.(entry.mainRefs || []) || entry.mainRefs || [] };
    },
    describeOpening(entry) {
      const s = cfg.openingWordSettings || {};
      if (!s.enabled || entry.continues || entry._v9OpeningWordAllowed === false) return null;
      if (s.scope === 'first' && (entry.source?.index || entry.index || 1) !== 1) return null;
      if (s.skipHeadings !== false && entry.isHeading) return null;
      const parts = extractOpeningSegmentForTest(entry.text, s);
      if (!parts?.segment) return null;
      // V9 accepts contiguous rich-text ranges. Do not silently rewrite command
      // markup into different source offsets; keep it as ordinary text instead.
      if (parts.prefix + parts.segment + parts.suffix !== entry.text) {
        return null;
      }
      const start = parts.prefix.length, end = start + parts.segment.length;
      const inherited = {};
      for (const run of entry.runs || []) if (run.start <= start && run.end > start) Object.assign(inherited, run.marks || {});
      let size = px(inherited.fontSize, fontSize);
      if (inherited.fontSizeUnit === 'pt' || /pt$/i.test(String(inherited.fontSize))) size *= 4 / 3;
      if (/%$/.test(String(inherited.fontSize))) size = fontSize * px(inherited.fontSize) / 100;
      if (/em$/.test(String(inherited.fontSize))) size = fontSize * px(inherited.fontSize);
      const custom = hooks.openingStyle?.(s.style) || {};
      const family = s.font && s.font !== 'inherit' ? (FONT_STACKS[s.font] || s.font) : (inherited.fontFamily || typography.fontFamily);
      const openingSize = size * clamp(s.size, 200, 80, 500) / 100;
      const marks = { ...custom, fontFamily: family, fontSize: openingSize, fontSizeUnit: 'px',
        fontWeight: s.weight === 'normal' ? '400' : s.weight === 'heavy' ? '900' : '700', lineHeight: '1' };
      return { start, end, marks, position: s.position === 'raised' ? 'raised' : 'dropped',
        dropLines: Math.round(clamp(s.dropLines, 2, 1, 8)),
        gapPx: openingSize * clamp(s.spaceAfter, 0.3, 0, 4) };
    },
    measure(part) {
      if (disposed) throw new Error('Disposed V9 measurement context');
      const key = JSON.stringify([part.text, part.runs, part.refs, part.style]);
      const found = cache.get(key); if (found) return found;
      probe.replaceChildren(); cssApply(probe, part.style || typography);
      probe.style.whiteSpace = 'pre'; probe.style.width = 'max-content'; probe.style.height = 'auto';
      appendV9PlannedPart(probe, part);
      const r = probe.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(probe);
      const ink = range.getBoundingClientRect();
      const top = ink.height ? Math.min(r.top, ink.top) : r.top;
      const bottom = ink.height ? Math.max(r.bottom, ink.bottom) : r.bottom;
      const result = Object.freeze({ width: Math.ceil(r.width * 64) / 64,
        height: Math.ceil(Math.max(lineHeight, bottom - top) * 64) / 64,
        topInset: Math.max(0, r.top - top) });
      if (cache.size >= 20000) cache.clear();
      cache.set(key, result); return result;
    },
    dispose() {
      if (disposed) return; disposed = true;
      document.fonts?.removeEventListener?.('loadingdone', fontsChanged);
      document.fonts?.removeEventListener?.('loadingerror', fontsChanged);
      root.remove(); cache.clear();
    },
  };
  return context;
}

/** Paint a finalized V9 main line. No measurement, reflow, resize, scale, float,
 * next-line lookup, run stripping, or metadata inference is permitted here. */
export function renderV9PlannedMainLine(line, pageEl, padding = 0) {
  if (line.layoutVersion !== V9_INLINE_PLAN_VERSION) throw new Error('Unknown V9 main line plan');
  const el = document.createElement('div');
  el.className = 'v9-line v9-role-main v9-final-main-line';
  el.style.cssText = 'position:absolute;box-sizing:border-box;margin:0;padding:0;border:0;overflow:visible;white-space:pre;transform:none;text-indent:0;';
  cssApply(el, line.render.body.style);
  el.style.left = `${padding + line.x}px`; el.style.top = `${line.y}px`;
  el.style.width = `${line.width}px`; el.style.height = `${line.lineHeightPx}px`;
  const src = line.source;
  Object.assign(el.dataset, { v9Role: 'main', v9BoxId: 'main', v9LayoutFinal: V9_INLINE_PLAN_VERSION,
    v9SourceStream: 'main', v9ParagraphId: src.paragraphId, v9ParagraphIndex: String(src.paragraphIndex),
    v9ParagraphStart: src.paragraphStart ? '1' : '0', v9Continuation: src.continuation ? '1' : '0',
    v9SourceOffset: String(src.start), v9SourceEnd: String(src.end), v9RawSourceOffset: String(src.rawStart),
    v9RawSourceEnd: String(src.rawEnd), v9SourceDomain: src.domain,
    v9OpeningWindowApplied: line.openingWindow ? '1' : '0', v9StretchPolicy: 'planned-in-v9' });
  if (line.forcedBreak) el.dataset.v9ForcedBreak = '1';
  if (line.isLast) el.dataset.v9ParaLast = '1';
  const opening = line.render.opening;
  if (opening) {
    const glyph = document.createElement('span');
    glyph.className = 'v9-opening-glyph';
    glyph.style.cssText = 'position:absolute;display:inline-block;box-sizing:border-box;float:none;white-space:pre;padding:0;margin:0;border:0;overflow:visible;';
    cssApply(glyph, opening.part.style);
    glyph.style.left = `${opening.x - line.x}px`; glyph.style.top = `${opening.y - line.y + opening.topInset}px`;
    glyph.style.width = `${opening.width}px`;
    appendV9PlannedPart(glyph, opening.part); el.appendChild(glyph);
    el.dataset.opwApplied = '1'; el.dataset.v9OpeningWordSource = V9_INLINE_PLAN_VERSION;
    el.dataset.v9OpeningWordWidthPx = String(opening.width);
    el.dataset.v9OpeningWordReservePx = String(opening.width + opening.gap);
    el.dataset.v9OpeningDropLines = String(opening.dropLines);
  }
  const body = document.createElement('span');
  body.className = 'v9-planned-line-text';
  body.style.cssText = 'position:absolute;left:0;display:block;box-sizing:border-box;white-space:pre;overflow:visible;margin:0;padding:0;';
  body.style.top = `${line.render.topInset}px`; body.style.width = `${line.width}px`;
  body.style.wordSpacing = `${line.render.wordSpacing}px`; body.style.textAlign = line.render.alignment;
  appendV9PlannedPart(body, line.render.body); el.appendChild(body);
  pageEl.dataset.v9MainLayout = V9_INLINE_PLAN_VERSION;
  pageEl.appendChild(el); return el;
}

// Loading is completed before a render-scoped measurement cache is created.
// A timeout is an error, not a false declaration that the requested fonts loaded.
export async function waitForV9LayoutFonts(paragraphs, cfg, timeoutMs = 15000) {
  if (!document?.fonts) return;
  const families = new Set([cfg.mainFontFamily, cfg.sideFontFamily, cfg.openingWordSettings?.font]);
  const seen = new WeakSet();
  const collect = entry => {
    if (!entry || typeof entry !== 'object' || seen.has(entry)) return;
    seen.add(entry);
    for (const run of [...(entry.mainRuns || []), ...(entry.runs || [])])
      if (run.marks?.fontFamily) families.add(run.marks.fontFamily);
    for (const child of [...(entry.notes || []), ...(entry.children || [])]) collect(child);
  };
  for (const entry of paragraphs || []) collect(entry);
  for (const style of cfg.__v9ResolvedFontStyles || []) if (style?.fontFamily) families.add(style.fontFamily);
  const loads = [];
  for (const f of families) {
    if (!f || f === 'inherit') continue;
    const family = FONT_STACKS[f] || f;
    for (const w of ['400', '700', '900']) loads.push(document.fonts.load(`${w} ${cfg.mainFontSize || 13}px ${family}`, 'אבגד ABC'));
  }
  let timer;
  try {
    await Promise.race([
      Promise.all(loads).then(() => document.fonts.ready),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('V9_FONT_TIMEOUT: fonts were not ready; render was not published')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
