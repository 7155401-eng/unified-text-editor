// Lightweight startup wire for the final-layout diagnostics report.
// Keep the measurement/report implementation out of the startup bundle; load it
// only when the user explicitly asks for the report.

const PAGE_SELECTOR = ".page:not(.page-placeholder):not(.ravtext-empty-page)";

export function wireLayoutAnalysisReport(pagesContainer) {
  const attach = () => {
    const group = document.getElementById("render-safety-diagnostics-group");
    if (!group) return false;
    if (document.getElementById("layout-analysis-report-btn")) return true;

    const btn = document.createElement("button");
    btn.id = "layout-analysis-report-btn";
    btn.type = "button";
    btn.textContent = "דוח עימוד";
    btn.title = "בדיקת רווחים, גלישות, חפיפות, ברכיים ואיזון טורים בעמודים הסופיים";

    btn.addEventListener("click", async () => {
      const pages = pagesContainer?.querySelectorAll?.(PAGE_SELECTOR) || [];
      if (!pages.length) {
        alert("אין עדיין עמודים מוכנים לבדיקה. יש לרנדר תחילה.");
        return;
      }

      try {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const { openLayoutAnalysisReport } = await import("./layout_analysis_report.js");
        openLayoutAnalysisReport(pagesContainer);
      } catch (error) {
        console.error("[layout-report]", error);
        alert("לא ניתן להפיק דוח עימוד: " + (error?.message || error));
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
