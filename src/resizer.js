// resizer.js - גרירה לשינוי גודל בין חלוניות
// תרגום ישיר של initResizer מ-Quill (text_compare_pro/web/editor/index.html, שורות 662-714)

export function initResizer(resizer) {
  let startX, startWidthPrev, startWidthNext;
  let prevPane, nextPane;

  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    prevPane = resizer.previousElementSibling;
    nextPane = resizer.nextElementSibling;
    if (!prevPane || !nextPane) return;

    if (!prevPane.classList.contains("pane") || !nextPane.classList.contains("pane")) return;

    startX = e.clientX;
    startWidthPrev = prevPane.getBoundingClientRect().width;
    startWidthNext = nextPane.getBoundingClientRect().width;

    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";

    document.addEventListener("mousemove", resize);
    document.addEventListener("mouseup", stopResize);
  });

  function resize(e) {
    const dx = e.clientX - startX;
    const prevRect = prevPane.getBoundingClientRect();
    const nextRect = nextPane.getBoundingClientRect();

    let newPrevWidth, newNextWidth;

    if (prevRect.left < nextRect.left) {
      newPrevWidth = startWidthPrev + dx;
      newNextWidth = startWidthNext - dx;
    } else {
      newPrevWidth = startWidthPrev - dx;
      newNextWidth = startWidthNext + dx;
    }

    const parentWidth = resizer.parentElement.clientWidth;
    const prevPct = (newPrevWidth / parentWidth) * 100;
    const nextPct = (newNextWidth / parentWidth) * 100;

    if (prevPct > 5 && nextPct > 5) {
      prevPane.style.flex = `0 0 ${prevPct}%`;
      nextPane.style.flex = `0 0 ${nextPct}%`;
    }
  }

  function stopResize() {
    resizer.classList.remove("dragging");
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", resize);
    document.removeEventListener("mouseup", stopResize);
  }
}
