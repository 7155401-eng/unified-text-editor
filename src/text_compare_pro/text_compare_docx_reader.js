// Read raw text from .docx using mammoth (browser port of engine/docx_reader.py).
// The Python version used zipfile+xml; in the browser we use mammoth which
// already handles the same word/document.xml extraction. Output is the raw
// paragraph text — same as read_docx_text(path).

export function readDocx(file) {
  return new Promise((resolve, reject) => {
    if (typeof window.mammoth === "undefined") {
      return reject(new Error("ספריית קריאת Word לא נטענה"));
    }
    const r = new FileReader();
    r.onload = (e) => {
      window.mammoth
        .extractRawText({ arrayBuffer: e.target.result })
        .then((out) => {
          if (out.messages && out.messages.length) console.log("mammoth:", out.messages);
          resolve(out.value);
        })
        .catch((err) => reject(err));
    };
    r.onerror = () => reject(new Error("קריאה נכשלה"));
    r.readAsArrayBuffer(file);
  });
}

export function readText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = () => rej(new Error("קריאה נכשלה"));
    r.readAsText(file, "UTF-8");
  });
}
