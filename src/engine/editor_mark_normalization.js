// Normalize ProseMirror/TipTap marks at the editor → layout boundary.
// Normal editor marks expose type.name/attrs; some imported or serialized
// marks preserve their canonical representation only through toJSON().
export function normalizeEditorMark(mark) {
  let serialized = null;
  try {
    serialized = typeof mark?.toJSON === 'function' ? mark.toJSON() : null;
  } catch (_) {
    serialized = null;
  }
  const name = String(mark?.type?.name || serialized?.type || mark?.name || '');
  const attrs = {
    ...(serialized?.attrs && typeof serialized.attrs === 'object' ? serialized.attrs : {}),
    ...(mark?.attrs && typeof mark.attrs === 'object' ? mark.attrs : {}),
  };
  return { name, attrs };
}


export function editorMarksToRunMarks(marks) {
  const out = {};
  for (const mark of marks || []) {
    const { name, attrs } = normalizeEditorMark(mark);
    if (name === 'textStyle') {
      if (attrs.fontFamily) out.fontFamily = attrs.fontFamily;
      if (attrs.fontSize) out.fontSize = attrs.fontSize;
      if (attrs.color) out.color = attrs.color;
      if (attrs.backgroundColor || attrs.bgColor) out.backgroundColor = attrs.backgroundColor || attrs.bgColor;
    } else if (name === 'bold') out.bold = true;
    else if (name === 'italic') out.italic = true;
    else if (name === 'underline') out.underline = true;
    else if (name === 'strike') out.strike = true;
    else if (name === 'highlight') out.backgroundColor = attrs.color || out.backgroundColor;
  }
  return out;
}
