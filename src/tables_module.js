// Custom TipTap table support — Node extensions + insert/edit commands.
// Implemented inline to avoid pulling in @tiptap/extension-table and the
// dependent prosemirror-tables package, which would change package-lock.

import { Node, mergeAttributes } from "@tiptap/core";

export const TableExt = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  isolating: true,
  parseHTML() { return [{ tag: "table" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes({ class: "ravtext-table" }, HTMLAttributes), ["tbody", 0]];
  },
});

export const TableRowExt = Node.create({
  name: "tableRow",
  content: "tableCell+",
  parseHTML() { return [{ tag: "tr" }]; },
  renderHTML({ HTMLAttributes }) { return ["tr", HTMLAttributes, 0]; },
});

export const TableCellExt = Node.create({
  name: "tableCell",
  content: "block+",
  isolating: true,
  attrs: {},
  parseHTML() {
    return [{ tag: "td" }, { tag: "th" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["td", HTMLAttributes, 0];
  },
});

function findParentByName(state, name) {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === name) {
      return { node, before: $from.before(depth), after: $from.after(depth), depth };
    }
  }
  return null;
}

function emptyCell(schema) {
  const para = schema.nodes.paragraph.create();
  return schema.nodes.tableCell.create(null, para);
}

export function insertTableCommand(editor, rows, cols) {
  if (!editor) return false;
  const { schema } = editor.state;
  if (!schema.nodes.table) return false;
  rows = Math.max(1, Math.min(50, rows | 0));
  cols = Math.max(1, Math.min(20, cols | 0));
  const tableRows = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < cols; c++) cells.push(emptyCell(schema));
    tableRows.push(schema.nodes.tableRow.create(null, cells));
  }
  const tableNode = schema.nodes.table.create(null, tableRows);
  return editor.chain().focus().insertContent(tableNode.toJSON()).run();
}

export function addRowAfter(editor) {
  if (!editor) return false;
  const { state } = editor;
  const row = findParentByName(state, "tableRow");
  if (!row) return false;
  const newRow = state.schema.nodes.tableRow.create(
    null,
    Array(row.node.childCount).fill(0).map(() => emptyCell(state.schema))
  );
  editor.view.dispatch(state.tr.insert(row.after, newRow));
  return true;
}

export function addRowBefore(editor) {
  if (!editor) return false;
  const { state } = editor;
  const row = findParentByName(state, "tableRow");
  if (!row) return false;
  const newRow = state.schema.nodes.tableRow.create(
    null,
    Array(row.node.childCount).fill(0).map(() => emptyCell(state.schema))
  );
  editor.view.dispatch(state.tr.insert(row.before, newRow));
  return true;
}

export function deleteRow(editor) {
  if (!editor) return false;
  const { state } = editor;
  const row = findParentByName(state, "tableRow");
  const table = findParentByName(state, "table");
  if (!row || !table) return false;
  if (table.node.childCount <= 1) {
    return deleteTable(editor);
  }
  editor.view.dispatch(state.tr.delete(row.before, row.after));
  return true;
}

function findCellIndexInRow(state) {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.name === "tableCell") {
      return $from.index(depth - 1);
    }
  }
  return -1;
}

export function addColumnAfter(editor) {
  if (!editor) return false;
  const { state } = editor;
  const table = findParentByName(state, "table");
  if (!table) return false;
  const colIdx = findCellIndexInRow(state);
  if (colIdx < 0) return false;
  const tr = state.tr;
  let pos = table.before + 1;
  table.node.forEach((row) => {
    let cellPos = pos + 1;
    let i = 0;
    row.forEach((cell) => {
      if (i === colIdx) {
        const insertAt = cellPos + cell.nodeSize;
        tr.insert(tr.mapping.map(insertAt), emptyCell(state.schema));
      }
      cellPos += cell.nodeSize;
      i++;
    });
    pos += row.nodeSize;
  });
  editor.view.dispatch(tr);
  return true;
}

export function addColumnBefore(editor) {
  if (!editor) return false;
  const { state } = editor;
  const table = findParentByName(state, "table");
  if (!table) return false;
  const colIdx = findCellIndexInRow(state);
  if (colIdx < 0) return false;
  const tr = state.tr;
  let pos = table.before + 1;
  table.node.forEach((row) => {
    let cellPos = pos + 1;
    let i = 0;
    row.forEach((cell) => {
      if (i === colIdx) {
        tr.insert(tr.mapping.map(cellPos), emptyCell(state.schema));
      }
      cellPos += cell.nodeSize;
      i++;
    });
    pos += row.nodeSize;
  });
  editor.view.dispatch(tr);
  return true;
}

export function deleteColumn(editor) {
  if (!editor) return false;
  const { state } = editor;
  const table = findParentByName(state, "table");
  if (!table) return false;
  const colIdx = findCellIndexInRow(state);
  if (colIdx < 0) return false;
  const firstRow = table.node.firstChild;
  if (!firstRow || firstRow.childCount <= 1) {
    return deleteTable(editor);
  }
  const tr = state.tr;
  let pos = table.before + 1;
  table.node.forEach((row) => {
    let cellPos = pos + 1;
    let i = 0;
    row.forEach((cell) => {
      if (i === colIdx) {
        const from = tr.mapping.map(cellPos);
        const to = tr.mapping.map(cellPos + cell.nodeSize);
        tr.delete(from, to);
      }
      cellPos += cell.nodeSize;
      i++;
    });
    pos += row.nodeSize;
  });
  editor.view.dispatch(tr);
  return true;
}

export function deleteTable(editor) {
  if (!editor) return false;
  const table = findParentByName(editor.state, "table");
  if (!table) return false;
  editor.view.dispatch(editor.state.tr.delete(table.before, table.after));
  return true;
}

export function insertTablePrompt(paneManager) {
  const editor = paneManager.getActiveEditor?.();
  if (!editor) return;
  const dim = prompt('הזן ממדי טבלה: שורות x עמודות (לדוגמה: 3x4)', "3x3");
  if (!dim) return;
  const m = String(dim).match(/(\d+)\s*[xX×*]\s*(\d+)/);
  if (!m) {
    alert("פורמט לא חוקי. השתמש בפורמט 3x3");
    return;
  }
  insertTableCommand(editor, parseInt(m[1], 10), parseInt(m[2], 10));
}
