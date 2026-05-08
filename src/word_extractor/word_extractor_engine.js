// word_extractor_engine.js — port מלא של word_extractor.py (1411 שורות) ל-JavaScript.
// מטרה: עיבוד DOCX בדפדפן בלבד, ללא Python/pywebview.
// ה-port הוא verbatim — שמות פונקציות, רגקסים והתנהגות זהים למקור.

import {
  SOURCE_FOOTNOTE, SOURCE_ENDNOTE, SOURCE_COMMENT,
  SOURCE_CUSTOM, SOURCE_EXTERNAL, SOURCE_SIDENOTE, SOURCE_PARALLEL,
  SOURCE_LABELS,
} from "./word_extractor_i18n.js";

// קבועי namespace
export const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export const SIDENOTE_CMD_MAP = {
  'right':  '\\ledrightnote',
  'left':   '\\ledleftnote',
  'inner':  '\\ledinnernote',
  'outer':  '\\ledouternote',
};

// =====================================================================
// CharToken / RichText
// =====================================================================

export class CharToken {
  constructor(char, b = false, i = false, u = false, sz = 0, col = "", is_raw_latex = false) {
    // sz = font size in half-points (Word's w:sz encoding; 24 = 12pt).
    // 0 means "no override — use the paragraph default".
    // col = hex color string (e.g. "FF0000") or "" for default.
    this.char = char;
    this.b = b; this.i = i; this.u = u;
    this.sz = sz; this.col = col;
    this.is_raw_latex = is_raw_latex;
  }
}

export class RichText {
  constructor(tokens) {
    this.tokens = tokens ? Array.from(tokens) : [];
  }
  append(char, b = false, i = false, u = false, sz = 0, col = "", is_raw_latex = false) {
    this.tokens.push(new CharToken(char, b, i, u, sz, col, is_raw_latex));
  }
  extend(other) {
    for (const t of other.tokens) this.tokens.push(t);
  }
  get_text() {
    let s = "";
    for (const t of this.tokens) s += t.char;
    return s;
  }
  copy() {
    return new RichText(this.tokens.map(t =>
      new CharToken(t.char, t.b, t.i, t.u, t.sz, t.col, t.is_raw_latex)));
  }
  to_latex(opts) {
    if (!this.tokens.length) return "";
    // feature_gate שקול: ברירת מחדל true. options: { gate_size, gate_color, gate_emph }
    const g_size  = opts && opts.gate_size  === false ? false : true;
    const g_color = opts && opts.gate_color === false ? false : true;
    const g_emph  = opts && opts.gate_emph  === false ? false : true;

    const result = [];
    let cb = false, ci = false, cu = false, csz = 0, ccol = "";
    let depth = 0;
    const _close_n = (n) => "}".repeat(n);

    function _open(b, i, u, sz, col) {
      const parts = [];
      let d = 0;
      // PR #104 — emphasis goes through \ravtextbf
      if (b && g_emph) { parts.push("\\ravtextbf{"); d++; }
      if (i && g_emph) { parts.push("\\textit{"); d++; }
      if (u && g_emph) { parts.push("\\underline{"); d++; }
      if (sz && g_size) {
        const pt = sz / 2.0;
        parts.push(`{\\fontsize{${pt.toFixed(1)}pt}{${(pt * 1.2).toFixed(1)}pt}\\selectfont `);
        d++;
      }
      if (col && g_color) {
        // v11.38 — \textcolor (proper group)
        parts.push(`\\textcolor[HTML]{${col}}{`);
        d++;
      }
      return [parts.join(""), d];
    }

    const sp = { '&':'\\&','%':'\\%','$':'\\$','#':'\\#','_':'\\_','{':'\\{','}':'\\}',
                 '~':'\\textasciitilde{}','^':'\\textasciicircum{}','\\':'\\textbackslash{}' };

    for (const t of this.tokens) {
      if (t.is_raw_latex) {
        if (depth) {
          result.push(_close_n(depth));
          cb = ci = cu = false; csz = 0; ccol = ""; depth = 0;
        }
        result.push(t.char); continue;
      }
      if (t.b !== cb || t.i !== ci || t.u !== cu || t.sz !== csz || t.col !== ccol) {
        result.push(_close_n(depth));
        cb = t.b; ci = t.i; cu = t.u; csz = t.sz; ccol = t.col;
        const [opened, d] = _open(cb, ci, cu, csz, ccol);
        depth = d;
        result.push(opened);
      }
      let ch = t.char;
      if (sp[ch] !== undefined) ch = sp[ch];
      result.push(ch);
    }
    if (depth) result.push(_close_n(depth));
    return result.join("");
  }
}

// =====================================================================
// rich_sub — port של פונקציה ב-Python כולל char_to_token_pos
// =====================================================================

export function rich_sub(pattern, repl_func, rich_text, flags) {
  const text = rich_text.get_text();
  // flags: כברירת מחדל None; "i" → ignoreCase; "s" → dotAll
  let jsFlags = "g";
  if (flags && flags.ignoreCase) jsFlags += "i";
  if (flags && flags.dotAll)     jsFlags += "s";
  if (flags && flags.multiline)  jsFlags += "m";

  // regex עברי כעת ב-JS — תומך ב-\d, \s, וכו׳
  const re = pattern instanceof RegExp ? new RegExp(pattern.source, jsFlags)
           : new RegExp(pattern, jsFlags);
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, match: m });
    if (m[0].length === 0) re.lastIndex++;
  }
  if (!matches.length) return rich_text;

  // PR #45 fix — char_to_token_pos: כי is_raw_latex token יכול להיות רב-תווי
  function char_to_token_pos(char_pos) {
    let token_pos = 0;
    let current_char_pos = 0;
    for (let i = 0; i < rich_text.tokens.length; i++) {
      const tok = rich_text.tokens[i];
      if (current_char_pos >= char_pos) return i;
      current_char_pos += tok.char.length;
      token_pos = i + 1;
    }
    return token_pos;
  }

  const new_tokens = [];
  let last_token_idx = 0;
  for (const m2 of matches) {
    const start_token_idx = char_to_token_pos(m2.start);
    const end_token_idx = char_to_token_pos(m2.end);
    for (let k = last_token_idx; k < start_token_idx; k++) new_tokens.push(rich_text.tokens[k]);
    const repl = repl_func(m2.match, rich_text);
    for (const ch of repl) new_tokens.push(new CharToken(ch, false, false, false, 0, "", true));
    last_token_idx = end_token_idx;
  }
  for (let k = last_token_idx; k < rich_text.tokens.length; k++) new_tokens.push(rich_text.tokens[k]);
  return new RichText(new_tokens);
}

// =====================================================================
// XML helpers — תחליפים ל-ElementTree
// =====================================================================

const XMLNS_W_PREFIX = `{${WNS}}`;

function getAttrW(el, name) {
  if (!el || !el.getAttributeNS) return null;
  return el.getAttributeNS(WNS, name);
}

