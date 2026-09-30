function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/`/g, "&#96;");
}

export function wordInlineNodeHtml(node) {
  if (!node) return "";
  const NodeCtor = node.ownerDocument?.defaultView?.Node || globalThis.Node;
  if (NodeCtor && node.nodeType === NodeCtor.TEXT_NODE) return escapeHtml(node.nodeValue || "");
  if (NodeCtor && node.nodeType !== NodeCtor.ELEMENT_NODE) return "";

  const tag = node.tagName?.toLowerCase?.() || "";
  if (tag === "br") return "<br>";

  const inner = Array.from(node.childNodes || []).map(wordInlineNodeHtml).join("");
  switch (tag) {
    case "strong":
    case "b":
      return `<b>${inner}</b>`;
    case "em":
    case "i":
      return `<i>${inner}</i>`;
    case "u":
      return `<u>${inner}</u>`;
    case "s":
    case "strike":
    case "del":
      return `<s>${inner}</s>`;
    case "sup":
      return `<sup>${inner}</sup>`;
    case "sub":
      return `<sub>${inner}</sub>`;
    case "a": {
      const href = node.getAttribute("href") || "";
      return href ? `<a href="${escapeAttr(href)}">${inner}</a>` : inner;
    }
    case "span": {
      const style = node.getAttribute("style") || "";
      return style ? `<span style="${escapeAttr(style)}">${inner}</span>` : inner;
    }
    default:
      return inner;
  }
}

function wordEditorBlocksFromHtml(editorHtml, doc = globalThis.document) {
  if (!doc?.createElement) return [];
  const template = doc.createElement("template");
  template.innerHTML = String(editorHtml || "");
  const blocks = [];
  let inlineBuffer = "";
  const NodeCtor = doc.defaultView?.Node || globalThis.Node;

  const flushInlineBuffer = () => {
    if (!inlineBuffer) return;
    blocks.push(inlineBuffer);
    inlineBuffer = "";
  };

  for (const node of Array.from(template.content.childNodes)) {
    if (NodeCtor && node.nodeType === NodeCtor.ELEMENT_NODE && /^(p|div|li|h[1-6])$/i.test(node.tagName)) {
      flushInlineBuffer();
      blocks.push(Array.from(node.childNodes).map(wordInlineNodeHtml).join(""));
    } else {
      const html = wordInlineNodeHtml(node);
      if (html) inlineBuffer += html;
    }
  }
  flushInlineBuffer();
  return blocks;
}

export function wordRichFragmentFromEditorHtml(editorHtml, doc = globalThis.document) {
  // Streams/notes use <br> between real editor blocks. Hard <br> nodes that
  // already exist inside a block remain exactly where they were.
  return wordEditorBlocksFromHtml(editorHtml, doc).join("<br>");
}

export function wordMainFragmentFromEditorHtml(editorHtml, doc = globalThis.document) {
  // A hard break inside one editor block stays a hard break in Word.
  // Only a real editor block boundary becomes a new Word paragraph.
  return wordEditorBlocksFromHtml(editorHtml, doc)
    .join("</span></p>\n<p class=MsoNormal dir=RTL><span lang=HE>");
}
