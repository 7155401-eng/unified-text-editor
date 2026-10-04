import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { insertExternalEditorContent } from "../../src/editor_external_content.js";

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

function textSegments(editor) {
  const segments = [];
  editor.state.doc.descendants(node => {
    if (!node.isText) return;
    segments.push({
      text: String(node.text || ""),
      marks: node.marks.map(mark => mark.type.name),
    });
  });
  return segments;
}

test("external plain HTML does not inherit an active bold stored mark", async () => {
  const env = installDom();
  let editor;
  try {
    editor = await createEditor("<p>אב</p>");
    const endInsideParagraph = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(endInsideParagraph);
    editor.commands.setMark("bold");

    assert.ok(
      (editor.state.storedMarks || []).some(mark => mark.type.name === "bold") ||
      editor.isActive("bold"),
      "fixture did not establish an active bold typing mark"
    );

    assert.equal(insertExternalEditorContent(editor, "<span>פסוק חדש</span>"), true);

    const inserted = textSegments(editor).filter(part => part.text.includes("פסוק חדש"));
    assert.ok(inserted.length, "generated text was not inserted");
    assert.ok(
      inserted.every(part => !part.marks.includes("bold")),
      "generated text inherited ambient bold: " + JSON.stringify(inserted)
    );
  } finally {
    editor?.destroy();
    env.restore();
  }
});

test("external plain HTML replacing a bold selection stays plain", async () => {
  const env = installDom();
  let editor;
  try {
    const selected = "מקור";
    editor = await createEditor("<p><strong>" + selected + "</strong> רגיל</p>");
    editor.commands.setTextSelection({ from: 1, to: 1 + selected.length });
    assert.equal(editor.isActive("bold"), true, "fixture selection is not bold");

    assert.equal(
      insertExternalEditorContent(editor, "<span>פסוק חלופי</span>", {
        selection: { from: 1, to: 1 + selected.length },
      }),
      true
    );

    const all = textSegments(editor);
    const inserted = all.filter(part => part.text.includes("פסוק חלופי"));
    assert.ok(inserted.length, "replacement text was not inserted");
    assert.ok(
      inserted.every(part => !part.marks.includes("bold")),
      "replacement inherited selected bold: " + JSON.stringify(inserted)
    );
    assert.equal(
      all.some(part => part.text.includes(selected)),
      false,
      "selected source text survived instead of being replaced: " + JSON.stringify(all)
    );
  } finally {
    editor?.destroy();
    env.restore();
  }
});

test("replacement preserves formatting outside the selected external-content boundary", async () => {
  const env = installDom();
  let editor;
  try {
    editor = await createEditor("<p><strong>AAA</strong><strong>BBBB</strong><em>CCC</em></p>");
    // ProseMirror positions inside one paragraph: AAA=[1,4), BBBB=[4,8), CCC=[8,11).
    editor.commands.setTextSelection({ from: 4, to: 8 });

    assert.equal(
      insertExternalEditorContent(editor, "X", {
        selection: { from: 4, to: 8 },
      }),
      true
    );

    const parts = textSegments(editor);
    const joined = parts.map(part => part.text).join("");
    assert.equal(joined, "AAAXCCC");
    assert.equal(joined.includes("BBBB"), false);

    const left = parts.filter(part => part.text.includes("AAA"));
    const middle = parts.filter(part => part.text.includes("X"));
    const right = parts.filter(part => part.text.includes("CCC"));
    assert.ok(left.length && left.every(part => part.marks.includes("bold")),
      "left source bold changed: " + JSON.stringify(parts));
    assert.ok(middle.length && middle.every(part => part.marks.length === 0),
      "replacement inherited marks: " + JSON.stringify(parts));
    assert.ok(right.length && right.every(part => part.marks.includes("italic")),
      "right source italic changed: " + JSON.stringify(parts));
  } finally {
    editor?.destroy();
    env.restore();
  }
});

test("marks authored in incoming HTML survive the ambient-mark boundary", async () => {
  const env = installDom();
  let editor;
  try {
    editor = await createEditor("<p>אב</p>");
    const endInsideParagraph = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(endInsideParagraph);
    editor.commands.setMark("bold");

    assert.equal(
      insertExternalEditorContent(
        editor,
        "<span>רגיל </span><strong>מכוון</strong><span> סוף</span>"
      ),
      true
    );

    const parts = textSegments(editor);
    const intentional = parts.filter(part => part.text.includes("מכוון"));
    const plain = parts.filter(part => part.text.includes("רגיל") || part.text.includes("סוף"));

    assert.ok(intentional.length, "authored bold segment missing");
    assert.ok(intentional.every(part => part.marks.includes("bold")),
      "authored <strong> mark was stripped: " + JSON.stringify(intentional));
    assert.ok(plain.length, "plain generated segments missing");
    assert.ok(plain.every(part => !part.marks.includes("bold")),
      "ambient bold leaked into plain authored HTML: " + JSON.stringify(plain));
  } finally {
    editor?.destroy();
    env.restore();
  }
});

test("external-content helper clears ProseMirror stored marks inside the insertion chain", () => {
  const helper = fs.readFileSync(
    new URL("../../src/editor_external_content.js", import.meta.url),
    "utf8"
  );
  assert.match(helper, /\.command\(\(\{ tr \}\) => \{/);
  assert.match(helper, /tr\.setStoredMarks\(\[\]\)/);
  assert.doesNotMatch(helper, /unsetAllMarks\(\)/);
});

test("Sefaria and fetched-source actions use the external-content boundary", () => {
  const sefaria = fs.readFileSync(
    new URL("../../src/sefaria/sefaria.js", import.meta.url),
    "utf8"
  );
  const torah = fs.readFileSync(
    new URL("../../src/torah_tools.js", import.meta.url),
    "utf8"
  );

  assert.match(sefaria, /import \{ insertExternalEditorContent \} from "\.\.\/editor_external_content\.js";/);
  const helperStart = sefaria.indexOf("function _insertHtmlAtCursor");
  const helperEnd = sefaria.indexOf("\n}\n", helperStart) + 2;
  const helper = sefaria.slice(helperStart, helperEnd);
  assert.match(helper, /insertExternalEditorContent\(ed, html\)/);
  assert.doesNotMatch(helper, /\.insertContent\(/);

  assert.match(torah, /import \{ insertExternalEditorContent \} from "\.\/editor_external_content\.js";/);
  assert.match(torah, /insertExternalEditorContent\(ed, text \+ citation\)/);
  assert.match(
    torah,
    /insertExternalEditorContent\(ed, html, \{\s*selection: \{ from: targetFrom, to: targetTo \}/
  );
  assert.match(
    torah,
    /insertExternalEditorContent\(ed, html, \{\s*selection: \{ from: insertAt, to: insertAt \}/
  );
  assert.match(
    torah,
    /insertExternalEditorContent\(ed, html, \{\s*selection: \{ from: sel\.from, to: sel\.to \}/
  );
  assert.equal(
    (torah.match(/insertExternalEditorContent\(/g) || []).length,
    4,
    "all four external/fetched insertion paths must use the boundary"
  );
});
