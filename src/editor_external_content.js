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
  if (selection != null) chain = chain.setTextSelection(selection);

  // Clear only ambient editor marks before parsing/inserting the payload.
  // Marks explicitly present in incoming HTML are parsed by insertContent after
  // this boundary and therefore remain intact.
  return chain
    .unsetAllMarks()
    .insertContent(content)
    .run();
}
