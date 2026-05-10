// משה 2026-05-10: הרחבות TipTap מותאמות לייבוא DOCX.
// LineHeight  — מרווח שורות לפסקאות וכותרות.
// Indent      — הזחת פסקה (margin-inline-start), נקראת גם מ-style="margin-*".
// Insertion   — סימון תוספת (מעקב שינויים) — <ins>.
// Deletion    — סימון מחיקה (מעקב שינויים) — <del>.

import { Extension, Mark } from "@tiptap/core";

// ─────────────────────────────────────────────────────────
// LineHeight
// ─────────────────────────────────────────────────────────
export const LineHeight = Extension.create({
  name: "lineHeight",

  addOptions() {
    return {
      types: ["paragraph", "heading"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => {
              const v = el && el.style && el.style.lineHeight;
              return v ? v : null;
            },
            renderHTML: (attrs) => {
              if (!attrs.lineHeight) return {};
              return { style: `line-height: ${attrs.lineHeight}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value) =>
        ({ commands }) => {
          return this.options.types.every((type) =>
            commands.updateAttributes(type, { lineHeight: value })
          );
        },
      unsetLineHeight:
        () =>
        ({ commands }) => {
          return this.options.types.every((type) =>
            commands.resetAttributes(type, "lineHeight")
          );
        },
    };
  },
});

// ─────────────────────────────────────────────────────────
// Indent
// ─────────────────────────────────────────────────────────
export const Indent = Extension.create({
  name: "indent",

  addOptions() {
    return {
      types: ["paragraph", "heading"],
      step: 24, // פיקסלים לרמת-הזחה אחת
      max: 8,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              if (!el || !el.style) return 0;
              // מנסים margin-inline-start, אז margin-right (RTL), אז margin-left (LTR)
              const raw =
                el.style.marginInlineStart ||
                el.style.marginRight ||
                el.style.marginLeft ||
                "0";
              const px = parseFloat(raw) || 0;
              if (!px) return 0;
              const step = 24;
              return Math.max(0, Math.min(8, Math.round(px / step)));
            },
            renderHTML: (attrs) => {
              if (!attrs.indent) return {};
              const px = attrs.indent * 24;
              return { style: `margin-inline-start: ${px}px` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const adjust = (delta) => ({ state, dispatch }) => {
      const { selection, tr } = state;
      let changed = false;
      state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (!this.options.types.includes(node.type.name)) return;
        const cur = node.attrs.indent || 0;
        const next = Math.max(0, Math.min(this.options.max, cur + delta));
        if (next !== cur) {
          tr.setNodeMarkup(pos, null, { ...node.attrs, indent: next });
          changed = true;
        }
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return {
      indent: () => adjust(1),
      outdent: () => adjust(-1),
    };
  },
});

// ─────────────────────────────────────────────────────────
// Insertion (Track Changes — added text)
// ─────────────────────────────────────────────────────────
export const Insertion = Mark.create({
  name: "insertion",

  parseHTML() {
    return [{ tag: "ins" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["ins", { class: "tracked-ins", ...HTMLAttributes }, 0];
  },

  addAttributes() {
    return {
      author: { default: null, parseHTML: (el) => el.getAttribute("data-author") || null,
        renderHTML: (attrs) => (attrs.author ? { "data-author": attrs.author } : {}) },
      date: { default: null, parseHTML: (el) => el.getAttribute("data-date") || null,
        renderHTML: (attrs) => (attrs.date ? { "data-date": attrs.date } : {}) },
    };
  },
});

// ─────────────────────────────────────────────────────────
// Deletion (Track Changes — removed text)
// ─────────────────────────────────────────────────────────
export const Deletion = Mark.create({
  name: "deletion",

  parseHTML() {
    return [{ tag: "del" }, { tag: "s" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["del", { class: "tracked-del", ...HTMLAttributes }, 0];
  },

  addAttributes() {
    return {
      author: { default: null, parseHTML: (el) => el.getAttribute("data-author") || null,
        renderHTML: (attrs) => (attrs.author ? { "data-author": attrs.author } : {}) },
      date: { default: null, parseHTML: (el) => el.getAttribute("data-date") || null,
        renderHTML: (attrs) => (attrs.date ? { "data-date": attrs.date } : {}) },
    };
  },
});
