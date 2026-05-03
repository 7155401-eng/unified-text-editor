// Extracts editor content into a structure suitable for word-aware page packing.
// For each paragraph: main text (concatenated unmarked runs) + notes with the
// character offset in main text where each note logically anchors.

function extractParagraph(paragraphNode) {
  const mainParts = [];
  const notes = []; // {stream, text, anchor}
  let mainPos = 0;
  let pending = null;

  function flushPending() {
    if (!pending) return;
    notes.push({ stream: pending.stream, text: pending.text, anchor: pending.anchor });
    pending = null;
  }

  paragraphNode.forEach((child) => {
    if (!child.isText) return;
    const fnMark = child.marks.find((m) => m.type.name === "footnote");
    if (fnMark) {
      const { stream, uid } = fnMark.attrs;
      if (pending && pending.stream === stream && pending.uid === uid) {
        pending.text += child.text;
      } else {
        flushPending();
        pending = { stream, uid, text: child.text, anchor: mainPos };
      }
    } else {
      flushPending();
      mainParts.push(child.text);
      mainPos += child.text.length;
    }
  });
  flushPending();

  return {
    mainText: mainParts.join(""),
    notes,
  };
}

export function docToPackerContent(doc) {
  const out = [];
  doc.forEach((paragraph) => out.push(extractParagraph(paragraph)));
  // Assign sequential per-stream display numbers in document order.
  const counters = {};
  for (const p of out) {
    for (const n of p.notes) {
      counters[n.stream] = (counters[n.stream] || 0) + 1;
      n.num = counters[n.stream];
    }
  }
  return out;
}
