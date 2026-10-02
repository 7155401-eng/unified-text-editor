// חיבור קל של „עיצוב כותרת" לסרגל, והחלת ההגדרה השמורה בטעינה.

import { applyHeaderStyle, loadHeaderStyle, markPageParity } from "./header_styles.js";

export function wireHeaderStyles(pagesContainer) {
  // ההגדרה השמורה מוחלת מיד — בלי לטעון את החלון, ובלי שעון.
  try {
    applyHeaderStyle(loadHeaderStyle());
    if (pagesContainer) markPageParity(pagesContainer);
  } catch { /* אין הגדרה שמורה */ }

  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("header-styles-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "header-styles-btn";
    btn.type = "button";
    btn.textContent = "עיצוב כותרת";
    btn.title = "גופן, גודל, הדגשה ויישור לכותרת ולתחתית — כולל יישור שמתחלף בין עמוד זוגי לאי-זוגי";
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openHeaderStyles } = await import("./header_styles_ui.js");
        openHeaderStyles({ pagesContainer });
      } catch (error) {
        console.error("[header-styles]", error);
        alert("לא ניתן לפתוח את עיצוב הכותרת: " + (error?.message || error));
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
