// חיבור קל של „תיקונים גלובליים" לסרגל. החלון והמנוע נטענים רק בלחיצה.

export function wireGlobalFixes(paneManager) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("global-fixes-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "global-fixes-btn";
    btn.type = "button";
    btn.textContent = "תיקונים גלובליים";
    btn.title = "26 תיקוני טקסט מהתוכנה הקודמת — רווחים, פיסוק, גרשיים עבריים וסוגריים. עם תצוגה מקדימה וביטול";
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openGlobalFixes } = await import("./global_fixes_ui.js");
        openGlobalFixes({ paneManager: paneManager || window.paneManager });
      } catch (error) {
        console.error("[global-fixes]", error);
        alert("לא ניתן לפתוח את התיקונים הגלובליים: " + (error?.message || error));
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
