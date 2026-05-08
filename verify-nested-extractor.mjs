// verify-nested-extractor.mjs — Stage 3: extractor walks both the legacy
// footnote-mark form AND the new noteNode tree, producing notes with
// optional `children` arrays.

import { schema } from "./src/engine/schema.js";
import { Node } from "prosemirror-model";
import { docToPackerContent } from "./src/engine/extractor.js";

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}  ${detail}`); failed++; }
}

// --- 1. Legacy mark-form doc still extracts identically ---
{
  const doc = Node.fromJSON(schema, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "main " },
        { type: "text", text: "note text", marks: [{ type: "footnote", attrs: { stream: "01", uid: "u1" } }] },
        { type: "text", text: " tail" },
      ],
    }],
  });
  const out = docToPackerContent(doc);
  ok("legacy: 1 para extracted", out.length === 1);
  ok("legacy: mainText", out[0].mainText === "main  tail", `got '${out[0].mainText}'`);
  ok("legacy: 1 note", out[0].notes.length === 1);
  ok("legacy: note text", out[0].notes[0].text === "note text");
  ok("legacy: note has empty children", Array.isArray(out[0].notes[0].children) && out[0].notes[0].children.length === 0);
  ok("legacy: note has num=1", out[0].notes[0].num === 1);
}

// --- 2. New single noteNode (no nesting) extracts ---
{
  const doc = Node.fromJSON(schema, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "body " },
        {
          type: "noteNode",
          attrs: { stream: "01", uid: "n1" },
          content: [{ type: "text", text: "note body text" }],
        },
        { type: "text", text: " tail." },
      ],
    }],
  });
  const out = docToPackerContent(doc);
  ok("noteNode: 1 note", out[0].notes.length === 1);
  ok("noteNode: text", out[0].notes[0].text === "note body text");
  ok("noteNode: empty children", out[0].notes[0].children.length === 0);
  // anchor = mainPos at the moment the noteNode was encountered = "body ".length
  ok("noteNode: anchor at insertion point", out[0].notes[0].anchor === 5,
    `got ${out[0].notes[0].anchor}`);
  ok("noteNode: mainText excludes note body",
    out[0].mainText === "body  tail.", `got '${out[0].mainText}'`);
}

// --- 3. Nested: noteNode inside noteNode ---
{
  const doc = Node.fromJSON(schema, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "B " },
        {
          type: "noteNode",
          attrs: { stream: "01", uid: "outer" },
          content: [
            { type: "text", text: "outer pre " },
            {
              type: "noteNode",
              attrs: { stream: "02", uid: "inner" },
              content: [{ type: "text", text: "inner content" }],
            },
            { type: "text", text: " outer post" },
          ],
        },
      ],
    }],
  });
  const out = docToPackerContent(doc);
  ok("nested: 1 outer note", out[0].notes.length === 1);
  const outer = out[0].notes[0];
  ok("nested: outer text excludes inner",
    outer.text === "outer pre  outer post", `got '${outer.text}'`);
  ok("nested: outer has 1 child", outer.children.length === 1);
  const inner = outer.children[0];
  ok("nested: inner stream", inner.stream === "02");
  ok("nested: inner text", inner.text === "inner content");
  ok("nested: inner anchor inside parent",
    inner.anchor === "outer pre ".length, `got ${inner.anchor}`);
  // Numbering: outer is num 1 in stream 01; inner is num 1 in stream 02
  ok("nested: outer num=1", outer.num === 1);
  ok("nested: inner num=1 (own stream)", inner.num === 1);
}

// --- 4. 3-level nesting: numbering walks deep ---
{
  const doc = Node.fromJSON(schema, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{
        type: "noteNode",
        attrs: { stream: "01", uid: "L1" },
        content: [{
          type: "noteNode",
          attrs: { stream: "01", uid: "L2" },
          content: [{
            type: "noteNode",
            attrs: { stream: "01", uid: "L3" },
            content: [{ type: "text", text: "deepest" }],
          }],
        }],
      }],
    }],
  });
  const out = docToPackerContent(doc);
  const L1 = out[0].notes[0];
  const L2 = L1.children[0];
  const L3 = L2.children[0];
  // All in stream 01 — numbered L1=1, L2=2, L3=3 in document order
  ok("3-level: L1 num=1", L1.num === 1);
  ok("3-level: L2 num=2", L2.num === 2);
  ok("3-level: L3 num=3", L3.num === 3);
  ok("3-level: deepest text", L3.text === "deepest");
}

// --- 5. Two outer notes, each with its own inner — independent numbering ---
{
  const doc = Node.fromJSON(schema, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "a " },
        {
          type: "noteNode", attrs: { stream: "01", uid: "o1" },
          content: [
            { type: "text", text: "o1 " },
            { type: "noteNode", attrs: { stream: "02", uid: "i1" },
              content: [{ type: "text", text: "i1" }] },
          ],
        },
        { type: "text", text: " b " },
        {
          type: "noteNode", attrs: { stream: "01", uid: "o2" },
          content: [
            { type: "text", text: "o2 " },
            { type: "noteNode", attrs: { stream: "02", uid: "i2" },
              content: [{ type: "text", text: "i2" }] },
          ],
        },
      ],
    }],
  });
  const out = docToPackerContent(doc);
  ok("two-outer: 2 outer notes", out[0].notes.length === 2);
  const o1 = out[0].notes[0], o2 = out[0].notes[1];
  ok("two-outer: o1 num=1", o1.num === 1);
  ok("two-outer: o2 num=2", o2.num === 2);
  ok("two-outer: i1 num=1 (stream 02)", o1.children[0].num === 1);
  ok("two-outer: i2 num=2 (stream 02)", o2.children[0].num === 2);
}

// --- 6. Mixed: legacy mark + noteNode in same paragraph ---
{
  const doc = Node.fromJSON(schema, {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "a " },
        { type: "text", text: "old", marks: [{ type: "footnote", attrs: { stream: "01", uid: "old1" } }] },
        { type: "text", text: " b " },
        {
          type: "noteNode", attrs: { stream: "02", uid: "new1" },
          content: [{ type: "text", text: "new note" }],
        },
        { type: "text", text: " c" },
      ],
    }],
  });
  const out = docToPackerContent(doc);
  ok("mixed: 2 notes", out[0].notes.length === 2);
  ok("mixed: legacy first", out[0].notes[0].text === "old" && out[0].notes[0].children.length === 0);
  ok("mixed: new second", out[0].notes[1].text === "new note");
  ok("mixed: mainText",
    out[0].mainText === "a  b  c", `got '${out[0].mainText}'`);
}

console.log(failed === 0 ? "\nAll extractor checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
