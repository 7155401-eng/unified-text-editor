// Hover bubble for @XX markers anywhere in the editor.
//
// Shows what content the marker resolves to: the stream's label + a snippet
// of the corresponding note from that stream's pane. Works for any
// .stream-marker element — main body markers, and (importantly) markers
// embedded inside another stream pane's note text (the nested-notes case
// — "הערה על הערה").
//
// The bubble is a single floating element appended to <body>. It's
// positioned next to the hovered marker and hidden on mouseleave.

import { defaultLabelForCode } from "./engine_bridge.js";

let _bubbleEl = null;
let _hideTimer = null;

function ensureBubble() {
  if (_bubbleEl && document.body.contains(_bubbleEl)) return _bubbleEl;
  const el = document.createElement("div");
  el.className = "nested-notes-bubble";
  el.style.display = "none";
  el.setAttribute("role", "tooltip");
  document.body.appendChild(el);
  _bubbleEl = el;
  return el;
}

// Pull the raw text of the N-th note from a stream pane (1-based num).
// Strips a leading display-number prefix like "[3] " so the snippet is clean.
function lookupNoteText(paneManager, streamCode, num) {
  if (!paneManager || !streamCode || !num || num < 1) return null;
  const pane = paneManager.panes.find((p) => p.streamCode === streamCode);
  if (!pane || !pane.editor) return null;
  const sym = pane.symbol || `@${streamCode}`;
  const fullText = pane.editor.state.doc.textContent || "";
  const parts = fullText.split(sym);
  if (parts.length <= 1) return null;
  parts.shift(); // first chunk is anything before the first marker — discard
  const raw = (parts[num - 1] || "").trim();
  if (!raw) return null;
  // Strip a leading "[N] " or "[N.M] " bracketed display number.
  return raw.replace(/^\[[\d.]+\]\s*/, "");
}

function hideBubble() {
  if (_bubbleEl) _bubbleEl.style.display = "none";
}

function positionBubble(el, target) {
  const rect = target.getBoundingClientRect();
  // Default: bubble below the marker. If too close to bottom, place above.
  const VIEWPORT_PAD = 8;
  el.style.display = "block";
  el.style.visibility = "hidden";
  // Force layout to measure size.
  const bw = el.offsetWidth;
  const bh = el.offsetHeight;
  let top = rect.bottom + 6;
  if (top + bh > window.innerHeight - VIEWPORT_PAD) {
    top = rect.top - bh - 6;
  }
  // Right-aligned below for RTL: align bubble's right edge to marker's right.
  let left = rect.right - bw;
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  if (left + bw > window.innerWidth - VIEWPORT_PAD) {
    left = window.innerWidth - VIEWPORT_PAD - bw;
  }
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = "visible";
}

function showBubbleFor(markerEl, paneManager) {
  const code = markerEl.getAttribute("data-stream");
  const numAttr = markerEl.getAttribute("data-num");
  const num = numAttr ? parseInt(numAttr, 10) : null;
  if (!code) return;
  const bubble = ensureBubble();
  bubble.innerHTML = "";

  const labelLine = document.createElement("div");
  labelLine.className = "nnb-label";
  const labelText = defaultLabelForCode(code);
  labelLine.textContent = num
    ? `${labelText} — הערה ${num}`
    : labelText;
  bubble.appendChild(labelLine);

  const snippet = document.createElement("div");
  const text = lookupNoteText(paneManager, code, num);
  if (text) {
    snippet.className = "nnb-snippet";
    const trimmed = text.length > 240 ? text.substring(0, 240).trimEnd() + "…" : text;
    snippet.textContent = trimmed;
  } else {
    snippet.className = "nnb-empty";
    snippet.textContent = "אין תוכן בחלונית הזרם";
  }
  bubble.appendChild(snippet);
  positionBubble(bubble, markerEl);
}

export function installNestedNotesBubble(paneManager) {
  if (typeof document === "undefined") return;
  // Delegated handlers — work for marker elements that appear after install
  // (auto-detect plugin wraps @XX as the user types).
  document.addEventListener("mouseover", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const marker = t.closest(".stream-marker");
    if (!marker) return;
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    showBubbleFor(marker, paneManager);
  }, true);
  document.addEventListener("mouseout", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const marker = t.closest(".stream-marker");
    if (!marker) return;
    // Small delay so quick re-enter (e.g., moving across whitespace inside
    // the marker) doesn't cause flicker.
    if (_hideTimer) clearTimeout(_hideTimer);
    _hideTimer = setTimeout(hideBubble, 80);
  }, true);
  // Hide on scroll/resize so the bubble doesn't dangle in the wrong spot.
  window.addEventListener("scroll", hideBubble, true);
  window.addEventListener("resize", hideBubble);
}
