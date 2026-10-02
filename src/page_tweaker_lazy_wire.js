// חיבור קל של „מכוון העמודים" לסרגל, בלי להכביד על הטעינה.
//
// הממשק עצמו (`page_tweaker_ui.js`) נטען רק כשלוחצים על הכפתור — בדיוק כמו
// „דוח עימוד". עד אז יש כאן כפתור ושורת קוד אחת, ולא יותר.

export function wirePageTweaker(paneManager, pagesContainer) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("page-tweaker-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "page-tweaker-btn";
    btn.type = "button";
    btn.textContent = "מכוון עמודים";
    btn.title = "כוונון ידני לכל עמוד: להוריד או למשוך שורות, להזיז זרמי הערות, ולסמן עמוד כמאושר";
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openPageTweaker } = await import("./page_tweaker_ui.js");
        openPageTweaker({ paneManager, pagesContainer });
      } catch (error) {
        console.error("[page-tweaker]", error);
        alert("לא ניתן לפתוח את מכוון העמודים: " + (error?.message || error));
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
