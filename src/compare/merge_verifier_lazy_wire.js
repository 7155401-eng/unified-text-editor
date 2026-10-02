// חיבור קל של „בדיקת מיזוג" לסרגל. החלון והמנוע נטענים רק בלחיצה.

export function wireMergeVerifier(paneManager) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("merge-verify-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "merge-verify-btn";
    btn.type = "button";
    btn.textContent = "בדיקת מיזוג";
    btn.title = "משווה את התוצאה למקור ואומר אם משהו אבד — במספרים, בלי בוט ובלי לתקן דבר";
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openMergeVerifier } = await import("./merge_verifier_ui.js");
        openMergeVerifier({ paneManager: paneManager || window.paneManager });
      } catch (error) {
        console.error("[merge-verify]", error);
        alert("לא ניתן לפתוח את בדיקת המיזוג: " + (error?.message || error));
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