function* iterAll(el) {
  // tolerant מקבל element או array
  if (!el) return;
  yield el;
  const stack = [el];
  while (stack.length) {
    const cur = stack.pop();
    const children = cur.children || [];
    // יש לרוץ קדימה כדי לשמר סדר preorder כמו ב-Python's element.iter()
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    for (const ch of children) yield ch;
  }
}

// findall שווה ערך ל-`.//{ns}tag`
function findAll(root, tag) {
  if (!root || !root.getElementsByTagNameNS) return [];
  return Array.from(root.getElementsByTagNameNS(WNS, tag));
}

// find direct child
function findChild(el, tag) {
  if (!el) return null;
  for (const ch of (el.children || [])) {
    if (ch.namespaceURI === WNS && ch.localName === tag) return ch;
  }
  return null;
}

function findDeep(el, tag) {
  if (!el || !el.getElementsByTagNameNS) return null;
  const r = el.getElementsByTagNameNS(WNS, tag);
  return r.length ? r[0] : null;
}

function localTag(el) {
  // האם זה אלמנט WNS עם localName tag?
  return el && el.namespaceURI === WNS ? el.localName : null;
}

// =====================================================================
// _extract_rich + _plain
// =====================================================================

export function _extract_rich_orig(element, ns_w) {
  const rich = new RichText();
  let cb = false, ci = false, cu = false, csz = 0, ccol = "";
  // Python's element.iter() — preorder שורש ואז כל הצאצאים
  for (const child of iterAll(element)) {
    const lname = localTag(child);
    if (lname === 'r') {
      cb = ci = cu = false; csz = 0; ccol = "";
      const rPr = findChild(child, 'rPr');
      if (rPr) {
        for (const tag of ['b', 'bCs']) {
          const n = findChild(rPr, tag);
          if (n) {
            const v = getAttrW(n, 'val');
            if (v === null || (v !== '0' && v !== 'false')) cb = true;
          }
        }
        for (const tag of ['i', 'iCs']) {
          const n = findChild(rPr, tag);
          if (n) {
            const v = getAttrW(n, 'val');
            if (v === null || (v !== '0' && v !== 'false')) ci = true;
          }
        }
        const un = findChild(rPr, 'u');
        if (un) {
          const v = getAttrW(un, 'val') || 'none';
          if (v !== 'none' && v !== 'false' && v !== '0') cu = true;
        }
        // v11.36 — szCs / sz
        for (const tag of ['szCs', 'sz']) {
          const sn = findChild(rPr, tag);
          if (sn) {
            const v = getAttrW(sn, 'val') || '';
            if (v && /^\d+$/.test(v)) { csz = parseInt(v, 10); break; }
          }
        }
        // v11.36 — color
        const cn = findChild(rPr, 'color');
        if (cn) {
          const v = getAttrW(cn, 'val') || '';
          if (v && v !== 'auto' && /^[0-9A-Fa-f]{6}$/.test(v)) ccol = v.toUpperCase();
        }
      }
    } else if (lname === 't' && child.textContent) {
      for (const ch of child.textContent) rich.append(ch, cb, ci, cu, csz, ccol);
    } else if (lname === 'br') {
      rich.append('\\newline{}', cb, ci, cu, csz, ccol, true);
    }
  }
  return rich;
}

export function _plain(element, ns_w) {
  if (!element) return '';
  const ts = (element.getElementsByTagNameNS && element.getElementsByTagNameNS(WNS, 't')) || [];
  let s = '';
  for (const t of ts) s += t.textContent || '';
  return s;
}

// =====================================================================
// _extract_rich_with_html — port של ההרחבה ב-PR #11.38
// =====================================================================

const HTML_TAG_MAX_LEN = 40;

