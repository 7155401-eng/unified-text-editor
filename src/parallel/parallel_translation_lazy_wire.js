// חיבור קל של „תרגום מקביל" לסרגל. החלון והמנוע נטענים רק בלחיצה.

export function wireParallelTranslation(paneManager) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("parallel-translation-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "parallel-translation-btn";
    btn.type = "button";
    btn.textContent = "תרגום מקביל";
    btn.title = "תרגום בעמודה קבועה לצד הטקסט, פסקה מול פסקה — להבדיל מהערת צד שזורמת";
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openParallelTranslation } = await import("./parallel_translation_ui.js");
        openParallelTranslation({ paneManager: paneManager || window.paneManager });
      } catch (error) {
        console.error("[parallel]", error);
        alert("לא ניתן לפתוח את התרגום המקביל: " + (error?.message || error));
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
