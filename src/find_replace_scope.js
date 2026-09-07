// find_replace_scope.js — the search / replace core behind find_replace.js.
//
// Kept in its own file so the three delicate parts are easy to read and test:
//   1. scanning a pane by text block, so a match is still found when a word is
//      split in two by formatting (bold in the middle of the word);
//   2. counting matches without counting the same letters twice (non
//      overlapping), so the number shown to the user is the real number;
//   3. replacing every match of one pane inside ONE transaction, so a single
//      "undo" puts the pane back exactly as it was.

// prosemirror-history closes the current undo group when it sees this marker
// on a transaction. We set it by name instead of importing closeHistory():
// Transaction.getMeta() looks a plugin key up by its string form, and
// prosemirror-state's createKey() always names the first (and only) key
// called "closeHistory" as "closeHistory$". Doing it this way needs no extra
// package, and an unrecognised meta key is simply ignored, so it can never
// break anything.
const CLOSE_HISTORY_MARK = "closeHistory$";

// True when the marker really lands on a transaction. Cheap self-check, so a
// caller can tell the difference between working and silently doing nothing.
export function historyHelperReady(editor) {
  try {
    const tr = editor.state.tr;
    tr.setMeta(CLOSE_HISTORY_MARK, true);
    return tr.getMeta(CLOSE_HISTORY_MARK) === true;
  } catch (e) {
    return false;
  }
}

// The name to show the user for a pane: always the CURRENT name, the one the
// user sees on the pane header right now — never a built-in default.
export function paneDisplayName(pane, index = 0) {
  const live = typeof pane?.label === "string" ? pane.label.trim() : "";
  if (live) return live;
  if (pane?.streamCode) return `זרם ${pane.streamCode}`;
  return `חלונית ${index + 1}`;
}

// Every text block of the document, as one plain string plus the document
// position its first character sits at. Inline things that are not text (an
// image, a note marker) are stood in for by one placeholder character each so
// that the positions stay lined up.
export function collectBlocks(doc) {
  const blocks = [];
  if (!doc) return blocks;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child) => {
      if (child.isText) text += child.text || "";
      else text += "￼".repeat(child.nodeSize);
    });
    if (text) blocks.push({ base: pos + 1, text });
    return false;
  });
  return blocks;
}

// All places the search text sits, front to back, never overlapping.
export function findMatches(doc, query) {
  const out = [];
  if (!doc || !query) return out;
  for (const b of collectBlocks(doc)) {
    let idx = b.text.indexOf(query);
    while (idx >= 0) {
      out.push({ from: b.base + idx, to: b.base + idx + query.length });
      idx = b.text.indexOf(query, idx + query.length);
    }
  }
  return out;
}

export function countMatches(editor, query) {
  if (!editor?.state?.doc || !query) return 0;
  return findMatches(editor.state.doc, query).length;
}

// Replace every match in one pane, in one transaction => one undo step.
// Returns how many were replaced. Nothing is dispatched when there is no match,
// so an empty search never pushes a useless entry onto the undo stack.
export function replaceAllInPane(editor, query, replacement) {
  if (!editor?.state?.doc || !query) return 0;
  const matches = findMatches(editor.state.doc, query);
  if (matches.length === 0) return 0;
  const { state } = editor;
  const tr = state.tr;
  const repl = replacement == null ? "" : String(replacement);
  // Back to front, so the positions we have not reached yet stay correct.
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (repl === "") {
      tr.delete(m.from, m.to);
    } else {
      // Keep whatever formatting the found text carried.
      const marks = state.doc.nodeAt(m.from)?.marks || null;
      tr.replaceWith(m.from, m.to, state.schema.text(repl, marks));
    }
  }
  // Start a fresh undo group, so this replace-all is never glued onto the
  // edit the user made a moment earlier - one undo takes back the
  // replacement and nothing more.
  tr.setMeta(CLOSE_HISTORY_MARK, true);
  editor.view.dispatch(tr);
  return matches.length;
}
