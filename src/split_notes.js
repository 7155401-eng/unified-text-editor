function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function splitNotesAdvanced(paneManager) {
  const main = paneManager.getMainPane();
  const stream1 = paneManager.panes.find((p) => p.streamCode);

  if (!main || !main.editor || !stream1 || !stream1.editor) {
    alert("דרושות חלונית ראשית וחלונית זרם אחת לפחות");
    return false;
  }

  const filterSymbol = prompt("סימן סינון להעברה לחלונית חדשה:", "*");
  if (!filterSymbol) return false;

  const newLinkSymbol = prompt("סימן קישור חדש בראשי:", "$");
  if (!newLinkSymbol) return false;

  const linkSymbol = stream1.symbol;
  if (!linkSymbol) {
    alert("בחלונית הזרם אין סימן קישור מוגדר");
    return false;
  }

  const mainText = main.editor.state.doc.textContent;
  const notesText = stream1.editor.state.doc.textContent;
  const mainParts = mainText.split(linkSymbol);

  const noteIndices = [];
  let ci = notesText.indexOf(linkSymbol);
  while (ci > -1) {
    noteIndices.push(ci);
    ci = notesText.indexOf(linkSymbol, ci + 1);
  }

  let newMainText = mainParts[0];
  const normalNotes = [];
  const specialNotes = [];

  if (noteIndices.length > 0 && noteIndices[0] > 0) {
    normalNotes.push(notesText.substring(0, noteIndices[0]));
  } else if (noteIndices.length === 0) {
    normalNotes.push(notesText);
  }

  for (let i = 0; i < noteIndices.length; i++) {
    const start = noteIndices[i];
    const end = i + 1 < noteIndices.length ? noteIndices[i + 1] : notesText.length;
    const content = notesText.substring(start, end);
    const nextPart = mainParts[i + 1] || "";

    if (content.includes(filterSymbol)) {
      specialNotes.push(content);
      newMainText += newLinkSymbol + nextPart;
    } else {
      normalNotes.push(content);
      newMainText += linkSymbol + nextPart;
    }
  }

  main.editor.commands.setContent(`<p>${escapeHtml(newMainText)}</p>`);
  stream1.editor.commands.setContent(`<p>${escapeHtml(normalNotes.join(""))}</p>`);

  if (specialNotes.length === 0) {
    alert(`לא נמצאו הערות עם הסימן ${filterSymbol}`);
    return false;
  }

  const newCode = paneManager.nextAvailableStreamCode();
  if (!newCode) {
    alert("הגעת למקסימום חלוניות");
    return false;
  }

  const newPane = paneManager.addPane({
    streamCode: newCode,
    symbol: newLinkSymbol,
    label: `זרם ${newCode}`,
  });

  if (newPane && newPane.editor) {
    setTimeout(() => {
      newPane.editor.commands.setContent(`<p>${escapeHtml(specialNotes.join(""))}</p>`);
    }, 50);
  }

  return true;
}