export function _extract_rich_with_html(element, ns_w) {
  const rich = _extract_rich_orig(element, ns_w);

  // (feature_gate ל-HTML — ברירת מחדל true; אין pywebview ב-browser)

  const text = rich.get_text();
  if (!text.includes('<')) return rich;

  const new_tokens = [];
  const tokens = rich.tokens;
  const n = tokens.length;

  const state_stack = [];
  let current_state = { b: false, i: false, u: false, col: '', sz: 0 };

  function _update_state() {
    const res = { b: false, i: false, u: false, col: '', sz: 0 };
    for (const st of state_stack) {
      if (st.b) res.b = true;
      if (st.i) res.i = true;
      if (st.u) res.u = true;
      if (st.col) res.col = st.col;
      if (st.sz) res.sz = st.sz;
    }
    return res;
  }

  let i = 0;
  while (i < n) {
    if (tokens[i].char === '<' && !tokens[i].is_raw_latex) {
      let j = i + 1;
      let tag_str = '';
      const _scan_cap = Math.min(n, i + 1 + HTML_TAG_MAX_LEN);
      while (j < _scan_cap && tokens[j].char !== '>') {
        tag_str += tokens[j].char;
        j++;
      }

      if (j < _scan_cap && tokens[j].char === '>') {
        const tag_full = tag_str.trim().toLowerCase();
        let is_tag = false;

        // Close tags
        if (tag_full === '/b' || tag_full === '/strong') {
          for (let k = state_stack.length - 1; k >= 0; k--) {
            if (state_stack[k].b) { state_stack.splice(k, 1); break; }
          }
          current_state = _update_state(); is_tag = true;
        } else if (tag_full === '/i' || tag_full === '/em') {
          for (let k = state_stack.length - 1; k >= 0; k--) {
            if (state_stack[k].i) { state_stack.splice(k, 1); break; }
          }
          current_state = _update_state(); is_tag = true;
        } else if (tag_full === '/u') {
          for (let k = state_stack.length - 1; k >= 0; k--) {
            if (state_stack[k].u) { state_stack.splice(k, 1); break; }
          }
          current_state = _update_state(); is_tag = true;
        } else if (tag_full === '/font' || tag_full === '/span') {
          for (let k = state_stack.length - 1; k >= 0; k--) {
            if ('col' in state_stack[k] || 'sz' in state_stack[k]) {
              state_stack.splice(k, 1); break;
            }
          }
          current_state = _update_state(); is_tag = true;
        }
        // Open tags
        else if (tag_full === 'b' || tag_full === 'strong') {
          state_stack.push({ b: true });
          current_state = _update_state(); is_tag = true;
        } else if (tag_full === 'i' || tag_full === 'em') {
          state_stack.push({ i: true });
          current_state = _update_state(); is_tag = true;
        } else if (tag_full === 'u') {
          state_stack.push({ u: true });
          current_state = _update_state(); is_tag = true;
        } else if (tag_full === 'br' || tag_full === 'br/' || tag_full === 'br /') {
          new_tokens.push(new CharToken('\\newline{}',
            current_state.b, current_state.i, current_state.u,
            current_state.sz, current_state.col, true));
          is_tag = true;
        } else if (tag_full.startsWith('font ') || tag_full.startsWith('span ')) {
          const st = {};
          const col_m = tag_str.match(/color\s*[=:]\s*['"]?#?([0-9a-fA-F]{6})/i);
          if (col_m) st.col = col_m[1].toUpperCase();
          const sz_m = tag_str.match(/font-size\s*:\s*(\d+)pt/i);
          if (sz_m) st.sz = parseInt(sz_m[1], 10) * 2;
          if (Object.keys(st).length) {
            state_stack.push(st);
            current_state = _update_state();
            is_tag = true;
          }
        }

        if (is_tag) { i = j + 1; continue; }
      }
    }

    const t = tokens[i];
    const t_b = t.b || current_state.b;
    const t_i = t.i || current_state.i;
    const t_u = t.u || current_state.u;
    const t_sz = t.sz || current_state.sz;
    const t_col = t.col || current_state.col;
    new_tokens.push(new CharToken(t.char, t_b, t_i, t_u, t_sz, t_col, t.is_raw_latex));
    i++;
  }

  return new RichText(new_tokens);
}

// alias — ב-Python שוטף `_extract_rich = _extract_rich_with_html`
export const _extract_rich = _extract_rich_with_html;

// =====================================================================
// docx loading + read_*
// =====================================================================

// helper: טוען DOCX מ-File / Blob / ArrayBuffer ומחזיר { read(name) → Promise<string> }
// משתמש ב-DecompressionStream + Zip parser פשוט.
// בגלל שלא נבנה כאן unzip מאפס, מטעינים JSZip dynamically כשזמין; אחרת נדרש שה-loader יספק docx zip.

async function _loadDocxZip(input) {
  // input יכול להיות: File / Blob / ArrayBuffer / { read(name) → Promise<string|Uint8Array> }
  if (input && typeof input.read === 'function') return input;

  let buf;
  if (input instanceof ArrayBuffer) buf = input;
  else if (input && typeof input.arrayBuffer === 'function') buf = await input.arrayBuffer();
  else if (input instanceof Uint8Array) buf = input.buffer;
  else throw new Error('docx input not recognised');

  // dynamic import ל-JSZip — לא תלות חובה בכל פרויקט שמשתמש במודול.
  let JSZipMod = null;
  try {
    JSZipMod = (await import("jszip")).default || (await import("jszip"));
  } catch (e) {
    if (typeof window !== 'undefined' && window.JSZip) JSZipMod = window.JSZip;
    else throw new Error('JSZip is required for DOCX parsing in the browser. Install jszip.');
  }
  const zip = await JSZipMod.loadAsync(buf);
  return {
    namelist: () => Object.keys(zip.files),
    read: async (name) => {
      const f = zip.file(name);
      if (!f) throw new Error('KeyError: ' + name);
      return f.async('string');
    },
    readBytes: async (name) => {
      const f = zip.file(name);
      if (!f) throw new Error('KeyError: ' + name);
      return f.async('uint8array');
    },
  };
}

function _parseXml(s) {
  // ב-Browser — DOMParser; ב-Node — תלות ב-DOMParser shim.
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser not available — running outside browser?');
  }
  const doc = new DOMParser().parseFromString(s, 'application/xml');
  return doc.documentElement;
}

async function _read_notes_xml(zip, xml_file, note_tag) {
  const notes = {};
  try {
    const data = await zip.read(xml_file);
    const root = _parseXml(data);
    const all = findAll(root, note_tag);
    for (const note of all) {
      const nid = getAttrW(note, 'id');
      // v11.51.4 — guard against missing/None id
      if (nid === null || nid === undefined) continue;
      const nidNum = parseInt(nid, 10);
      if (Number.isNaN(nidNum) || nidNum <= 0) continue;
      notes[nid] = _extract_rich(note, WNS);
    }
  } catch (e) { /* KeyError or other — return {} */ }
  return notes;
}

export async function read_footnotes(input) {
  const zip = await _loadDocxZip(input);
  return _read_notes_xml(zip, 'word/footnotes.xml', 'footnote');
}
export async function read_endnotes(input) {
  const zip = await _loadDocxZip(input);
  return _read_notes_xml(zip, 'word/endnotes.xml', 'endnote');
}
export async function read_comments(input) {
  const zip = await _loadDocxZip(input);
  const notes = {};
  try {
    const data = await zip.read('word/comments.xml');
    const root = _parseXml(data);
    const all = findAll(root, 'comment');
    for (const note of all) {
      const nid = getAttrW(note, 'id');
      notes[nid] = _extract_rich(note, WNS);
    }
  } catch (e) { /* */ }
  return notes;
}

// =====================================================================
// find_all_note_sources
// =====================================================================

export async function find_all_note_sources(input) {
  const zip = await _loadDocxZip(input);
  const sources = [];

  async function _scan(xml_file, note_tag, src_type, heb) {
    const local = [];
    try {
      const data = await zip.read(xml_file);
      const root = _parseXml(data);
      let all_notes;
      if (note_tag === 'comment') {
        all_notes = findAll(root, note_tag).filter(n => {
          const v = getAttrW(n, 'id');
          const nv = parseInt(v === null ? '-1' : v, 10);
          return !Number.isNaN(nv) && nv >= 0;
        });
      } else {
        all_notes = findAll(root, note_tag).filter(n => {
          const v = getAttrW(n, 'id');
          const nv = parseInt(v === null ? '0' : v, 10);
          return !Number.isNaN(nv) && nv > 0;
        });
      }
      const markers = {};
      let unmarked = 0;
      for (const note of all_notes) {
        const text = _plain(note, WNS);
        const m = text.match(/@(\d+)/);
        if (m) markers[m[1]] = (markers[m[1]] || 0) + 1;
        else unmarked++;
      }
      const sortedKeys = Object.keys(markers).sort();
      for (const m of sortedKeys) {
        local.push({
          id: `${src_type}_@${m}`,
          source_type: src_type,
          marker: m,
          has_at: true,
          label: `${heb} @${m}`,
          count: markers[m],
          icon: SOURCE_LABELS[src_type],
        });
      }
      if (unmarked > 0) {
        local.push({
          id: `${src_type}_none`,
          source_type: src_type,
          marker: null,
          has_at: false,
          label: `${heb} ללא סימון (${unmarked})`,
          count: unmarked,
          icon: SOURCE_LABELS[src_type],
        });
      }
    } catch (e) { /* skip */ }
    return local;
  }

  for (const x of await _scan('word/footnotes.xml', 'footnote', SOURCE_FOOTNOTE, 'שוליים')) sources.push(x);
  for (const x of await _scan('word/endnotes.xml',  'endnote',  SOURCE_ENDNOTE,  'סיום')) sources.push(x);
  for (const x of await _scan('word/comments.xml',  'comment',  SOURCE_COMMENT,  'בלון')) sources.push(x);

  try {
    const doc_xml = await zip.read('word/document.xml');
    const doc_m = new Set();
    const reAll = /@(\d+)/g;
    let mm;
    while ((mm = reAll.exec(doc_xml)) !== null) doc_m.add(mm[1]);
    const exist = new Set(sources.filter(s => s.marker).map(s => s.marker));
    const sortedDiff = Array.from(doc_m).filter(x => !exist.has(x)).sort();
    for (const m of sortedDiff) {
      const reC = new RegExp('@' + m, 'g');
      const c = (doc_xml.match(reC) || []).length;
      sources.push({
        id: `inline_@${m}`,
        source_type: SOURCE_FOOTNOTE,
        marker: m,
        has_at: true,
        label: `inline @${m}`,
        count: c,
        icon: '\u{1F4DD} שוליים',
      });
    }
  } catch (e) { /* */ }

  return sources;
}

// =====================================================================
// load_external_notes
// =====================================================================

export async function load_external_notes(ext_file, ext_marker) {
  const notes = [];
  try {
    const zip = await _loadDocxZip(ext_file);
    const doc_xml = await zip.read('word/document.xml');
    const root = _parseXml(doc_xml);
    let current = new RichText();
    let collecting = false;
    const escMarker = ext_marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re_marker = new RegExp(escMarker + '\\s*:?\\s*');
    const allP = findAll(root, 'p');
    for (const para of allP) {
      const pt = _plain(para, WNS);
      if (pt.includes(ext_marker)) {
        if (collecting && current.get_text().trim()) notes.push(current);
        current = new RichText();
        collecting = true;
        const pr = _extract_rich(para, WNS);
        const plain = pr.get_text();
        const mm = plain.match(re_marker);
        current = mm ? new RichText(pr.tokens.slice((mm.index || 0) + mm[0].length)) : pr;
      } else if (collecting) {
        const pr = _extract_rich(para, WNS);
        if (pr.get_text().trim()) {
          current.append(' ', false, false, false, 0, '', true);
          current.extend(pr);
        }
      }
    }
    if (collecting && current.get_text().trim()) notes.push(current);

    for (const [xf, nt] of [['word/footnotes.xml', 'footnote'], ['word/endnotes.xml', 'endnote']]) {
      try {
        const d = await zip.read(xf);
        const r = _parseXml(d);
        for (const n of findAll(r, nt)) {
          const idAttr = getAttrW(n, 'id');
          if (parseInt(idAttr || '0', 10) <= 0) continue;
          const t = _plain(n, WNS);
          if (t.includes(ext_marker)) {
            const nr = _extract_rich(n, WNS);
            const p = nr.get_text();
            const mm2 = p.match(re_marker);
            notes.push(mm2 ? new RichText(nr.tokens.slice((mm2.index || 0) + mm2[0].length)) : nr);
          }
        }
      } catch (e) { /* */ }
    }
  } catch (e) {
    console.error('Error loading external:', e);
  }
  return notes;
}

// =====================================================================
// styles / sections / headers / titles / parallel
// =====================================================================

export async function find_all_styles_in_docx(input) {
  const styles = {};
  try {
    const zip = await _loadDocxZip(input);
    const root = _parseXml(await zip.read('word/styles.xml'));
    for (const style of findAll(root, 'style')) {
      const nn = findChild(style, 'name');
      if (nn) {
        const sn = getAttrW(nn, 'val');
        let fn = 'Arial';
        const rPr = findDeep(style, 'rPr');
        if (rPr) {
          const rf = findChild(rPr, 'rFonts');
          if (rf) {
            fn = getAttrW(rf, 'cs') || getAttrW(rf, 'ascii') || 'Arial';
          }
        }
        if (sn) styles[sn] = fn;
      }
    }
  } catch (e) { /* */ }
  return styles;
}

export async function find_all_styles_full(input) {
  const styles = {};
  try {
    const zip = await _loadDocxZip(input);
    const root = _parseXml(await zip.read('word/styles.xml'));
    for (const style of findAll(root, 'style')) {
      const nn = findChild(style, 'name');
      if (!nn) continue;
      const sn = getAttrW(nn, 'val');
      const info = {
        font: 'Arial',
        size_pt: null,
        bold: false,
        italic: false,
        space_before_pt: null,
        space_after_pt: null,
        line_spacing: null,
      };
      const rPr = findChild(style, 'rPr');
      if (rPr) {
        const rf = findChild(rPr, 'rFonts');
        if (rf) info.font = getAttrW(rf, 'cs') || getAttrW(rf, 'ascii') || 'Arial';
        let sz = findChild(rPr, 'szCs');
        if (!sz) sz = findChild(rPr, 'sz');
        if (sz) {
          try {
            const half_points = parseInt(getAttrW(sz, 'val') || '0', 10);
            info.size_pt = half_points / 2.0;
          } catch (e) { /* */ }
        }
        const b = findChild(rPr, 'b');
        if (b) {
          const v = getAttrW(b, 'val') || '1';
          if (v !== '0' && v !== 'false') info.bold = true;
        }
        const i = findChild(rPr, 'i');
        if (i) {
          const v = getAttrW(i, 'val') || '1';
          if (v !== '0' && v !== 'false') info.italic = true;
        }
      }
      const pPr = findChild(style, 'pPr');
      if (pPr) {
        const sp = findChild(pPr, 'spacing');
        if (sp) {
          const before = getAttrW(sp, 'before');
          const after = getAttrW(sp, 'after');
          if (before) {
            try { info.space_before_pt = parseInt(before, 10) / 20.0; } catch (e) { /* */ }
          }
          if (after) {
            try { info.space_after_pt = parseInt(after, 10) / 20.0; } catch (e) { /* */ }
          }
          const line = getAttrW(sp, 'line');
          const line_rule = getAttrW(sp, 'lineRule') || 'auto';
          if (line) {
            try {
              if (line_rule === 'auto') info.line_spacing = parseInt(line, 10) / 240.0;
              else info.line_spacing = parseInt(line, 10) / 20.0 / 12.0;
            } catch (e) { /* */ }
          }
        }
      }
      if (sn) styles[sn] = info;
    }
  } catch (e) { /* */ }
  return styles;
}

export async function find_sections_in_docx(input) {
  const sections = [];
  try {
    const zip = await _loadDocxZip(input);
    const root = _parseXml(await zip.read('word/document.xml'));
    const body = findDeep(root, 'body');
    if (!body) return sections;
    let section_idx = 0;
    let current_first = null;
    // direct children w:p of body
    const directPs = [];
    for (const ch of body.children) {
      if (ch.namespaceURI === WNS && ch.localName === 'p') directPs.push(ch);
    }
    for (const para of directPs) {
      const t = _plain(para, WNS).trim();
      if (t && current_first === null) current_first = t.slice(0, 60);
      const pPr = findChild(para, 'pPr');
      if (pPr) {
        const sectPr = findChild(pPr, 'sectPr');
        if (sectPr) {
          sections.push([section_idx, current_first || `מקטע ${section_idx + 1}`]);
          section_idx++;
          current_first = null;
        }
      }
    }
    const body_sectPr = findChild(body, 'sectPr');
    if (body_sectPr || current_first) {
      sections.push([section_idx, current_first || `מקטע ${section_idx + 1}`]);
    }
  } catch (e) { /* */ }
  return sections;
}

export async function extract_headers_footers(input) {
  const result = { header: '', footer: '' };
  try {
    const zip = await _loadDocxZip(input);
    for (const name of zip.namelist()) {
      if (name.startsWith('word/header') && name.endsWith('.xml')) {
        if (result.header) continue;
        try {
          const root = _parseXml(await zip.read(name));
          let text = '';
          for (const t of root.getElementsByTagNameNS(WNS, 't')) text += t.textContent || '';
          text = text.trim();
          if (text) result.header = text;
        } catch (e) { /* */ }
      } else if (name.startsWith('word/footer') && name.endsWith('.xml')) {
        if (result.footer) continue;
        try {
          const root = _parseXml(await zip.read(name));
          let text = '';
          for (const t of root.getElementsByTagNameNS(WNS, 't')) text += t.textContent || '';
          text = text.trim();
          if (text) result.footer = text;
        } catch (e) { /* */ }
      }
    }
  } catch (e) { /* */ }
  return result;
}

export async function extract_doc_titles(input) {
  let title = '', subtitle = '';
  try {
    const zip = await _loadDocxZip(input);
    const root = _parseXml(await zip.read('word/document.xml'));
    const paras = [];
    for (const para of findAll(root, 'p')) {
      const t = _plain(para, WNS);
      if (t.trim()) paras.push(t.trim());
      if (paras.length >= 2) break;
    }
    if (paras.length) title = paras[0];
    if (paras.length > 1) subtitle = paras[1];
  } catch (e) { /* */ }
  return [title, subtitle];
}

export async function extract_parallel_paragraphs(input) {
  const paragraphs = [];
  try {
    const zip = await _loadDocxZip(input);
    const root = _parseXml(await zip.read('word/document.xml'));
    for (const para of findAll(root, 'p')) {
      const pr = _extract_rich(para, WNS);
      const text = pr.to_latex().trim();
      if (text) paragraphs.push(text);
    }
  } catch (e) {
    console.error('Error loading parallel text:', e);
  }
  return paragraphs;
}

// =====================================================================
// _balance_braces / _clean_latex
// =====================================================================

export function _balance_braces(s) {
  let depth = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length && (s[i + 1] === '{' || s[i + 1] === '}')) {
      i += 2; continue;
    }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    i++;
  }
  if (depth < 0) s = '{'.repeat(-depth) + s;
  else if (depth > 0) s = s + '}'.repeat(depth);
  return s;
}

