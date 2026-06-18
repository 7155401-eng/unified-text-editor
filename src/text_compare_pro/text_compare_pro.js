// text_compare_pro — main entry. Opens the comparator modal in the editor.
// Translated from work-files/text_compare_pro/ (Python + embedded WebView).

import "./text_compare_modal.css";
import { openModal as openTextCompareModal, closeModal } from "./text_compare_ui.js";
import { assertToolAllowed } from "../tool_runtime_gate.js";
import { openToolStartupOverlay } from "../tool_startup_overlay.js";

export async function openModal(options = {}) {
  const loader = openToolStartupOverlay({
    title: "השוואת טקסטים",
    message: "פותח חלון ומכין את הכלי…",
  });

  try {
    await Promise.resolve(); // let the loading UI paint before permission/vendor work starts
    loader.set(22, "בודק הרשאה…");
    await assertToolAllowed("text-compare-pro");

    loader.set(58, "טוען את חלון ההשוואה…");
    const modal = await openTextCompareModal(options);

    loader.set(100, "מוכן.");
    return modal;
  } finally {
    loader.close();
  }
}

/**
 * Wire a button into the host editor's toolbar that opens the modal.
 *
 * @param {object} paneManager — host's pane manager (used to read active stream content).
 */
export function wireTextComparePro(paneManager) {
  // Expose pane manager so the modal's "fill from active" can find it.
  if (paneManager) window.__tcpPaneManager = paneManager;

  // Attach handlers to any pre-existing buttons in the page.
  document.querySelectorAll('[data-action="open-text-compare-pro"]').forEach((btn) => {
    if (btn.dataset.tcpWired) return;
    btn.dataset.tcpWired = "1";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      try {
        await openModal({ prefillFromActive: true });
      } catch (err) {
        console.warn("[text-compare-pro] blocked:", err);
      } finally {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    });
  });
}

export { closeModal };
