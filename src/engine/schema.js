import { Schema } from "prosemirror-model";

const PALETTE_SIZE = 6;

function colorIndex(streamCode) {
  const n = parseInt(streamCode, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return ((n - 1) % PALETTE_SIZE) + 1;
}

export const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      group: "block",
      // inline* allows text plus inline `noteNode` children, so a paragraph
      // can hold both regular text and a note-as-node (Stage 1 of nested
      // footnotes). The legacy `footnote` mark still wraps text-with-text
      // for backward compatibility on already-saved documents.
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0];
      },
    },
    text: { group: "inline" },
    // Note as an inline NODE (not a mark). Its content is `inline*`, which
    // recursively allows further `noteNode` children — the "footnote on
    // footnote" requirement. The DOM round-trip uses span.note-node so
    // legacy span.note (from the mark) is not confused with this.
    noteNode: {
      group: "inline",
      inline: true,
      content: "inline*",
      attrs: {
        stream: { default: "01" },
        uid: { default: "" },
      },
      parseDOM: [
        {
          tag: "span.note-node",
          getAttrs(dom) {
            return {
              stream: dom.getAttribute("data-stream") || "01",
              uid: dom.getAttribute("data-uid") || "",
            };
          },
        },
      ],
      toDOM(node) {
        const { stream, uid } = node.attrs;
        const cls = `note-node note-stream-${colorIndex(stream)}`;
        return [
          "span",
          {
            class: cls,
            "data-stream": stream,
            "data-uid": uid,
          },
          0,
        ];
      },
    },
  },
  marks: {
    footnote: {
      attrs: {
        stream: { default: "01" },
        uid: { default: "" },
      },
      inclusive: false,
      excludes: "",
      parseDOM: [
        {
          tag: "span.note",
          getAttrs(dom) {
            return {
              stream: dom.getAttribute("data-stream") || "01",
              uid: dom.getAttribute("data-uid") || "",
            };
          },
        },
      ],
      toDOM(mark) {
        const { stream, uid } = mark.attrs;
        const cls = `note note-stream-${colorIndex(stream)}`;
        return [
          "span",
          {
            class: cls,
            "data-stream": stream,
            "data-uid": uid,
          },
          0,
        ];
      },
    },
  },
});

export function makeFootnoteUid() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function streamColorIndex(streamCode) {
  return colorIndex(streamCode);
}
