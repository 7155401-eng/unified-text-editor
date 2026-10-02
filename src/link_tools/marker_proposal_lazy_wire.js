// חיבור קל של „הצעת קישורים" לסרגל. החלון והמנוע נטענים רק בלחיצה.

export function wireMarkerProposal(paneManager) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("marker-proposal-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "marker-proposal-btn";
    btn.type = "button";
    btn.textContent = "הצעת קישורים";
    btn.title = "בודק לכל הערה איפה הדיבור המתחיל שלה נמצא בטקסט הראשי — ומראה הצעה בלי לשנות דבר";
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openMarkerProposal } = await import("./marker_proposal_ui.js");
        openMarkerProposal({ paneManager: paneManager || window.paneManager });
      } catch (error) {
        console.error("[marker-proposal]", error);
        alert("לא ניתן לפתוח את הצעת הקישורים: " + (error?.message || error));
      } finally {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    });

    group.appendChild(btn);
    return true;
  };

  if (attach()) return;
  let tries = 0;
  const timer = setInterval(() => {
    if (attach() || ++tries > 40) clearInterval(timer);
  }, 100);
}
