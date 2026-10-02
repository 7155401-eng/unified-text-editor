// חיבור קל של „עיצוב סוגריים" לסרגל. החלון והמנוע נטענים רק בלחיצה.

export function wireBracketStyles(paneManager) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("bracket-styles-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "bracket-styles-btn";
    btn.type = "button";
    btn.textContent = "עיצוב סוגריים";
    btn.title = "לעצב את מה שבתוך הסוגריים — גודל, פונט וסגנון, לכל סוג סוגריים ולכל חלונית בנפרד";
    btn.setAttribute("aria-haspopup", "dialog");

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openBracketStyles } = await import("./bracket_styles_ui.js");
        openBracketStyles({ paneManager: paneManager || window.paneManager });
      } catch (error) {
        console.error("[bracket-styles]", error);
        alert("לא ניתן לפתוח את עיצוב הסוגריים: " + (error?.message || error));
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
  const timer = setInterval(() => { if (attach() || ++tries > 40) clearInterval(timer); }, 100);
}
