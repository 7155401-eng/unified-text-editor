// stream_mark.js - גרסה משופרת
// סימן זרם - TipTap Mark מותאם.

import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { defaultLabelForCode } from "./engine_bridge.js";

const AUTO_MARK_FULL_SCAN_LIMIT = 20000;

export const STREAM_PALETTE = [
  { bg: "#FEE2E2", fg: "#7F1D1D", name: "אדום" },
  { bg: "#DBEAFE", fg: "#1E3A8A", name: "כחול" },
  { bg: "#DCFCE7", fg: "#14532D", name: "ירוק" },
  { bg: "#FEF3C7", fg: "#78350F", name: "ענבר" },
  { bg: "#F3E8FF", fg: "#581C87", name: "סגול" },
  { bg: "#CFFAFE", fg: "#164E63", name: "טורקיז" },
  { bg: "#FCE7F3", fg: "#831843", name: "ורוד" },
  { bg: "#E5E7EB", fg: "#1F2937", name: "אפור" },
];

export function colorForStream(code) {
  const n = parseInt(code, 10);
  if (!Number.isFinite(n) || n < 1) {
    let h = 0;
    for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return STREAM_PALETTE[h % STREAM_PALETTE.length];
  }
  return STREAM_PALETTE[(n - 1) % STREAM_PALETTE.length];
}

function makeUid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function offsetToPos(offsetMap, offset) {
  for (let i = offsetMap.length - 1; i >= 0; i--) {
    if (offsetMap[i].offsetInFull <= offset) {
      const delta = offset - offsetMap[i].offsetInFull;
      return offsetMap[i].posInDoc + delta;
    }
  }
  return offsetMap.length > 0 ? offsetMap[0].posInDoc : 0;
}

function hasPotentialMarker(text, userSymbol) {
  if (!text) return false;
  if (userSymbol) return String(text).includes(userSymbol);
  return /@\d{1,3}/.test(String(text));
}

function rangeHasStreamMark(doc, from, to, markType) {
  let found = false;
  const start = Math.max(0, Math.min(doc.content.size, from));
  const end = Math.max(start, Math.min(doc.content.size, to));
  if (start === end) return false;
  doc.nodesBetween(start, end, (node) => {
    if (found || !node.isText) return false;
    found = node.marks.some((mk) => mk.type === markType);
    return !found;
  });
  return found;
}

function transactionsTouchPotentialMarker(transactions, oldState, newState, userSymbol, markType) {
  for (const tr of transactions) {
    if (tr.getMeta("forceStreamMarkScan")) return true;
    for (const map of tr.mapping.maps) {
      let touched = false;
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        if (touched) return;
        const newFrom = Math.max(0, Math.min(newState.doc.content.size, newStart - 8));
        const newTo = Math.max(newFrom, Math.min(newState.doc.content.size, newEnd + 8));
        const oldFrom = Math.max(0, Math.min(oldState.doc.content.size, oldStart - 8));
        const oldTo = Math.max(oldFrom, Math.min(oldState.doc.content.size, oldEnd + 8));
        const newText = newState.doc.textBetween(newFrom, newTo, "\n", "\n");
        const oldText = oldState.doc.textBetween(oldFrom, oldTo, "\n", "\n");
        touched =
          hasPotentialMarker(newText, userSymbol) ||
          hasPotentialMarker(oldText, userSymbol) ||
          rangeHasStreamMark(oldState.doc, oldFrom, oldTo, markType);
      });
      if (touched) return true;
    }
  }
  return false;
}

