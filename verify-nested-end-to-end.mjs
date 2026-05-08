// verify-nested-end-to-end.mjs — Stages 3b + 4: data flows through
// extractor → packer-shaped streams → renderer DOM, and the rendered
// apparatus contains inner-note text inside its outer note's block.

import { JSDOM } from "jsdom";
import { Node } from "prosemirror-model";
import { schema } from "./src/engine/schema.js";
import { docToPackerContent } from "./src/engine/extractor.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
};

const { renderPages } = await import("./src/engine/renderer.js");

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}  ${detail}`); failed++; }
}

// Build a doc with a nested note
const docJson = {
  type: "doc",
  content: [{
    type: "paragraph",
    content: [
      { type: "text", text: "Body text " },
      {
        type: "noteNode",
        attrs: { stream: "01", uid: "outer" },
        content: [
          { type: "text", text: "outer note " },
          {
            type: "noteNode",
            attrs: { stream: "02", uid: "inner" },
            content: [{ type: "text", text: "inner-note-text" }],
          },
          { type: "text", text: " continues" },
        ],
      },
      { type: "text", text: " after." },
    ],
  }],
};
const doc = Node.fromJSON(schema, docJson);
const extracted = docToPackerContent(doc);
ok("extractor: outer note has children", extracted[0].notes[0].children.length === 1);
ok("extractor: inner num assigned", extracted[0].notes[0].children[0].num === 1);

// Build the packer-shaped page that the renderer expects.
// pageData.streams[code] = { notes: [tup, ...] } where tup = [paraIdx, text, anchor, num, cont, children]
const outer = extracted[0].notes[0];
const pageData = {
  main: [[0, extracted[0].mainText]],
  streams: {
    "01": {
      notes: [[0, outer.text, outer.anchor, outer.num, 0, outer.children]],
    },
  },
};

// Force-sync render so all pages land in the DOM immediately.
window.__FORCE_SYNC_RENDER__ = true;
const container = document.createElement("div");
document.body.appendChild(container);
renderPages([pageData], container);

const html = container.innerHTML;
ok("rendered DOM has page", html.includes('class="page'));
ok("rendered DOM has stream-01", html.includes('data-stream="01"'));

const noteEl = container.querySelector(".note-inline");
const noteHTML = noteEl.innerHTML;
const noteText = noteEl.textContent;
ok("outer note text in DOM", noteText.includes("outer note"), `text: '${noteText}'`);
ok("inner stream-02 child appears", noteHTML.includes('data-stream="02"'));
ok("inner note text appears in DOM", noteText.includes("inner-note-text"),
  `text: '${noteText}'`);
ok("inner note-child class applied", noteHTML.includes("note-child"));

// Confirm inner is INSIDE outer's wrapping note-part
const part = container.querySelector(".note-part");
ok("note-part exists", !!part);
ok("inner note-child inside note-part",
  part && part.querySelector(".note-child[data-stream=\"02\"]") !== null);
ok("inner content text under note-child",
  part && part.querySelector(".note-child[data-stream=\"02\"]").textContent.includes("inner-note-text"));

// --- Legacy doc must still render unchanged through the same pipeline ---
{
  const legacy = Node.fromJSON(schema, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "main " },
        { type: "text", text: "legacy note", marks: [{ type: "footnote", attrs: { stream: "01", uid: "lg" } }] },
        { type: "text", text: " tail" },
      ],
    }],
  });
  const exL = docToPackerContent(legacy);
  ok("legacy: extractor produces 1 note", exL[0].notes.length === 1);
  ok("legacy: empty children", exL[0].notes[0].children.length === 0);

  const note = exL[0].notes[0];
  const pd = {
    main: [[0, exL[0].mainText]],
    streams: { "01": { notes: [[0, note.text, note.anchor, note.num, 0, note.children]] } },
  };
  const c2 = document.createElement("div");
  document.body.appendChild(c2);
  renderPages([pd], c2);
  const txt = c2.querySelector(".note-inline").textContent;
  ok("legacy: outer rendered", txt.includes("legacy note"));
  ok("legacy: no spurious note-child", c2.querySelector(".note-child") === null);
}

console.log(failed === 0 ? "\nAll end-to-end checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
