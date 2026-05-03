import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { history, undo, redo } from "prosemirror-history";
import { baseKeymap } from "prosemirror-commands";
import { schema, makeFootnoteUid } from "./schema.js";

export function createEditor(mountNode, initialDoc) {
  const state = EditorState.create({
    doc: initialDoc,
    schema,
    plugins: [
      history(),
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Mod-Shift-z": redo,
      }),
      keymap(baseKeymap),
    ],
  });

  const view = new EditorView(mountNode, { state });
  return view;
}

export function setEditorDoc(view, newDoc) {
  const { state } = view;
  const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);
  view.dispatch(tr);
}

export function addFootnoteToSelection(view, stream) {
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (empty) return false;

  const markType = state.schema.marks.footnote;
  if (!markType) return false;

  const mark = markType.create({ stream, uid: makeFootnoteUid() });
  const tr = state.tr;
  tr.removeMark(from, to, markType);
  tr.addMark(from, to, mark);
  view.dispatch(tr);
  view.focus();
  return true;
}
