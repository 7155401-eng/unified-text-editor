// חיבור קל של „הקרא טקסט" לסרגל, בלי להכביד על הטעינה.
//
// החלון עצמו (`tts_ui.js`) והמנוע שלו נטענים רק כשלוחצים על הכפתור.

export function wireTts(paneManager) {
  if (paneManager && typeof window !== "undefined") window.__ravtextTtsPaneManager = paneManager;

  const attach = () => {
    const buttons = document.querySelectorAll('[data-action="open-tts"]');
    if (!buttons.length) return false;

    buttons.forEach((btn) => {
      if (btn.dataset.ttsWired) return;
      btn.dataset.ttsWired = "1";
      btn.setAttribute("aria-haspopup", "dialog");

      btn.addEventListener("click", async () => {
        try {
          btn.disabled = true;
          btn.setAttribute("aria-busy", "true");
          const { openTtsDialog } = await import("./tts_ui.js");
          openTtsDialog({ paneManager: paneManager || window.paneManager });
        } catch (error) {
          console.error("[tts]", error);
          alert("לא ניתן לפתוח את חלון ההקראה: " + (error?.message || error));
        } finally {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
        }
      });
    });
    return true;
  };

  if (attach()) return;
  let tries = 0;
  const timer = setInterval(() => {
    if (attach() || ++tries > 40) clearInterval(timer);
  }, 100);
}