export function _clean_latex(s) {
  return s.replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\\par/g, ' ').trim().replace(/\s+/g, ' ');
}

// =====================================================================
// collect_stream_as_paragraphs
// =====================================================================

export async function collect_stream_as_paragraphs(source_input, source_type, marker) {
  let notes_dict;
  if (source_type === SOURCE_FOOTNOTE) notes_dict = await read_footnotes(source_input);
  else if (source_type === SOURCE_ENDNOTE) notes_dict = await read_endnotes(source_input);
  else if (source_type === SOURCE_COMMENT) notes_dict = await read_comments(source_input);
  else return [];
  const paragraphs = [];
  const ids = Object.keys(notes_dict).sort((a, b) => {
    const av = /^\d+$/.test(a) ? parseInt(a, 10) : 0;
    const bv = /^\d+$/.test(b) ? parseInt(b, 10) : 0;
    return av - bv;
  });
  for (const nid of ids) {
    const note_rich = notes_dict[nid];
    const text = note_rich.get_text();
    if (marker) {
      if (!new RegExp('@' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(text)) continue;
    } else {
      if (/@\d+/.test(text)) continue;
    }
    let latex = note_rich.to_latex();
    if (marker) {
      const re = new RegExp('^.*?@' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*');
      latex = latex.replace(re, '');
    }
    const cleaned = _balance_braces(_clean_latex(latex));
    if (cleaned) paragraphs.push(cleaned);
  }
  return paragraphs;
}

// =====================================================================
// _extract_opening_segment
// =====================================================================

export function _extract_opening_segment(content, target, count) {
  let i = 0;
  while (i < content.length && /\s/.test(content[i])) i++;
  if (i >= content.length) return [null, null, null];
  const prefix = content.slice(0, i);
  const start = i;

  // leading \textbf{...} (or textit/emph/underline/ravtextbf)
  const style_match = content.slice(i).match(/^\\(textbf|ravtextbf|textit|emph|underline)\{/);
  if (style_match) {
    const cmd = style_match[1];
    const inner_start = i + style_match[0].length;
    let depth = 1;
    let j = inner_start;
    while (j < content.length && depth > 0) {
      if (content[j] === '\\' && j + 1 < content.length) { j += 2; continue; }
      if (content[j] === '{') depth++;
      else if (content[j] === '}') { depth--; if (depth === 0) break; }
      j++;
    }
    if (depth === 0) {
      const inner = content.slice(inner_start, j);
      const after = content.slice(j + 1);
      const [inner_prefix, inner_segment, inner_suffix] = _extract_opening_segment(inner, target, count);
      if (inner_segment !== null) {
        const wrapped_segment = `\\${cmd}{${inner_segment}}`;
        let new_suffix;
        if (inner_suffix.trim()) new_suffix = `\\${cmd}{${inner_suffix}}${after}`;
        else new_suffix = after;
        return [prefix + inner_prefix, wrapped_segment, new_suffix];
      }
    }
  }

  function _advance_over_atom(pos) {
    if (pos >= content.length) return pos;
    const ch = content[pos];
    if (ch === '\\') {
      let j = pos + 1;
      if (j < content.length && /[A-Za-z]/.test(content[j])) {
        while (j < content.length && /[A-Za-z]/.test(content[j])) j++;
        if (j < content.length && content[j] === '*') j++;
      } else {
        j++;
      }
      while (j < content.length && (content[j] === '[' || content[j] === '{')) {
        if (content[j] === '[') {
          j++;
          while (j < content.length && content[j] !== ']') j++;
          if (j < content.length) j++;
        } else if (content[j] === '{') {
          let depth = 1;
          j++;
          while (j < content.length && depth > 0) {
            if (content[j] === '\\' && j + 1 < content.length) { j += 2; continue; }
            if (content[j] === '{') depth++;
            else if (content[j] === '}') depth--;
            j++;
          }
        }
      }
      return j;
    } else if (ch === '{') {
      let depth = 1;
      let j = pos + 1;
      while (j < content.length && depth > 0) {
        if (content[j] === '\\' && j + 1 < content.length) { j += 2; continue; }
        if (content[j] === '{') depth++;
        else if (content[j] === '}') depth--;
        j++;
      }
      return j;
    } else {
      return pos + 1;
    }
  }

  function _read_word(pos) {
    if (pos >= content.length) return pos;
    const ch = content[pos];
    if (ch === '\\' || ch === '{') return _advance_over_atom(pos);
    while (pos < content.length) {
      const c = content[pos];
      if (/\s/.test(c) || c === '\\' || c === '{' || c === '}') break;
      pos++;
    }
    return pos;
  }

  if (target === 'אות' || target === 'Letter') {
    const n_chars = Math.max(1, count);
    let j = i;
    while (j < content.length) {
      if (content[j] === '\\') { j = _advance_over_atom(j); continue; }
      if (content[j] === '{') { j++; continue; }
      break;
    }
    if (j >= content.length) return [null, null, null];
    const seg_start = j;
    let taken = 0;
    while (taken < n_chars && j < content.length) {
      if (content[j] === '\\') { j = _advance_over_atom(j); continue; }
      if (content[j] === '{' || content[j] === '}') { j++; continue; }
      if (/\s/.test(content[j])) break;
      j++;
      taken++;
    }
    if (taken === 0) return [null, null, null];
    return [content.slice(0, seg_start), content.slice(seg_start, j), content.slice(j)];
  }

  // word mode
  const n_words = (target === 'מילים' || target === 'NWords') ? Math.max(1, count) : 1;
  let pos = i;
  let taken = 0;
  while (pos < content.length && taken < n_words) {
    const new_pos = _read_word(pos);
    if (new_pos <= pos) break;
    pos = new_pos;
    taken++;
    if (taken < n_words) {
      while (pos < content.length && /\s/.test(content[pos])) pos++;
    }
  }
  if (pos <= start) return [null, null, null];
  return [prefix, content.slice(start, pos), content.slice(pos)];
}

// =====================================================================
// _is_orphan_note / _mk_fn / _mk_sidenote / _note_to_latex
// =====================================================================

export function _is_orphan_note(content) {
  const cleaned = content.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})*/g, ' ');
  return cleaned.trim().length < 80;
}

