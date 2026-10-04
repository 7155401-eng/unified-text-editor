// External/generated editor content must carry only the marks authored in the
// incoming payload. A collapsed TipTap selection can keep stored typing marks
// (bold, color, etc.) even after unsetAllMarks(), so clear ProseMirror
// storedMarks explicitly inside the same chained transaction that selects and
// inserts the payload.
export function insertExternalEditorContent(editor, content, { selection = null } = {}) {
  if (!editor || content == null) return false;

  let chain = editor.chain().focus();
  if (selection != null) chain = chain.setTextSelection(selection);

  return chain
    .command(({ tr }) => {
      tr.setStoredMarks([]);
      return true;
    })
    .insertContent(content)
    .run();
}
