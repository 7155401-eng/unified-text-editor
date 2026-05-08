// verify-nested-schema.mjs — Stage 1 of nested footnotes.
//
// Confirms: (a) legacy docs with `footnote` mark still parse, and
// (b) new docs using `noteNode` (recursive inline node) parse and
// preserve nested structure + attributes round-trip through JSON.

import { schema } from "./src/engine/schema.js";
import { Node } from "prosemirror-model";

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    console.log(`FAIL  ${name}  ${detail}`);
    failed++;
  }
}

// --- 1. Legacy doc (footnote mark) still parses ---
{
  const json = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "main " },
        { type: "text", text: "note", marks: [{ type: "footnote", attrs: { stream: "01", uid: "u1" } }] },
        { type: "text", text: " tail" },
      ],
    }],
  };
  const doc = Node.fromJSON(schema, json);
  ok("legacy mark doc parses",
    doc.firstChild.textContent === "main note tail",
    `got '${doc.firstChild.textContent}'`);
  const noteText = doc.firstChild.child(1);
  ok("legacy mark text retains footnote mark",
    noteText.marks.some((m) => m.type.name === "footnote" && m.attrs.uid === "u1"));
}

// --- 2. New doc with noteNode parses ---
{
  const json = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "body " },
        {
          type: "noteNode",
          attrs: { stream: "01", uid: "outer" },
          content: [{ type: "text", text: "outer note text" }],
        },
        { type: "text", text: " tail." },
      ],
    }],
  };
  const doc = Node.fromJSON(schema, json);
  const outer = doc.firstChild.child(1);
  ok("noteNode is an inline node", outer.type.name === "noteNode" && outer.isInline);
  ok("noteNode preserves attrs", outer.attrs.stream === "01" && outer.attrs.uid === "outer");
  ok("noteNode body text", outer.textContent === "outer note text");
}

// --- 3. Nested noteNode (the headline feature) ---
{
  const json = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "body " },
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
        { type: "text", text: " tail." },
      ],
    }],
  };
  const doc = Node.fromJSON(schema, json);
  const outer = doc.firstChild.child(1);
  ok("outer is noteNode", outer.type.name === "noteNode");
  ok("outer has 3 inline children", outer.childCount === 3);
  const inner = outer.child(1);
  ok("inner is noteNode (recursion)", inner.type.name === "noteNode");
  ok("inner stream different from outer", inner.attrs.stream === "02");
  ok("inner content preserved", inner.textContent === "inner content");
  // textContent surfaces all text including nested — good for search/diff
  ok("paragraph textContent includes inner",
    doc.firstChild.textContent === "body outer pre inner content outer post tail.",
    `got '${doc.firstChild.textContent}'`);
  // Round-trip through JSON
  const back = Node.fromJSON(schema, doc.toJSON()).toJSON();
  ok("JSON roundtrip preserves structure",
    JSON.stringify(back) === JSON.stringify(doc.toJSON()));
}

// --- 4. 3-level nesting works (note in note in note) ---
{
  const json = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [{
        type: "noteNode",
        attrs: { stream: "01", uid: "L1" },
        content: [{
          type: "noteNode",
          attrs: { stream: "02", uid: "L2" },
          content: [{
            type: "noteNode",
            attrs: { stream: "03", uid: "L3" },
            content: [{ type: "text", text: "deepest" }],
          }],
        }],
      }],
    }],
  };
  const doc = Node.fromJSON(schema, json);
  const l1 = doc.firstChild.firstChild;
  const l2 = l1.firstChild;
  const l3 = l2.firstChild;
  ok("3-level deepest text", l3.textContent === "deepest");
  ok("3-level type chain", l1.type.name === "noteNode" && l2.type.name === "noteNode" && l3.type.name === "noteNode");
}

// --- 5. Mixed: legacy mark and new node in same paragraph (forward compat) ---
{
  const json = {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "body " },
        { type: "text", text: "old", marks: [{ type: "footnote", attrs: { stream: "01", uid: "old1" } }] },
        { type: "text", text: " mid " },
        {
          type: "noteNode",
          attrs: { stream: "02", uid: "new1" },
          content: [{ type: "text", text: "new style" }],
        },
        { type: "text", text: " end" },
      ],
    }],
  };
  const doc = Node.fromJSON(schema, json);
  ok("mixed doc parses", doc.firstChild.textContent === "body old mid new style end",
    `got '${doc.firstChild.textContent}'`);
}

console.log(failed === 0 ? "\nAll schema checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
