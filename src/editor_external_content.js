// Generated/external editor content must carry only the marks authored in the
// incoming payload. TipTap otherwise inherits active/stored marks from the
// current cursor or selected source text (for example, bold), which can make
// an entire fetched/replaced passage acquire formatting it never contained.
//
// Keep this helper narrow: ordinary typing-like insertions (special characters,
// dates, calculation results) may intentionally inherit the local typing style.
export function insertExternalEditorContent(editor, content, { selection = null } = {}) {
  if (!editor || content == null) return false;

  let chain = editor.chain().focus();
  let hasRangeSelection = false;

  if (selection != null) {
    chain = chain.setTextSelection(selection);
    if (typeof selection === "object") {
      hasRangeSelection =
        Number(selection.from) !== Number(selection.to);
    }
  } else {
    hasRangeSelection = !editor.state.selection.empty;
  }

  // Delete a real replacement range first. Calling deleteSelection() at an
  // empty cursor makes the TipTap chain report failure, so keep cursor inserts
  // untouched.
  if (hasRangeSelection) chain = chain.deleteSelection();

  // Clear ambient/stored editor marks before parsing/inserting the payload.
  // Unlike unsetAllMarks(), this also clears a bold typing mark at an empty
  // cursor. Marks explicitly present in incoming HTML are parsed afterwards
  // and therefore remain intact.
  return chain
    .command(({ tr }) => {
      tr.setStoredMarks([]);
      return true;
    })
    .insertContent(content)
    .run();
}
