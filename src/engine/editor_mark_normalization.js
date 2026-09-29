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
