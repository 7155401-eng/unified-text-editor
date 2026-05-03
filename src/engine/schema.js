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
      content: "text*",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0];
      },
    },
    text: { group: "inline" },
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
