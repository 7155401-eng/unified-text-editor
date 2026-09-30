/**
 * Lightweight startup wiring for Text Compare Pro.
 *
 * The full tool imports its modal, comparison engine, DOCX reader and Nikud
 * Merger integration. None of those are needed until the user clicks the
 * already-rendered toolbar button, so keep startup on this tiny module and
 * load the full tool on demand.
 */
export function wireTextComparePro(paneManager) {
  if (paneManager) window.__tcpPaneManager = paneManager;

  document.querySelectorAll('[data-action="open-text-compare-pro"]').forEach((btn) => {
    if (btn.dataset.tcpWired) return;
    btn.dataset.tcpWired = "1";

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      try {
        const { openModal } = await import("./text_compare_pro.js");
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
