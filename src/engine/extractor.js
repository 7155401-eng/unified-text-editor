// Extracts editor content into a structure suitable for word-aware page packing.
// For each paragraph: main text (concatenated unmarked runs) + notes with the
// character offset in main text where each note logically anchors.
//
// Each note is `{stream, text, anchor, num, children}`. Children come from
// inline `noteNode` nodes nested inside the outer noteNode's content
// (footnote-on-footnote, "הערה על הערה"). Legacy footnote-mark notes have
// children=[].

// Recursively pull text + nested children out of a noteNode's content.
function extractNoteNodeBody(noteNode) {
  let text = "";
  const children = [];
  noteNode.forEach((child) => {
    if (child.isText) {
      text += child.text;
    } else if (child.type.name === "noteNode") {
      // Inner note's "anchor" is its character offset within the parent's text
      // — useful when the renderer wants to inline the child marker at its
      // semantic position inside the parent's body.
      const { stream, uid } = child.attrs;
      const inner = extractNoteNodeBody(child);
      children.push({
        stream,
        uid,
        text: inner.text,
        anchor: text.length,
        children: inner.children,
      });
    }
  });
  return { text, children };
}

function extractParagraph(paragraphNode) {
  const mainParts = [];
  const notes = []; // {stream, text, anchor, children}
  let mainPos = 0;
  let pending = null;

  function flushPending() {
    if (!pending) return;
    notes.push({
      stream: pending.stream,
      text: pending.text,
      anchor: pending.anchor,
      children: pending.children || [],
    });
    pending = null;
  }

  paragraphNode.forEach((child) => {
    if (child.isText) {
      const fnMark = child.marks.find((m) => m.type.name === "footnote");
      if (fnMark) {
        const { stream, uid } = fnMark.attrs;
        if (pending && pending.stream === stream && pending.uid === uid) {
          pending.text += child.text;
        } else {
          flushPending();
          pending = { stream, uid, text: child.text, anchor: mainPos, children: [] };
        }
      } else {
        flushPending();
        mainParts.push(child.text);
        mainPos += child.text.length;
      }
      return;
    }
    if (child.type.name === "noteNode") {
      // A noteNode breaks any pending mark-based note: it's a separate, structured
      // note with its own children. Its anchor is the current main-text position.
      flushPending();
      const { stream, uid } = child.attrs;
      const inner = extractNoteNodeBody(child);
      notes.push({
        stream,
        uid,
        text: inner.text,
        anchor: mainPos,
        children: inner.children,
      });
      // The noteNode itself contributes nothing to mainText (it's the apparatus,
      // not the body), so mainPos is unchanged.
    }
  });
  flushPending();

  return {
    mainText: mainParts.join(""),
    notes,
  };
}

// Walks a notes tree (parent + children + grandchildren ...) and assigns
// sequential per-stream display numbers in document order. Children are
// numbered AFTER their parent within the per-stream sequence.
function numberNotesInOrder(notesArr, counters) {
  for (const n of notesArr) {
    counters[n.stream] = (counters[n.stream] || 0) + 1;
    n.num = counters[n.stream];
    if (n.children && n.children.length) {
      numberNotesInOrder(n.children, counters);
    }
  }
}

export function docToPackerContent(doc) {
  const out = [];
  doc.forEach((paragraph) => out.push(extractParagraph(paragraph)));
  const counters = {};
  for (const p of out) {
    numberNotesInOrder(p.notes, counters);
  }
  return out;
}
