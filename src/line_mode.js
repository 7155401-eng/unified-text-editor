// line_mode.js - מצב שורות באמצעות PM transactions
// מקבילה של toggleLines ב-Quill (שורות 764-821 במקור)

function offsetToPos(offsetMap, offset) {
  for (let i = offsetMap.length - 1; i >= 0; i--) {
    if (offsetMap[i].offsetInFull <= offset) {
      const delta = offset - offsetMap[i].offsetInFull;
      return offsetMap[i].posInDoc + delta;
    }
  }
  return offsetMap.length > 0 ? offsetMap[0].posInDoc : 0;
}

export function applyLineMode(paneManager, on) {
  paneManager.lineMode = on;

  const allSymbols = paneManager.getActiveSymbols().map(s => s.sym);

  for (const pane of paneManager.panes) {
    if (!pane.editor) continue;

    const symsToScan = pane.streamCode
      ? [pane.symbol].filter(Boolean)
      : allSymbols;

    if (symsToScan.length === 0) {
      _toggleNoWrapClass(pane, on);
      continue;
    }

    if (on) {
      _enableLineMode(pane, symsToScan);
    } else {
      _disableLineMode(pane, symsToScan);
    }

    _toggleNoWrapClass(pane, on);
  }
}

function _toggleNoWrapClass(pane, on) {
  if (pane._body) {
    pane._body.classList.toggle("line-mode", on);
  }
}

function _enableLineMode(pane, symbols) {
  const editor = pane.editor;
  const splitPoints = [];

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return;

    let fullText = '';
    const offsetMap = [];
    node.descendants((child, childOffset) => {
      if (!child.isText) return;
      offsetMap.push({ offsetInFull: fullText.length, posInDoc: pos + 1 + childOffset });
      fullText += child.text;
      return false;
    });

    for (const sym of symbols) {
      let idx = fullText.indexOf(sym);
      while (idx !== -1) {
        if (idx > 0) {
          const realPos = offsetToPos(offsetMap, idx);
          const charBefore = fullText[idx - 1];
          splitPoints.push({
            pos: realPos,
            hadSpaceBefore: charBefore === ' ',
          });
        }
        idx = fullText.indexOf(sym, idx + sym.length);
      }
    }

    return false;
  });

  splitPoints.sort((a, b) => b.pos - a.pos);

  let tr = editor.state.tr;
  for (const p of splitPoints) {
    if (p.hadSpaceBefore) {
      tr = tr.delete(p.pos - 1, p.pos);
      tr = tr.split(p.pos - 1);
    } else {
      tr = tr.split(p.pos);
    }
  }

  if (tr.steps.length > 0) {
    editor.view.dispatch(tr);
  }
}

function _disableLineMode(pane, symbols) {
  const editor = pane.editor;
  const joinPoints = [];

  let firstPara = true;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return;

    if (firstPara) {
      firstPara = false;
      return false;
    }

    const firstChild = node.firstChild;
    if (firstChild && firstChild.isText) {
      const txt = firstChild.text || '';
      for (const s of symbols) {
        if (txt.startsWith(s)) {
          joinPoints.push(pos);
          break;
        }
      }
    }
    return false;
  });

  joinPoints.sort((a, b) => b - a);

  let tr = editor.state.tr;
  for (const pos of joinPoints) {
    tr = tr.join(pos);
    tr = tr.insertText(' ', tr.mapping.map(pos - 1, -1));
  }

  if (tr.steps.length > 0) {
    editor.view.dispatch(tr);
  }
}