export function _mk_sidenote(position, font_cmd, content) {
  const cmd = SIDENOTE_CMD_MAP[position] || '\\ledsidenote';
  return `${cmd}{\\RL{${font_cmd} ${content}}}`;
}

export function _mk_fn(series, content, opw, fli, layout) {
  if (!series) series = 'A';
  layout = layout || 'normal';

  let opw_applied = false;
  if (opw && opw.enabled) {
    const skip_orphan = !!opw.skip_orphan;
    if (!(skip_orphan && _is_orphan_note(content))) {
      const target = opw.target || 'מילה';
      let cnt;
      try { cnt = parseInt(opw.count || '1', 10); if (Number.isNaN(cnt)) cnt = 1; }
      catch (e) { cnt = 1; }
      const [prefix, segment, suffix] = _extract_opening_segment(content, target, cnt);
      if (segment !== null) {
        const pos = opw.position || 'מוגבהת';
        const macro = (pos === 'נפתחת' || pos === 'Dropped')
          ? `\\opwnotedropped${series}` : `\\opwnoteraised${series}`;
        content = `${macro}{${segment}}${prefix}${suffix}`;
        opw_applied = true;
      }
    }
  }

  if (fli && fli.enabled) {
    let fli_size;
    try { fli_size = parseFloat(fli.size || '1.5'); if (Number.isNaN(fli_size)) fli_size = 1.5; }
    catch (e) { fli_size = 1.5; }
    if (opw_applied) {
      content = `\\leavevmode\\hskip ${fli_size}em\\relax ${content}`;
    } else {
      content = `\\leavevmode\\hskip ${fli_size}em\\relax ${content}`;
    }
  }

  let par_cmd;
  if (layout === 'paragraph') {
    par_cmd = '';
  } else {
    par_cmd =
      '\\parfillskip=0pt plus 1fil\\relax' +
      '\\lastlinefit=0\\relax' +
      '\\unskip\\null\\par' +
      '\\setbox0=\\lastbox' +
      '\\setbox1=\\hbox{\\unhbox0}' +
      '\\noindent\\hbox to\\hsize{\\hfil\\box1\\hfil}' +
      '\\par';
  }
  const _clset_cmd = '';
  return `\\footnote${series}{\\setRTL${_clset_cmd}\\streamfont${series}\\strut ${content}${par_cmd}}`;
}

