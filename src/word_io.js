import mammoth from "mammoth/mammoth.browser.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ravtext-src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", reject, { once: true });
      if (window.htmlDocx) resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.ravtextSrc = src;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadHtmlDocx() {
  if (window.htmlDocx && typeof window.htmlDocx.asBlob === "function") return window.htmlDocx;
  try {
    await loadScript("/node_modules/html-docx-js/dist/html-docx.js");
  } catch {
    return null;
  }
  return window.htmlDocx && typeof window.htmlDocx.asBlob === "function" ? window.htmlDocx : null;
}

function chooseDocxFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    input.addEventListener("change", () => resolve(input.files && input.files[0] ? input.files[0] : null), { once: true });
    input.click();
  });
}

export function getInlineHtml(editor) {
  const wrap = document.createElement("div");
  wrap.innerHTML = editor.getHTML();
  const blocks = Array.from(wrap.children);
  if (blocks.length === 0) return wrap.innerHTML;
  return blocks.map((el) => el.innerHTML || el.textContent || "").join("<br>");
}

function extractWordFootnotes(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const notes = [];
  const noteById = new Map();

  doc.querySelectorAll("li[id], div[id]").forEach((el) => {
    const id = el.id || "";
    if (!/footnote|endnote|note/i.test(id)) return;
    const clone = el.cloneNode(true);
    clone.querySelectorAll("a[href^='#']").forEach((a) => a.remove());
    const text = clone.textContent.trim();
    if (!text) return;
    noteById.set(id, text);
  });

  doc.querySelectorAll("sup a[href^='#'], a[href^='#']").forEach((a) => {
    const id = (a.getAttribute("href") || "").replace(/^#/, "");
    if (!noteById.has(id)) return;
    notes.push(noteById.get(id));
    const marker = doc.createTextNode("@01");
    const sup = a.closest("sup");
    if (sup) sup.replaceWith(marker);
    else a.replaceWith(marker);
  });

  doc.querySelectorAll("ol, ul").forEach((list) => {
    const hasOnlyNotes = Array.from(list.children).some((li) => noteById.has(li.id || ""));
    if (hasOnlyNotes) list.remove();
  });

  return {
    mainHtml: doc.body.innerHTML || html,
    notes,
  };
}

export async function importWord(paneManager) {
  const file = await chooseDocxFile();
  if (!file) return false;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const { mainHtml, notes } = extractWordFootnotes(result.value || "");

    let main = paneManager.getMainPane();
    if (!main) main = paneManager.addPane({ streamCode: null, label: "ראשי" });
    if (main && main.editor) main.editor.commands.setContent(mainHtml || "<p></p>");

    if (notes.length > 0) {
      let streamPane = paneManager.panes.find((p) => p.streamCode === "01");
      if (!streamPane) {
        streamPane = paneManager.addPane({ streamCode: "01", symbol: "@01", label: "זרם 01" });
      }
      if (streamPane && streamPane.editor) {
        const html = notes
          .map((note, idx) => `<p>@01 [${idx + 1}] ${escapeHtml(note)}</p>`)
          .join("");
        streamPane.editor.commands.setContent(html);
      }
    }

    if (result.messages && result.messages.length) {
      console.warn("[word import]", result.messages);
    }
    return true;
  } catch (err) {
    console.error("Word import failed:", err);
    alert("שגיאה בייבוא Word: " + err.message);
    return false;
  }
}

export async function exportWord(paneManager) {
  const main = paneManager.getMainPane();
  if (!main || !main.editor) {
    alert("אין חלונית ראשית - לא ניתן לייצא");
    return false;
  }

  let mainRich = getInlineHtml(main.editor);
  let mc = mainRich
    .split("<br>")
    .map((line) => `<p class=MsoNormal dir=RTL><span lang=HE>${line}</span></p>`)
    .join("\n");

  const symConfigs = [];
  for (const p of paneManager.panes) {
    if (!p.streamCode || !p.editor) continue;
    const sym = p.symbol || `@${p.streamCode}`;
    const noteRich = getInlineHtml(p.editor);
    const parts = noteRich.split(sym);
    if (parts.length > 0 && parts[0].trim() === "") parts.shift();
    symConfigs.push({ symbol: sym, prefix: `[${p.streamCode}] `, parts, counter: 0 });
  }

  let fnHTML = "";
  let nc = 1;
  if (symConfigs.length > 0) {
    symConfigs.sort((a, b) => b.symbol.length - a.symbol.length);
    const regex = new RegExp(`(${symConfigs.map((c) => escapeRegex(c.symbol)).join("|")})`, "g");
    mc = mc.replace(regex, (match) => {
      const cfg = symConfigs.find((c) => c.symbol === match);
      if (!cfg || cfg.counter >= cfg.parts.length) return match;
      const note = cfg.parts[cfg.counter++].trim().replace(/<br>/g, " ");
      const id = nc++;
      fnHTML +=
        `<div style='mso-element:footnote' id='ftn${id}'>` +
        `<p class="MsoFootnoteText" dir="RTL">` +
        `<a style='mso-footnote-id:ftn${id}' href='#_ftnref${id}' name='_ftn${id}'>` +
        `<span class='MsoFootnoteReference'><span style='mso-special-character:footnote'></span></span></a>` +
        `<span dir="rtl" lang="HE"> <b>${cfg.prefix}</b> ${note}</span>` +
        `</p></div>`;
      return (
        `<a style='mso-footnote-id:ftn${id}; vertical-align:super; font-size:80%;' ` +
        `href='#_ftn${id}' name='_ftnref${id}'>` +
        `<span class='MsoFootnoteReference'><span style='mso-special-character:footnote'></span></span></a>`
      );
    });
  }

  const fullHtml =
    `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="UTF-8"><style>` +
    `body{direction:rtl;font-family:'David','Times New Roman',serif;}` +
    `p.MsoNormal{direction:rtl;text-align:right;}` +
    `p.MsoFootnoteText{font-size:10pt;direction:rtl;text-align:right;}` +
    `</style></head><body lang="HE" dir="rtl">` +
    mc +
    `<div style="mso-element:footnote-list">${fnHTML}</div>` +
    `</body></html>`;

  try {
    const htmlDocx = await loadHtmlDocx();
    if (htmlDocx) {
      const blob = htmlDocx.asBlob(fullHtml, {
        orientation: "portrait",
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      });
      downloadBlob(blob, `ravtext-export-${Date.now()}.docx`);
    } else {
      const blob = new Blob(["\ufeff", fullHtml], { type: "application/msword;charset=utf-8" });
      downloadBlob(blob, `ravtext-export-${Date.now()}.doc`);
    }
    return true;
  } catch (err) {
    console.error("Word export failed:", err);
    alert("שגיאה בייצוא Word: " + err.message);
    return false;
  }
}