export const StreamMark = Mark.create({
  name: "streamMark",
  inclusive: false,
  excludes: "",

  addStorage() {
    return {
      symbol: null,
      streamCode: null,
    };
  },

  addAttributes() {
    return {
      streamCode: {
        default: "01",
        parseHTML: (el) => el.getAttribute("data-stream") || "01",
        renderHTML: (attrs) => ({ "data-stream": attrs.streamCode }),
      },
      symbol: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-symbol"),
        renderHTML: (attrs) => attrs.symbol ? { "data-symbol": attrs.symbol } : {},
      },
      uid: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-uid") || makeUid(),
        renderHTML: (attrs) => ({ "data-uid": attrs.uid || makeUid() }),
      },
      num: {
        default: null,
        parseHTML: (el) => parseInt(el.getAttribute("data-num"), 10) || null,
        renderHTML: (attrs) => attrs.num ? { "data-num": attrs.num } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span.stream-marker" }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const code = HTMLAttributes["data-stream"] || mark?.attrs?.streamCode || "01";
    const palette = colorForStream(code);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: `stream-marker stream-${code}`,
        style: `background-color:${palette.bg};color:${palette.fg};border-radius:3px;padding:0 3px;font-weight:600;`,
        title: `${defaultLabelForCode(code)} (${palette.name})`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setStream: (streamCode, symbol = null) => ({ commands }) => {
        return commands.setMark(this.name, {
          streamCode: String(streamCode).padStart(2, "0"),
          symbol,
          uid: makeUid(),
        });
      },
      unsetStream: () => ({ commands }) => commands.unsetMark(this.name),
      toggleStream: (streamCode, symbol = null) => ({ commands }) => {
        return commands.toggleMark(this.name, {
          streamCode: String(streamCode).padStart(2, "0"),
          symbol,
          uid: makeUid(),
        });
      },
    };
  },

  addProseMirrorPlugins() {
    const markType = this.type;
    const editorRef = this.editor;
    const key = new PluginKey("stream-mark-autodetect");

    return [
      new Plugin({
        key,
        appendTransaction(transactions, oldState, newState) {
          if (typeof window !== "undefined" && window.__STREAM_MARK_SCAN_DISABLED__) {
            return null;
          }
          const storage = editorRef.storage.streamMark;
          const userSymbol = storage.symbol;
          const userStreamCode = storage.streamCode;
          const forceScan = transactions.some(t => t.getMeta("forceStreamMarkScan"));
          const docChanged = transactions.some(t => t.docChanged);
          if (!docChanged && !forceScan) return null;
          if (
            !forceScan &&
            newState.doc.content.size > AUTO_MARK_FULL_SCAN_LIMIT &&
            !transactionsTouchPotentialMarker(transactions, oldState, newState, userSymbol, markType)
          ) {
            return null;
          }

          const re = userSymbol
            ? new RegExp(escapeRegex(userSymbol), 'g')
            : /@(\d{1,3})/g;

          const tr = newState.tr;
          let changed = false;
          const detected = [];
          const runningCount = {};
          const collected = [];

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;

            let fullText = '';
            const offsetMap = [];
            node.descendants((child, childOffset) => {
              if (!child.isText) return;
              offsetMap.push({
                offsetInFull: fullText.length,
                posInDoc: pos + 1 + childOffset,
              });
              fullText += child.text;
              return false;
            });

            re.lastIndex = 0;
            let m;
            while ((m = re.exec(fullText)) !== null) {
              const startPos = offsetToPos(offsetMap, m.index);
              const endPos = offsetToPos(offsetMap, m.index + m[0].length);

              let code;
              if (m[1] !== undefined) {
                code = String(parseInt(m[1], 10)).padStart(2, "0");
              } else {
                code = userStreamCode || '99';
              }

              runningCount[code] = (runningCount[code] || 0) + 1;
              const num = runningCount[code];
              const alreadyMarked = newState.doc.rangeHasMark(startPos, endPos, markType);
              collected.push({
                start: startPos,
                end: endPos,
                code,
                sym: m[0],
                num,
                alreadyMarked,
              });
            }

            return false;
          });

          for (const c of collected) {
            const existingMarks = newState.doc.resolve(c.start).marks();
            const existing = existingMarks.find(mk => mk.type === markType);

            if (c.alreadyMarked && existing && existing.attrs.num === c.num) {
              continue;
            }

            tr.removeMark(c.start, c.end, markType);
            tr.addMark(c.start, c.end, markType.create({
              streamCode: c.code,
              symbol: c.sym,
              uid: existing && existing.attrs.uid ? existing.attrs.uid : makeUid(),
              num: c.num,
            }));
            changed = true;
            if (!c.alreadyMarked) {
              detected.push({ code: c.code, symbol: c.sym, num: c.num });
            }
          }

          if (changed && typeof window !== "undefined" && window.__streamMarkOnDetected) {
            setTimeout(() => window.__streamMarkOnDetected(detected), 50);
          }

          return changed ? tr : null;
        },
      }),
    ];
  },
});

export function findAllStreamMarks(state) {
  const found = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const m = node.marks.find(x => x.type.name === "streamMark");
    if (!m) return;
    found.push({
      from: pos,
      to: pos + node.nodeSize,
      streamCode: m.attrs.streamCode,
      uid: m.attrs.uid,
      symbol: m.attrs.symbol,
      num: m.attrs.num,
      text: node.text,
    });
  });
  return found;
}

export function countByStream(state) {
  const counts = {};
  for (const m of findAllStreamMarks(state)) {
    counts[m.streamCode] = (counts[m.streamCode] || 0) + 1;
  }
  return counts;
}

export function jumpToNextMarker(view, dir = 1) {
  const all = findAllStreamMarks(view.state);
  if (all.length === 0) return false;
  const cur = view.state.selection.from;
  let target = null;
  if (dir > 0) {
    target = all.find(m => m.from > cur) || all[0];
  } else {
    const before = all.filter(m => m.from < cur);
    target = before.length ? before[before.length - 1] : all[all.length - 1];
  }
  if (!target) return false;
  const tr = view.state.tr.setSelection(
    view.state.selection.constructor.create(view.state.doc, target.from, target.to)
  );
  view.dispatch(tr);
  view.focus();
  const el = view.dom.querySelector(`.stream-marker[data-uid="${target.uid}"]`);
  if (el) {
    // v33: scroll so the bubble (positioned ABOVE the marker) is also visible.
    // Default scrollIntoView centers the marker — but the bubble can end up
    // partially clipped above the viewport. Add a manual top offset.
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Adjust scroll: shift down so bubble (~30px above marker) is in view.
    setTimeout(() => {
      const container = view.dom.closest("[data-scroll-sync],.editor-scroll,.ProseMirror")
        || view.dom.parentElement;
      if (container && container.scrollBy) {
        const rect = el.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        if (rect.top - cRect.top < 50) container.scrollBy({ top: -50, behavior: 'smooth' });
      }
    }, 350);
  }
  return true;
}