export function _note_to_latex(note_rich, sid, sd) {
  sd[sid].count = (sd[sid].count || 0) + 1;
  const plain = note_rich.get_text();
  const marker = sd[sid].marker;
  let cr;
  if (marker) {
    const escM = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^.*?@' + escM + '\\s*:?\\s*');
    const pm = plain.match(re);
    cr = pm ? new RichText(note_rich.tokens.slice(pm[0].length)) : note_rich;
  } else {
    cr = note_rich;
  }
  const cleaned = _clean_latex(cr.to_latex());
  if (sd[sid].source_type === SOURCE_SIDENOTE) {
    const pos = sd[sid].position || 'right';
    const font_cmd = sd[sid].sidenote_font_cmd || '';
    return _mk_sidenote(pos, font_cmd, cleaned);
  }
  const opw = sd[sid].opw;
  const fli = sd[sid].fli;
  const layout = sd[sid].layout || 'normal';
  return _mk_fn(sd[sid].series, cleaned, opw, fli, layout);
}

// =====================================================================
// extract_and_process — ליבת התרגום (port מלא)
// =====================================================================

export async function extract_and_process(source_input, sd, ext_map) {
  if (!ext_map) ext_map = {};
  const zip = await _loadDocxZip(source_input);

  const fn_dict = await read_footnotes(zip);
  const en_dict = await read_endnotes(zip);
  const cm_dict = await read_comments(zip);

  const fn_m2s = {}, en_m2s = {}, cm_m2s = {};
  let fn_none = null, en_none = null, cm_none = null;
  const ext_t2s = {}, cust_m2s = {};
  const sn_fn_m2s = {}, sn_en_m2s = {}, sn_cm_m2s = {};
  let sn_fn_none = null, sn_en_none = null, sn_cm_none = null;

  for (const sid of Object.keys(sd)) {
    const s = sd[sid];
    const st = s.source_type || SOURCE_FOOTNOTE;
    const m = s.marker;
    const base = s.base_source || SOURCE_FOOTNOTE;
    if (st === SOURCE_SIDENOTE || st === SOURCE_PARALLEL) {
      if (base === SOURCE_FOOTNOTE) {
        if (m) sn_fn_m2s[m] = sid; else sn_fn_none = sid;
      } else if (base === SOURCE_ENDNOTE) {
        if (m) sn_en_m2s[m] = sid; else sn_en_none = sid;
      } else if (base === SOURCE_COMMENT) {
        if (m) sn_cm_m2s[m] = sid; else sn_cm_none = sid;
      }
    } else if (st === SOURCE_FOOTNOTE) {
      if (m) fn_m2s[m] = sid; else fn_none = sid;
    } else if (st === SOURCE_ENDNOTE) {
      if (m) en_m2s[m] = sid; else en_none = sid;
    } else if (st === SOURCE_COMMENT) {
      if (m) cm_m2s[m] = sid; else cm_none = sid;
    } else if (st === SOURCE_EXTERNAL) {
      const tm = s.target_marker;
      if (tm) ext_t2s[tm] = sid;
    } else if (st === SOURCE_CUSTOM) {
      const cp = s.custom_pattern || '';
      if (cp) cust_m2s[cp] = sid;
    }
  }
  Object.assign(fn_m2s, sn_fn_m2s);
  Object.assign(en_m2s, sn_en_m2s);
  Object.assign(cm_m2s, sn_cm_m2s);
  if (sn_fn_none && !fn_none) fn_none = sn_fn_none;
  if (sn_en_none && !en_none) en_none = sn_en_none;
  if (sn_cm_none && !cm_none) cm_none = sn_cm_none;

  const first_note_seen = {};

  function _proc_ref(note_rich, m2s, none_sid, pr) {
    function _maybe_thin_space() {
      let has_text_before = false;
      if (pr.tokens.length) {
        const last = pr.tokens[pr.tokens.length - 1];
        if (!last.is_raw_latex && last.char) {
          const cc = last.char.charCodeAt(0);
          if (cc >= 0x0590 && cc <= 0x05FF) {
            pr.append('\\,', false, false, false, 0, '', true);
          }
        }
        for (const t of pr.tokens) {
          if (!t.is_raw_latex && t.char && !/\s/.test(t.char)) {
            has_text_before = true; break;
          }
        }
      }
      if (has_text_before) {
        pr.append('\\nolinebreak[3]', false, false, false, 0, '', true);
      }
    }

    const plain = note_rich.get_text();
    const mm = plain.match(/@(\d+)/);
    let target_sid = null;
    if (mm && (mm[1] in m2s)) target_sid = m2s[mm[1]];
    else if (none_sid && !mm) target_sid = none_sid;
    else if (Object.keys(sd).length) {
      for (const _sid of Object.keys(sd)) {
        const _s = sd[_sid];
        if (_s.source_type !== SOURCE_SIDENOTE && _s.source_type !== SOURCE_PARALLEL && _s.series) {
          target_sid = _sid; break;
        }
      }
      if (target_sid === null) target_sid = Object.keys(sd)[0];
    }

    if (target_sid === null) return false;

    if (sd[target_sid].first_note_as_title && !(target_sid in first_note_seen)) {
      first_note_seen[target_sid] = true;
      let title_text = note_rich.get_text();
      const mk = sd[target_sid].marker;
      if (mk) {
        const re = new RegExp('^.*?@' + mk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*');
        const pm = title_text.match(re);
        if (pm) title_text = title_text.slice(pm[0].length);
      }
      sd[target_sid].title = title_text.trim();
      return true;
    }

    const ls = _note_to_latex(note_rich, target_sid, sd);
    _maybe_thin_space();
    for (const c of ls) pr.append(c, false, false, false, 0, '', true);
    return true;
  }

  const root = _parseXml(await zip.read('word/document.xml'));
  let full = new RichText();
  for (const para of findAll(root, 'p')) {
    const pPr = findChild(para, 'pPr');
    let para_style_name = null;
    let para_align = null;
    if (pPr) {
      const pStyle_el = findChild(pPr, 'pStyle');
      if (pStyle_el) para_style_name = getAttrW(pStyle_el, 'val') || '';
      const jc_el = findChild(pPr, 'jc');
      if (jc_el) {
        const jc_val = getAttrW(jc_el, 'val') || '';
        if (jc_val === 'center' || jc_val === 'right' || jc_val === 'left') para_align = jc_val;
      }
    }
    let is_heading = false;
    let heading_level = 0;
    if (para_style_name) {
      const lname = para_style_name.toLowerCase();
      if (lname.startsWith('heading')) {
        is_heading = true;
        try {
          const num = parseInt(lname.replace('heading', '').trim() || '1', 10);
          heading_level = Number.isNaN(num) ? 1 : num;
        } catch (e) { heading_level = 1; }
      } else if (lname === 'title' || lname === 'subtitle') {
        is_heading = true;
        heading_level = 0;
      }
    }
    const pr = new RichText();
    let cb = false, ci = false, cu = false, csz = 0, ccol = '';
    for (const child of iterAll(para)) {
      const lname = localTag(child);
      if (lname === 'r') {
        cb = ci = cu = false; csz = 0; ccol = '';
        const rPr = findChild(child, 'rPr');
        if (rPr) {
          for (const tag of ['b', 'bCs']) {
            const n = findChild(rPr, tag);
            if (n) {
              const v = getAttrW(n, 'val');
              if (v === null || (v !== '0' && v !== 'false')) cb = true;
            }
          }
          for (const tag of ['i', 'iCs']) {
            const n = findChild(rPr, tag);
            if (n) {
              const v = getAttrW(n, 'val');
              if (v === null || (v !== '0' && v !== 'false')) ci = true;
            }
          }
          const un = findChild(rPr, 'u');
          if (un) {
            const v = getAttrW(un, 'val') || 'none';
            if (v !== 'none' && v !== 'false' && v !== '0') cu = true;
          }
          for (const tag of ['szCs', 'sz']) {
            const sn = findChild(rPr, tag);
            if (sn) {
              const v = getAttrW(sn, 'val') || '';
              if (v && /^\d+$/.test(v)) { csz = parseInt(v, 10); break; }
            }
          }
          const cn = findChild(rPr, 'color');
          if (cn) {
            const v = getAttrW(cn, 'val') || '';
            if (v && v !== 'auto' && /^[0-9A-Fa-f]{6}$/.test(v)) ccol = v.toUpperCase();
          }
        }
      } else if (lname === 't' && child.textContent) {
        for (const ch of child.textContent) pr.append(ch, cb, ci, cu, csz, ccol);
      } else if (lname === 'br') {
        pr.append('\\newline{}', cb, ci, cu, csz, ccol, true);
      } else if (lname === 'footnoteReference') {
        const fid = getAttrW(child, 'id');
        if (fid && (fid in fn_dict)) _proc_ref(fn_dict[fid].copy(), fn_m2s, fn_none, pr);
      } else if (lname === 'endnoteReference') {
        const eid = getAttrW(child, 'id');
        if (eid && (eid in en_dict)) _proc_ref(en_dict[eid].copy(), en_m2s, en_none, pr);
      } else if (lname === 'commentReference') {
        const cid = getAttrW(child, 'id');
        if (cid && (cid in cm_dict)) _proc_ref(cm_dict[cid].copy(), cm_m2s, cm_none, pr);
      }
    }
    if (pr.get_text().trim()) {
      if (is_heading) {
        const safe_style = (para_style_name || '')
          .replace(/\\/g, '').replace(/\{/g, '').replace(/\}/g, '')
          .replace(/\^/g, '').replace(/#/g, '').replace(/%/g, '').replace(/\$/g, '');
        full.append(`\\opwhdg{${safe_style}}{${heading_level}}{`, false, false, false, 0, '', true);
        full.extend(pr);
        full.append('}', false, false, false, 0, '', true);
      } else if (para_align === 'center') {
        full.append('{\\centering ', false, false, false, 0, '', true);
        full.extend(pr);
        full.append('\\par}', false, false, false, 0, '', true);
      } else if (para_align === 'left') {
        full.append('{\\raggedleft ', false, false, false, 0, '', true);
        full.extend(pr);
        full.append('\\par}', false, false, false, 0, '', true);
      } else {
        full.extend(pr);
      }
      full.append('\n', false, false, false, 0, '', true);
    }
  }

  // bracket loops on inline @markers
  for (const sid of Object.keys(sd)) {
    const s = sd[sid];
    const m = s.marker;
    if (!m) continue;
    const esc_m = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bracket_pairs = [
      ['\\[', '\\]'], ['\\{', '\\}'], ['\\(', '\\)'], ['<', '>'],
    ];
    for (const [opener, closer] of bracket_pairs) {
      const pat_br = opener + '\\s*@' + esc_m + '\\s*:?\\s*(.*?)' + closer;
      full = rich_sub(pat_br,
        ((s_) => (mt, rt) => _proc_inline(mt, rt, s_, sd))(sid),
        full, { dotAll: true });
    }
    const all_tags = Object.keys(sd).filter(k => sd[k].marker)
      .map(k => '@' + sd[k].marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const tags = all_tags || '\\n|$';
    const pat_nb = '@' + esc_m + '\\s*:?\\s*(.*?)(?=' + tags + '|\\n|$)';
    full = rich_sub(pat_nb,
      ((s_) => (mt, rt) => _proc_inline(mt, rt, s_, sd))(sid),
      full);
  }

  // CUSTOM patterns
  for (const cp of Object.keys(cust_m2s)) {
    const sid = cust_m2s[cp];
    const esc = cp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bracket_pairs = [
      ['\\[', '\\]'], ['\\{', '\\}'], ['\\(', '\\)'], ['<', '>'],
    ];
    for (const [opener, closer] of bracket_pairs) {
      const pat_br = opener + '\\s*' + esc + '\\s*:?\\s*(.*?)' + closer;
      full = rich_sub(pat_br,
        ((s_) => (mt, rt) => _proc_inline(mt, rt, s_, sd))(sid),
        full, { dotAll: true });
    }
    full = rich_sub(esc + '\\s*:?\\s*(.*?)(?=\\n|$)',
      ((s_) => (mt, rt) => _proc_inline(mt, rt, s_, sd))(sid),
      full);
  }

  // EXTERNAL streams
  for (const tm of Object.keys(ext_t2s)) {
    const sid = ext_t2s[tm];
    const ext_notes = ext_map[tm] || [];
    if (!ext_notes.length) continue;
    const text = full.get_text();
    const positions = [];
    const reAll = new RegExp('@' + tm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    let mm;
    while ((mm = reAll.exec(text)) !== null) positions.push(mm.index);
    for (let pi = positions.length - 1; pi >= 0; pi--) {
      if (pi >= ext_notes.length) continue;
      const pos = positions[pi];
      const me = pos + ('@' + tm).length;
      sd[sid].count = (sd[sid].count || 0) + 1;
      const cl = _clean_latex(ext_notes[pi].to_latex());
      const ls = _mk_fn(sd[sid].series, cl);
      const nt = full.tokens.slice(0, me);
      for (const c of ls) nt.push(new CharToken(c, false, false, false, 0, '', true));
      for (let kk = me; kk < full.tokens.length; kk++) nt.push(full.tokens[kk]);
      full = new RichText(nt);
    }
  }

  extract_and_process.first_note_problems = Object.keys(sd).filter(_sid =>
    sd[_sid].first_note_as_title && (_sid in first_note_seen) && (sd[_sid].count || 0) === 0
  );
  return full;
}

// =====================================================================
// _proc_inline
// =====================================================================

export function _proc_inline(match, rich_text, sid, sd) {
  sd[sid].count = (sd[sid].count || 0) + 1;
  // Group 1: positions of capture group
  // ב-JS אין start(group) באובייקט match — נחזור על חישוב position דרך indexOf.
  const full = match[0];
  const inner = match[1] || '';
  // נמצא את המיקום של inner בתוך full לקבלת offset יחסי
  const fullStart = match.index;
  const innerOffset = full.indexOf(inner);
  const s = fullStart + (innerOffset >= 0 ? innerOffset : 0);
  const e = s + inner.length;
  const cr = new RichText(rich_text.tokens.slice(s, e));
  return _mk_fn(sd[sid].series, _clean_latex(cr.to_latex()));
}

// =====================================================================
// count_notes_per_stream
// =====================================================================

export async function count_notes_per_stream(source_input, sd) {
  const counts = {};
  for (const sid of Object.keys(sd)) counts[sid] = 0;
  const fn_m2s = {}, en_m2s = {}, cm_m2s = {};
  let fn_none = null, en_none = null, cm_none = null;
  for (const sid of Object.keys(sd)) {
    const s = sd[sid];
    const st = s.source_type;
    const m = s.marker;
    if (st === SOURCE_FOOTNOTE) {
      if (m) fn_m2s[m] = sid; else fn_none = fn_none || sid;
    } else if (st === SOURCE_ENDNOTE) {
      if (m) en_m2s[m] = sid; else en_none = en_none || sid;
    } else if (st === SOURCE_COMMENT) {
      if (m) cm_m2s[m] = sid; else cm_none = cm_none || sid;
    }
  }

  function _resolve(plain, m2s, none_sid) {
    const mm = plain.match(/@(\d+)/);
    if (mm && (mm[1] in m2s)) return m2s[mm[1]];
    if (none_sid && !mm) return none_sid;
    if (Object.keys(sd).length) {
      for (const _sid of Object.keys(sd)) {
        const _s = sd[_sid];
        if (_s.source_type !== SOURCE_SIDENOTE && _s.source_type !== SOURCE_PARALLEL && _s.series) return _sid;
      }
      return Object.keys(sd)[0];
    }
    return null;
  }

  const triples = [
    [await read_footnotes(source_input), fn_m2s, fn_none],
    [await read_endnotes(source_input),  en_m2s, en_none],
    [await read_comments(source_input),  cm_m2s, cm_none],
  ];
  for (const [notes, m2s, none_sid] of triples) {
    for (const nid of Object.keys(notes)) {
      const rich = notes[nid];
      let text;
      try { text = rich.get_text(); } catch (e) { continue; }
      const tsid = _resolve(text, m2s, none_sid);
      if (tsid && (tsid in counts)) counts[tsid] += 1;
    }
  }
  return counts;
}
