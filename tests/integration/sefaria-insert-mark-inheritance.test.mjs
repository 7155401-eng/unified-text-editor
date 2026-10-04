import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"editor\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const keys = [
    "window", "document", "navigator", "Node", "Text", "HTMLElement",
    "Element", "MutationObserver", "DOMParser", "getComputedStyle",
  ];
  const previous = new Map();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "window" ? dom.window
      : key === "document" ? dom.window.document
      : key === "navigator" ? dom.window.navigator
      : key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window)
      : dom.window[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  previous.set("requestAnimationFrame", Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"));
  previous.set("cancelAnimationFrame", Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"));
  globalThis.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);

  return {
    dom,
    restore() {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}

async function createEditor(html) {
  const [{ Editor }, starter] = await Promise.all([
    import("@tiptap/core"),
    import("@tiptap/starter-kit"),
  ]);
  return new Editor({
    element: document.getElementById("editor"),
    extensions: [starter.default],
    content: html,
  });
}

function marksForText(editor, needle) {
  const matches = [];
  editor.state.doc.descendants(node => {
    if (!node.isText || !String(node.text || "").includes(needle)) return;
    matches.push(node.marks.map(mark => mark.type.name));
  });
  return matches;
}

test("audit B25: generated plain HTML must not inherit an active bold stored mark", async () => {
  const env = installDom();
  let editor;
  try {
    editor = await createEditor("<p>אב</p>");
    const endInsideParagraph = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(endInsideParagraph);
    editor.commands.setMark("bold");

    assert.equal(editor.state.selection.empty, true);
    assert.ok(
      (editor.state.storedMarks || []).some(mark => mark.type.name === "bold") ||
      editor.isActive("bold"),
      "fixture did not establish an active bold typing mark"
    );

    editor.chain().focus().insertContent("<span>פסוק חדש</span>").run();

    const marks = marksForText(editor, "פסוק חדש");
    assert.ok(marks.length, "generated text was not inserted");
    assert.ok(
      marks.some(list => list.includes("bold")),
      "baseline changed: plain generated HTML no longer inherits the active bold mark: " + JSON.stringify(marks)
    );
  } finally {
    editor?.destroy();
    env.restore();
  }
});

test("audit B25: replacing a bold selection with plain generated HTML stays plain", async () => {
  const env = installDom();
  let editor;
  try {
    const selected = "מקור";
    editor = await createEditor("<p><strong>" + selected + "</strong> רגיל</p>");
    editor.commands.setTextSelection({ from: 1, to: 1 + selected.length });
    assert.equal(editor.state.selection.empty, false);
    assert.equal(editor.isActive("bold"), true, "fixture selection is not bold");

    editor.chain().focus().insertContent("<span>פסוק חלופי</span>").run();

    const marks = marksForText(editor, "פסוק חלופי");
    assert.ok(marks.length, "replacement text was not inserted");
    assert.ok(
      marks.some(list => list.includes("bold")),
      "baseline changed: plain replacement HTML no longer inherits bold from the selected source: " + JSON.stringify(marks)
    );
  } finally {
    editor?.destroy();
    env.restore();
  }
});

async function insertGeneratedHtmlPlain(editor, html) {
  let chain = editor.chain().focus();
  if (!editor.state.selection.empty) chain = chain.deleteSelection();
  return chain
    .command(({ tr }) => {
      tr.setStoredMarks([]);
      return true;
    })
    .insertContent(html)
    .run();
}

test("candidate fix: an explicit empty stored-mark boundary keeps generated plain HTML plain", async () => {
  const env = installDom();
  let editor;
  try {
    editor = await createEditor("<p>אב</p>");
    const endInsideParagraph = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(endInsideParagraph);
    editor.commands.setMark("bold");
    assert.equal(await insertGeneratedHtmlPlain(editor, "<span>פסוק חדש</span>"), true);

    const marks = marksForText(editor, "פסוק חדש");
    assert.ok(marks.length, "generated text was not inserted");
    assert.ok(
      marks.every(list => !list.includes("bold")),
      "candidate boundary still inherited bold: " + JSON.stringify(marks)
    );
  } finally {
    editor?.destroy();
    env.restore();
  }
});

test("candidate fix: replacement clears inherited selection marks but preserves explicit generated marks", async () => {
  const env = installDom();
  let editor;
  try {
    const selected = "מקור";
    editor = await createEditor("<p><strong>" + selected + "</strong> רגיל</p>");
    editor.commands.setTextSelection({ from: 1, to: 1 + selected.length });

    assert.equal(
      await insertGeneratedHtmlPlain(editor, "<span>פסוק plain</span> <strong>מודגש מפורש</strong>"),
      true
    );

    const plain = marksForText(editor, "פסוק plain");
    const explicit = marksForText(editor, "מודגש מפורש");
    assert.ok(plain.length && explicit.length, "replacement content was not inserted");
    assert.ok(plain.every(list => !list.includes("bold")),
      "plain generated text inherited bold: " + JSON.stringify(plain));
    assert.ok(explicit.some(list => list.includes("bold")),
      "explicit bold from generated HTML was lost: " + JSON.stringify(explicit));
  } finally {
    editor?.destroy();
    env.restore();
  }
});

test("Sefaria Live editor handoff currently inserts accepted HTML without an explicit mark boundary", () => {
  const source = fs.readFileSync(
    new URL("../../src/sefaria/sefaria.js", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("function _insertHtmlAtCursor");
  const end = source.indexOf("\n}\n", start) + 2;
  assert.ok(start >= 0 && end > start, "Sefaria Live insertion helper missing");
  const helper = source.slice(start, end);

  assert.match(helper, /\.chain\(\)\.focus\(\)\.insertContent\(html\)\.run\(\)/);
  assert.doesNotMatch(
    helper,
    /unsetAllMarks|setStoredMarks|storedMarks|insertExternalContent/,
    "audit precondition changed: helper now owns an explicit mark boundary"
  );
});
