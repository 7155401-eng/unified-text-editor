// engine_toolbar.js - סרגל תצוגת עמודים בסגנון PDF.js
// מבוסס על prosemirror-edition/src/main.js מהמקור האחרון.

import { downloadPagesAsPdf } from "./pdf_export.js";
import { ensureDemoAccess, prepareDemoPrintWatermark } from "./demo_mode.js";
import { isOutputBackgroundEnabled } from "./page_settings.js";
import { downloadPagesAsHtml, downloadDebugSnapshot, toggleProblemHighlight } from "./debug_export.js";

export function setupPdfToolbar(pagesContainer) {
  const toolbar = {
    pageInput: document.getElementById("pdf-page-input"),
    pageTotal: document.getElementById("pdf-page-total"),
    zoomLabel: document.getElementById("pdf-zoom-label"),
    zoom: 1,
    total: 0,
  };
  let thumbObserver = null;
  let activeThumbIndex = -1;
  let scrollRaf = 0;

  function applyZoom() {
    const pages = pagesContainer.querySelectorAll(".page");
    for (const p of pages) {
      p.style.zoom = toolbar.zoom;
    }
    if (toolbar.zoomLabel) {
      toolbar.zoomLabel.textContent = `${Math.round(toolbar.zoom * 100)}%`;
    }
  }

  function rememberBaseSize() {
    const first = getPageElement(0) || pagesContainer.querySelector(".page");
    if (!first || first.dataset.baseW) return;
    first.dataset.baseW = String(first.offsetWidth || 380);
    first.dataset.baseH = String(first.offsetHeight || 537);
  }

  function goToPage(n) {
    if (!toolbar.total) return;
    const idx = Math.max(0, Math.min(toolbar.total - 1, n - 1));
    if (typeof pagesContainer.__realizePage === "function") {
      pagesContainer.__realizePage(idx);
      if (idx + 1 < toolbar.total) pagesContainer.__realizePage(idx + 1);
    }
    const target = pagesContainer.querySelector(`.page[data-page-index="${idx}"]`);
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    if (toolbar.pageInput) toolbar.pageInput.value = String(idx + 1);
    highlightActiveThumb();
  }

  function updateCurrentPageFromScroll() {
    if (!toolbar.total) return;
    const first = getPageElement(0) || pagesContainer.querySelector(".page");
    if (!first) return;
    const second = getPageElement(1);
    const step = second
      ? Math.max(1, second.offsetTop - first.offsetTop)
      : Math.max(1, first.offsetHeight + 16);
    const raw = (pagesContainer.scrollTop - first.offsetTop + 12) / step;
    const bestIdx = Math.max(0, Math.min(toolbar.total - 1, Math.round(raw)));
    if (toolbar.pageInput && document.activeElement !== toolbar.pageInput) {
      toolbar.pageInput.value = String(bestIdx + 1);
    }
    highlightActiveThumb(bestIdx);
  }

  function fitWidth() {
    const containerWidth = pagesContainer.clientWidth - 32;
    return Math.max(0.3, Math.min(3, containerWidth / 380));
  }

  function fitAuto() {
    return Math.min(1, fitWidth());
  }

  function setZoomFromSelect(value) {
    if (value === "auto") toolbar.zoom = fitAuto();
    else if (value === "fit") toolbar.zoom = fitWidth();
    else if (value === "actual") toolbar.zoom = 1;
    else {
      const n = parseFloat(value);
      if (Number.isFinite(n) && n > 0) toolbar.zoom = n;
    }
    applyZoom();
  }

  function getPageElement(index) {
    if (typeof pagesContainer.__getPageElement === "function") {
      return pagesContainer.__getPageElement(index);
    }
    return pagesContainer.querySelector(`.page[data-page-index="${index}"]`);
  }

  function renderThumb(mini, index) {
    if (!mini || mini.dataset.thumbReady === "1") return true;
    if (typeof pagesContainer.__realizePage === "function") {
      pagesContainer.__realizePage(index);
    }
    const page = getPageElement(index);
    if (!page || page.classList.contains("page-placeholder")) return false;

    const clone = page.cloneNode(true);
    clone.classList.add("pdf-thumb-page");
    // v33: clear all v33 inline-style modifications that might have been set
    // on the source page (shrink/flex/overflow/dataset) so the thumbnail
    // shows the canonical 380×537 page even if the source was shrunk.
    clone.style.zoom = "1";
    clone.style.width = "380px";
    clone.style.height = "537px";
    clone.style.flex = "none";
    clone.style.minHeight = "537px";
    clone.style.maxHeight = "537px";
    clone.style.overflow = "hidden";
    clone.style.transform = "scale(1)";
    clone.style.transformOrigin = "top right"; // RTL anchor
    delete clone.dataset.talmudPageShrunk;
    delete clone.dataset.talmudPageHidden;

    mini.innerHTML = "";
    mini.appendChild(clone);
    mini.dataset.thumbReady = "1";

    requestAnimationFrame(() => {
      const scale = (mini.clientWidth || 132) / 380;
      clone.style.transform = `scale(${scale})`;
    });
    return true;
  }

  function rebuildSidebar() {
    const sidebar = document.getElementById("pdf-sidebar");
    if (!sidebar) return;
    if (thumbObserver) thumbObserver.disconnect();
    thumbObserver = "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const mini = entry.target;
          const idx = parseInt(mini.dataset.pageIndex || "0", 10);
          // Task #9: don't unobserve until renderThumb actually succeeded —
          // otherwise a placeholder/realize race kills the thumb forever.
          requestAnimationFrame(() => {
            if (renderThumb(mini, idx)) {
              thumbObserver.unobserve(mini);
            } else {
              // schedule a retry shortly; the placeholder should resolve
              setTimeout(() => {
                if (renderThumb(mini, idx)) thumbObserver.unobserve(mini);
              }, 250);
            }
          });
        }
      }, { root: sidebar, rootMargin: "120px 0px" })
      : null;
    sidebar.innerHTML = "";
    for (let i = 0; i < toolbar.total; i++) {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "pdf-thumb";
      t.dataset.pageIndex = String(i);
      const mini = document.createElement("div");
      mini.className = "pdf-thumb-mini";
      mini.dataset.pageIndex = String(i);
      t.appendChild(mini);
      const lbl = document.createElement("span");
      lbl.textContent = String(i + 1);
      t.appendChild(lbl);
      t.addEventListener("click", () => goToPage(i + 1));
      sidebar.appendChild(t);
      if (thumbObserver) thumbObserver.observe(mini);
      else setTimeout(() => renderThumb(mini, i), 0);
    }
    highlightActiveThumb();
    requestAnimationFrame(() => {
      const minis = Array.from(sidebar.querySelectorAll(".pdf-thumb-mini"));
      minis.slice(0, 4).forEach((mini) => {
        const idx = parseInt(mini.dataset.pageIndex || "0", 10);
        renderThumb(mini, idx);
      });
    });
  }

  function highlightActiveThumb(activeIndex = null) {
    const sidebar = document.getElementById("pdf-sidebar");
    if (!sidebar || sidebar.hidden) return;
    const active = activeIndex === null
      ? parseInt(toolbar.pageInput?.value || "1", 10) - 1
      : activeIndex;
    if (active === activeThumbIndex) return;
    const prev = sidebar.querySelector(`.pdf-thumb[data-page-index="${activeThumbIndex}"]`);
    const next = sidebar.querySelector(`.pdf-thumb[data-page-index="${active}"]`);
    if (prev) prev.classList.remove("active");
    if (next) next.classList.add("active");
    activeThumbIndex = active;
  }

  function scheduleScrollUpdate() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateCurrentPageFromScroll();
    });
  }

  function realizePageBatch(start, end) {
    if (typeof pagesContainer.__realizePage !== "function") return;
    for (let i = start; i < end; i++) {
      if (i >= 0 && i < toolbar.total) pagesContainer.__realizePage(i);
    }
  }

  const find = {
    query: "",
    hits: [],
    current: -1,
  };

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  function clearFindHighlights() {
    for (const h of find.hits) {
      if (h.el && h.originalText !== undefined) {
        h.el.textContent = h.originalText;
      }
    }
    find.hits = [];
    find.current = -1;
    const status = document.getElementById("pdf-find-status");
    if (status) status.textContent = "";
  }

  function focusCurrentHit() {
    if (find.current < 0 || find.current >= find.hits.length) return;
    const hit = find.hits[find.current];
    for (const m of pagesContainer.querySelectorAll("mark.pdf-find-hit-current")) {
      m.classList.remove("pdf-find-hit-current");
    }
    const firstMark = hit.el.querySelector("mark.pdf-find-hit");
    if (firstMark) {
      firstMark.classList.add("pdf-find-hit-current");
      firstMark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function runFind(query) {
    clearFindHighlights();
    find.query = query || "";
    if (!find.query.trim()) return;
    if (typeof pagesContainer.__realizePage === "function") {
      for (let i = 0; i < toolbar.total; i++) pagesContainer.__realizePage(i);
    }
    const q = find.query;
    const lowerQ = q.toLowerCase();
    const allEls = pagesContainer.querySelectorAll(".page p, .page .note, .page .stream-title");
    const hitElements = [];
    for (const el of allEls) {
      const txt = el.textContent || "";
      if (txt.toLowerCase().includes(lowerQ)) {
        hitElements.push({ el, txt });
      }
    }
    for (const { el, txt } of hitElements) {
      const original = txt;
      const lc = original.toLowerCase();
      let html = "";
      let i = 0;
      while (i < original.length) {
        const found = lc.indexOf(lowerQ, i);
        if (found === -1) {
          html += escapeHTML(original.substring(i));
          break;
        }
        html += escapeHTML(original.substring(i, found));
        html += `<mark class="pdf-find-hit">${escapeHTML(original.substring(found, found + q.length))}</mark>`;
        i = found + q.length;
      }
      el.innerHTML = html;
      find.hits.push({ el, originalText: original });
    }
    const status = document.getElementById("pdf-find-status");
    if (status) {
      status.textContent = find.hits.length === 0 ? "אין תוצאות" : `${find.hits.length} התאמות`;
    }
    if (find.hits.length > 0) {
      find.current = 0;
      focusCurrentHit();
    }
  }

  function realizeAllPages() {
    realizePageBatch(0, toolbar.total);
  }

  document.getElementById("pdf-first")?.addEventListener("click", () => goToPage(1));
  document.getElementById("pdf-prev")?.addEventListener("click", () => {
    const n = parseInt(toolbar.pageInput?.value || "1", 10) || 1;
    goToPage(n - 1);
  });
  document.getElementById("pdf-next")?.addEventListener("click", () => {
    const n = parseInt(toolbar.pageInput?.value || "1", 10) || 1;
    goToPage(n + 1);
  });
  document.getElementById("pdf-last")?.addEventListener("click", () => goToPage(toolbar.total));
  toolbar.pageInput?.addEventListener("change", () => {
    const n = parseInt(toolbar.pageInput.value, 10);
    if (Number.isFinite(n)) goToPage(n);
  });

  // משה 2026-05-07: כפתורי גלילה במציג. כל לחיצה גוללת ~80% מגובה החלון
  // הנראה — מספיק לחפיפה קלה כדי שהמשתמש יוכל לעקוב אחרי הטקסט. גלילה
  // חלקה מובטחת ע"י scroll-behavior:smooth ב-CSS. גלילת מסך מגע ומגלגל
  // עכבר ממשיכה לעבוד דרך overflow:auto הטבעי של המכל.
  function scrollViewerBy(deltaPx) {
    if (!pagesContainer) return;
    pagesContainer.scrollBy({ top: deltaPx, left: 0, behavior: "smooth" });
  }
  document.getElementById("pdf-scroll-up")?.addEventListener("click", () => {
    const step = Math.max(120, Math.round((pagesContainer?.clientHeight || 600) * 0.8));
    scrollViewerBy(-step);
  });
  document.getElementById("pdf-scroll-down")?.addEventListener("click", () => {
    const step = Math.max(120, Math.round((pagesContainer?.clientHeight || 600) * 0.8));
    scrollViewerBy(step);
  });

  // אינדיקטור-גלילה דק בראש המציג — נמלא לפי מיקום הגלילה.
  const progressFill = document.querySelector("#pdf-scroll-progress .pdf-scroll-progress-fill");
  if (progressFill && pagesContainer) {
    let progressRaf = 0;
    const updateProgress = () => {
      progressRaf = 0;
      const h = pagesContainer.scrollHeight - pagesContainer.clientHeight;
      const pct = h > 0 ? Math.min(100, Math.max(0, (pagesContainer.scrollTop / h) * 100)) : 0;
      progressFill.style.width = pct + "%";
    };
    pagesContainer.addEventListener("scroll", () => {
      if (progressRaf) return;
      progressRaf = requestAnimationFrame(updateProgress);
    }, { passive: true });
    // עדכון ראשוני + אחרי שינוי-תוכן (renderer אירוע).
    updateProgress();
    window.addEventListener("ravtext:engine-rendered", () => {
      requestAnimationFrame(updateProgress);
    });
  }

  const zoomSelect = document.getElementById("pdf-zoom-select");
  document.getElementById("pdf-zoom-in")?.addEventListener("click", () => {
    toolbar.zoom = Math.min(3, toolbar.zoom + 0.1);
    applyZoom();
    if (zoomSelect) zoomSelect.value = "actual";
  });
  document.getElementById("pdf-zoom-out")?.addEventListener("click", () => {
    toolbar.zoom = Math.max(0.3, toolbar.zoom - 0.1);
    applyZoom();
    if (zoomSelect) zoomSelect.value = "actual";
  });
  zoomSelect?.addEventListener("change", () => setZoomFromSelect(zoomSelect.value));

  const findInput = document.getElementById("pdf-find-input");
  if (findInput) {
    let findTimer = null;
    findInput.addEventListener("input", () => {
      clearTimeout(findTimer);
      findTimer = setTimeout(() => runFind(findInput.value), 200);
    });
    findInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || find.hits.length === 0) return;
      e.preventDefault();
      find.current = e.shiftKey
        ? (find.current - 1 + find.hits.length) % find.hits.length
        : (find.current + 1) % find.hits.length;
      focusCurrentHit();
    });
  }
  document.getElementById("pdf-find-prev")?.addEventListener("click", () => {
    if (find.hits.length === 0) return;
    find.current = (find.current - 1 + find.hits.length) % find.hits.length;
    focusCurrentHit();
  });
  document.getElementById("pdf-find-next")?.addEventListener("click", () => {
    if (find.hits.length === 0) return;
    find.current = (find.current + 1) % find.hits.length;
    focusCurrentHit();
  });

  document.getElementById("pdf-print")?.addEventListener("click", () => {
    try {
      ensureDemoAccess();
      realizeAllPages();
      const includeBackgrounds = isOutputBackgroundEnabled();
      document.body.classList.toggle("print-with-background", includeBackgrounds);
      const cleanup = prepareDemoPrintWatermark(pagesContainer);
      let cleaned = false;
      const cleanupOnce = () => {
        if (cleaned) return;
        cleaned = true;
        cleanup();
        document.body.classList.remove("print-with-background");
        window.removeEventListener("afterprint", cleanupOnce);
      };
      window.addEventListener("afterprint", cleanupOnce, { once: true });
      setTimeout(() => {
        window.print();
        setTimeout(cleanupOnce, 2500);
      }, 50);
    } catch (err) {
      console.error("PDF print failed:", err);
      alert(err.message);
    }
  });
  document.getElementById("pdf-download")?.addEventListener("click", async (ev) => {
    realizeAllPages();
    const btn = ev.currentTarget;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "מכין PDF...";
    try {
      await downloadPagesAsPdf(pagesContainer, {
        filename: "ravtext-preview.pdf",
        includeBackgrounds: isOutputBackgroundEnabled(),
        onProgress(page, total) {
          btn.textContent = `PDF ${page}/${total}`;
        },
      });
    } catch (err) {
      console.error("PDF export failed:", err);
      alert(`שגיאת הורדת PDF: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // v33: HTML download — self-contained snapshot for offline debugging.
  // CRITICAL: do NOT call realizeAllPages — that would re-run the layout
  // pipeline and change what we're trying to capture. Snapshot the page
  // exactly as the user is seeing it right now.
  document.getElementById("pdf-download-html")?.addEventListener("click", () => {
    try {
      downloadPagesAsHtml(pagesContainer);
    } catch (err) {
      console.error("HTML export failed:", err);
      alert(`שגיאת הורדת HTML: ${err.message}`);
    }
  });

  // v33: JSON snapshot — every page's metrics/state for diff'ing.
  // Same rule: NO realize. Capture as-is.
  document.getElementById("pdf-debug-snapshot")?.addEventListener("click", () => {
    try {
      downloadDebugSnapshot(pagesContainer);
    } catch (err) {
      console.error("Snapshot failed:", err);
      alert(`שגיאת צילום מצב: ${err.message}`);
    }
  });

  // v33: visual highlight — toggle colored outlines on problematic pages.
  // Same rule: NO realize. Highlight currently rendered pages only.
  document.getElementById("pdf-debug-highlight")?.addEventListener("click", (ev) => {
    try {
      toggleProblemHighlight(pagesContainer);
      ev.currentTarget.classList.toggle("active");
    } catch (err) {
      console.error("Highlight failed:", err);
      alert(`שגיאת הדגשה: ${err.message}`);
    }
  });

  const sidebar = document.getElementById("pdf-sidebar");
  document.getElementById("pdf-sidebar-toggle")?.addEventListener("click", () => {
    if (!sidebar) return;
    sidebar.hidden = !sidebar.hidden;
    if (!sidebar.hidden) rebuildSidebar();
    // משה 2026-05-07: שינוי מצב ה-sidebar משנה את הרוחב הזמין לעמודים.
    // נריץ מחדש את חישוב ה-zoom האוטומטי מיד.
    requestAnimationFrame(reapplyAutoZoom);
  });

  pagesContainer.addEventListener("scroll", scheduleScrollUpdate, { passive: true });

  // משה 2026-05-07: zoom אוטומטי שמתחשב ברוחב המכל בפועל.
  // מצב התחלתי: "אוטומטי" — העמוד תמיד מוצג במלואו ללא חיתוך, גם כש-
  // sidebar פתוח, גם כשהמשתמש גורר את ה-resize-handle, גם בצפייה במסך צר.
  // אם המשתמש בוחר ערך מספרי (50%/100%/...) — מכבדים את בחירתו.
  function reapplyAutoZoom() {
    if (!zoomSelect) return;
    const v = zoomSelect.value;
    if (v === "auto" || v === "fit") setZoomFromSelect(v);
  }
  // הפעלה ראשונה — אחרי שמסגרת ה-DOM יציבה.
  requestAnimationFrame(() => requestAnimationFrame(reapplyAutoZoom));
  // עדכון בכל שינוי גודל של pagesContainer (פתיחת sidebar, גרירת
  // resize-handle, שינוי גודל חלון).
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => reapplyAutoZoom());
    ro.observe(pagesContainer);
  }
  // עדכון אחרי כל רינדור של המנוע — במקרה שהיה רינדור מאסיבי שגרר עמודים חדשים.
  window.addEventListener("ravtext:engine-rendered", () => {
    requestAnimationFrame(reapplyAutoZoom);
  });

  return {
    setTotal(total) {
      toolbar.total = total;
      if (toolbar.pageTotal) toolbar.pageTotal.textContent = `/ ${total}`;
      activeThumbIndex = -1;
      if (toolbar.pageInput) {
        toolbar.pageInput.max = String(Math.max(1, total));
        if (total === 0) toolbar.pageInput.value = "1";
        else if (parseInt(toolbar.pageInput.value, 10) > total) toolbar.pageInput.value = "1";
      }
      if (sidebar && sidebar.hidden) {
        if (thumbObserver) {
          thumbObserver.disconnect();
          thumbObserver = null;
        }
        sidebar.innerHTML = "";
      } else if (sidebar) {
        rebuildSidebar();
      }
    },
    rememberBaseSize,
    applyZoom,
    goToPage,
  };
}
