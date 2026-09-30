import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { wordInlineNodeHtml } from "../../src/word_export_serialization.js";

const text = value => ({ nodeType: 3, nodeValue: value, childNodes: [] });
const el = (tag, children = [], attrs = {}) => ({
  nodeType: 1,
  tagName: String(tag).toUpperCase(),
  childNodes: children,
  getAttribute(name) { return attrs[name] ?? null; },
});

test("inline Word serializer handles text without requiring a DOM defaultView", () => {
  assert.equal(wordInlineNodeHtml(text("A&B < C")), "A&amp;B &lt; C");
  assert.equal(
    wordInlineNodeHtml(el("strong", [text("מודגש")])),
    "<b>מודגש</b>",
  );
});

test("inline Word serializer preserves hard breaks and nested formatting", () => {
  const node = el("span", [
    text("א"),
    el("br"),
    el("em", [text("ב")]),
  ], { style: "color:red" });
  assert.equal(
    wordInlineNodeHtml(node),
    '<span style="color:red">א<br><i>ב</i></span>',
  );
});

test("inline Word serializer escapes href attributes and text", () => {
  const node = el("a", [text("A&B")], { href: "https://example.test/?a=1&b=2" });
  assert.equal(
    wordInlineNodeHtml(node),
    '<a href="https://example.test/?a=1&amp;b=2">A&amp;B</a>',
  );
});

test("word_bridge stream export is wired only to the shared rich serializer", () => {
  const source = fs.readFileSync(new URL("../../src/word_bridge.js", import.meta.url), "utf8");
  assert.match(source, /wordRichFragmentFromEditorHtml/);
  assert.match(source, /return wordRichFragmentFromEditorHtml\(editor\.getHTML\(\)\);/);
  assert.doesNotMatch(source, /\binlineNodeHtml\s*\(/,
    "undefined legacy inlineNodeHtml call returned to word_bridge");
});
