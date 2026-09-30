import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import {
  wordInlineNodeHtml,
  wordMainFragmentFromEditorHtml,
  wordRichFragmentFromEditorHtml,
} from "../../src/word_export_serialization.js";

function doc() {
  return new JSDOM("<!doctype html><body></body>").window.document;
}

test("B13 main export distinguishes hard breaks from real paragraph boundaries", () => {
  const d = doc();
  const html = "<p>אחד<br><strong>שניים</strong></p><p>שלוש</p>";
  const out = wordMainFragmentFromEditorHtml(html, d);
  assert.equal((out.match(/<br>/g) || []).length, 1);
  assert.equal((out.match(/<p class=MsoNormal dir=RTL><span lang=HE>/g) || []).length, 1);
  assert.equal(
    out,
    "אחד<br><b>שניים</b></span></p>\n<p class=MsoNormal dir=RTL><span lang=HE>שלוש",
  );
});

test("B13 rich stream export preserves only source hard breaks plus block separators", () => {
  const d = doc();
  const html = "<p>אחד<br><em>שניים</em></p><p><strong>שלוש</strong></p><p>ארבע</p>";
  const out = wordRichFragmentFromEditorHtml(html, d);
  assert.equal(out, "אחד<br><i>שניים</i><br><b>שלוש</b><br>ארבע");
  assert.equal((out.match(/<br>/g) || []).length, 3,
    "one source hard break plus two real block boundaries expected");
});

test("B13 adjacent top-level inline nodes stay on one logical line", () => {
  const d = doc();
  const html = 'alpha <strong>beta</strong><span style="color:red"> gamma</span>';
  const out = wordRichFragmentFromEditorHtml(html, d);
  assert.equal(out, 'alpha <b>beta</b><span style="color:red"> gamma</span>');
  assert.equal((out.match(/<br>/g) || []).length, 0,
    "inline siblings must not become invented line breaks");
});

test("B13 empty editor blocks remain intentional blank lines", () => {
  const d = doc();
  assert.equal(wordRichFragmentFromEditorHtml("<p>א</p><p></p><p>ב</p>", d), "א<br><br>ב");
});

test("shared inline serializer escapes text and preserves safe formatting", () => {
  const d = doc();
  const host = d.createElement("div");
  host.innerHTML = '<a href="https://example.test/?a=1&b=2"><strong>A&B</strong></a>';
  assert.equal(
    wordInlineNodeHtml(host.firstChild),
    '<a href="https://example.test/?a=1&amp;b=2"><b>A&amp;B</b></a>',
  );
});

test("word_bridge stream export is wired only to the shared rich serializer", () => {
  const source = fs.readFileSync(new URL("../../src/word_bridge.js", import.meta.url), "utf8");
  assert.match(source, /wordRichFragmentFromEditorHtml/);
  assert.match(source, /return wordRichFragmentFromEditorHtml\(editor\.getHTML\(\)\);/);
  assert.doesNotMatch(source, /\binlineNodeHtml\s*\(/,
    "undefined legacy inlineNodeHtml call returned to word_bridge");
});
