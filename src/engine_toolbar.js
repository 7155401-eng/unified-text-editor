// engine_toolbar.js - סרגל תצוגת עמודים בסגנון PDF.js
// מבוסס על prosemirror-edition/src/main.js מהמקור האחרון.

import { downloadPagesAsPdf } from "./pdf_export.js";

export function setupPdfToolbar(pagesContainer) {
  const toolbar = {
    pageInput: document.getElementById("pdf-page-input"),
    pageTotal: document.getElementById("pdf-page-total"),
    zoomLabel: document.getElementById("pdf-zoom-label"),
    zoom: 1,
    total: 0,
  };
  let thumbObserver = null;

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
    const pages = pagesContainer.querySelectorAll(".page");
    for (const p of pages) {
      if (!p.dataset.baseW) p.dataset.baseW = String(p.offsetWidth || 380);
      if (!p.dataset.baseH) p.dataset.baseH = String(p.offsetHeight || 537);
    }
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
    const containerRect = pagesContainer.getBoundingClientRect();
    const pages = pagesContainer.querySelectorAll(".page");
    let bestIdx = 0;
    let bestDist = Infinity;
    pages.forEach((p) => {
      const rect = p.getBoundingClientRect();
      const dist = Math.abs(rect.top - containerRect.top);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = parseInt(p.dataset.pageIndex || "0", 10);
      }
    });
    if (toolbar.pageInput && document.activeElement !== toolbar.pageInput) {
      toolbar.pageInput.value = String(bestIdx + 1);
    }
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
    if (!mini || mini.dataset.thumbReady === "1") return;
    if (typeof pagesContainer.__realizePage === "function") {
      pagesContainer.__realizePage(index);
    }
    const page = getPageElement(index);
    if (!page || page.classList.contains("page-placeholder")) return;

    const clone = page.cloneNode(true);
    clone.classList.add("pdf-thumb-page");
    clone.style.zoom = "1";
    clone.style.width = "380px";
    clone.style.height = "537px";
    clone.style.flex = "none";
    clone.style.transform = "scale(1)";

    mini.innerHTML = "";
    mini.appendChild(clone);
    mini.dataset.thumbReady = "1";

    requestAnimationFrame(() => {
      const scale = (mini.clientWidth || 132) / 380;
      clone.style.transform = `scale(${scale})`;
    });
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
          thumbObserver.unobserve(mini);
          const idx = parseInt(mini.dataset.pageIndex || "0", 10);
          requestAnimationFrame(() => renderThumb(mini, idx));
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
  }

  function highlightActiveThumb() {
    const sidebar = document.getElementById("pdf-sidebar");
    if (!sidebar || sidebar.hidden) return;
    const active = parseInt(toolbar.pageInput?.value || "1", 10) - 1;
    for (const t of sidebar.querySelectorAll(".pdf-thumb")) {
      const idx = parseInt(t.dataset.pageIndex || "0", 10);
      t.classList.toggle("active", idx === active);
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
    if (typeof pagesContainer.__realizePage === "function") {
      for (let i = 0; i < toolbar.total; i++) pagesContainer.__realizePage(i);
    }
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
    realizeAllPages();
    setTimeout(() => window.print(), 50);
  });
  document.getElementById("pdf-download")?.addEventListener("click", async (ev) => {
    realizeAllPages();
    const btn = ev.currentTarget;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "מכין PDF...";
    try {
      await downloadPagesAsPdf(pagesContainer, { filename: "ravtext-preview.pdf" });
    } catch (err) {
      console.error("PDF export failed:", err);
      alert(`שגיאת הורדת PDF: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  const sidebar = document.getElementById("pdf-sidebar");
  document.getElementById("pdf-sidebar-toggle")?.addEventListener("click", () => {
    if (!sidebar) return;
    sidebar.hidden = !sidebar.hidden;
    if (!sidebar.hidden) rebuildSidebar();
  });

  pagesContainer.addEventListener("scroll", () => {
    updateCurrentPageFromScroll();
    highlightActiveThumb();
  });

  return {
    setTotal(total) {
      toolbar.total = total;
      if (toolbar.pageTotal) toolbar.pageTotal.textContent = `/ ${total}`;
      if (toolbar.pageInput) {
        toolbar.pageInput.max = String(Math.max(1, total));
        if (total === 0) toolbar.pageInput.value = "1";
        else if (parseInt(toolbar.pageInput.value, 10) > total) toolbar.pageInput.value = "1";
      }
      if (sidebar && !sidebar.hidden) rebuildSidebar();
    },
    rememberBaseSize,
    applyZoom,
    goToPage,
  };
}
