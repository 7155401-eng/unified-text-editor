// משה 2026-05-09: 3 אייקונים בכותרת ליד הפרופיל:
//   ✦ כוכב — פרמיום (פותח מסך תשלום)
//   🎁 מתנה — מימוש 20 דק' חינם בחודש
//   🔧 מפתח שוודי — הגדרות (מעביר את "הגדרות" מתוך התפריט הישן)
// סדר ב-RTL: appendChild שם אותם משמאל לפרופיל, כך שהאייקונים יושבים
// בקצה החיצוני של הכותרת והאווטאר נשאר ליד הקצה ביותר.

import { openPremiumPage } from "./premium_page.js";
import { claimMonthlyGift } from "./payment_api.js";
import { showToast } from "./time_warning.js";

const GIFT_LOCAL_KEY = "ravtext.gift.lastClaim";  // YYYY-MM "2026-05"

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isGiftAlreadyClaimed() {
  try {
    return localStorage.getItem(GIFT_LOCAL_KEY) === thisMonth();
  } catch {
    return false;
  }
}

function markGiftClaimedLocally() {
  try { localStorage.setItem(GIFT_LOCAL_KEY, thisMonth()); } catch {}
}

// משה 2026-05-09: פופ-אובר הגדרות. לשונית הריבון "הגדרות" הוסרה (main.js),
// וכל ההגדרות נפתחות מהאייקון מפתח-שוודי כמודאל מרכזי. המקור של תוכן ההגדרות
// (#settings-panel + #settings-panel-wrap) נשאר במקום ב-DOM כדי לשמור על כל
// ה-listeners והקישורים. אנחנו רק מציגים את ההורה שלהם כמודאל בעל position:fixed.

const SETTINGS_OVERLAY_ID = "rt-prem-settings-overlay";
const SETTINGS_HOST_ID = "rt-prem-settings-host";

function openSettings() {
  if (document.getElementById(SETTINGS_OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = SETTINGS_OVERLAY_ID;
  overlay.className = "rt-prem-settings-overlay";
  overlay.dir = "rtl";

  const sheet = document.createElement("div");
  sheet.className = "rt-prem-settings-sheet";

  const header = document.createElement("div");
  header.className = "rt-prem-settings-header";
  header.innerHTML = `
    <div class="rt-prem-settings-title">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
      <span>הגדרות מערכת</span>
    </div>
    <button type="button" class="rt-prem-settings-close" aria-label="סגור">✕</button>
  `;
  sheet.appendChild(header);

  const host = document.createElement("div");
  host.id = SETTINGS_HOST_ID;
  host.className = "rt-prem-settings-host";
  sheet.appendChild(host);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.documentElement.classList.add("rt-prem-locked");

  // העברת תוכן ההגדרות (settings-panel + settings-panel-wrap) לתוך ה-host.
  // שומרים מצביע למקום המקורי כדי להחזיר בעת סגירה.
  const wrap = document.getElementById("settings-panel-wrap");
  const panel = document.getElementById("settings-panel");
  const wrapAnchor = wrap ? document.createComment("settings-panel-wrap-anchor") : null;
  const panelAnchor = panel ? document.createComment("settings-panel-anchor") : null;
  if (wrap && wrap.parentNode) {
    wrap.parentNode.insertBefore(wrapAnchor, wrap);
    host.appendChild(wrap);
    wrap.hidden = false;
  }
  if (panel && panel.parentNode) {
    panel.parentNode.insertBefore(panelAnchor, panel);
    host.appendChild(panel);
    panel.hidden = false;
    panel.classList.add("rt-prem-settings-shown");
  }

  // הודעה למודולים שמסך ההגדרות נפתח כדי שיוכלו לרענן
  document.dispatchEvent(new CustomEvent("ravtext:settings-opened"));

  function close() {
    // החזרת התוכן למקום המקורי כדי לא לשבור את העץ
    if (panel && panelAnchor && panelAnchor.parentNode) {
      panelAnchor.parentNode.insertBefore(panel, panelAnchor);
      panelAnchor.remove();
      panel.classList.remove("rt-prem-settings-shown");
    }
    if (wrap && wrapAnchor && wrapAnchor.parentNode) {
      wrapAnchor.parentNode.insertBefore(wrap, wrapAnchor);
      wrapAnchor.remove();
    }
    overlay.remove();
    document.documentElement.classList.remove("rt-prem-locked");
    document.removeEventListener("keydown", escHandler);
  }

  function escHandler(e) {
    if (e.key === "Escape") close();
  }
  header.querySelector(".rt-prem-settings-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);
}

// משה 2026-05-10: פופ-אובר הורדות. לשונית הריבון "הורדות" הוסרה (main.js),
// וכל ההורדה נפתחת מהאייקון 📥 כמודאל מרכזי. אותו דפוס בדיוק כמו openSettings:
// מעבירים את #downloads-panel ל-host בעת פתיחה, מחזירים בעת סגירה — כך כל
// ה-listeners שכבר חוברו ב-wireDownloadsPanel() נשארים פעילים.

const DOWNLOADS_OVERLAY_ID = "rt-prem-downloads-overlay";
const DOWNLOADS_HOST_ID = "rt-prem-downloads-host";

function openDownloads() {
  if (document.getElementById(DOWNLOADS_OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = DOWNLOADS_OVERLAY_ID;
  overlay.className = "rt-prem-settings-overlay";
  overlay.dir = "rtl";

  const sheet = document.createElement("div");
  sheet.className = "rt-prem-settings-sheet";

  const header = document.createElement("div");
  header.className = "rt-prem-settings-header";
  header.innerHTML = `
    <div class="rt-prem-settings-title">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>הורדה ושמירה למחשב</span>
    </div>
    <button type="button" class="rt-prem-settings-close" aria-label="סגור">✕</button>
  `;
  sheet.appendChild(header);

  const host = document.createElement("div");
  host.id = DOWNLOADS_HOST_ID;
  host.className = "rt-prem-settings-host";
  sheet.appendChild(host);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.documentElement.classList.add("rt-prem-locked");

  const panel = document.getElementById("downloads-panel");
  const panelAnchor = panel ? document.createComment("downloads-panel-anchor") : null;
  if (panel && panel.parentNode) {
    panel.parentNode.insertBefore(panelAnchor, panel);
    host.appendChild(panel);
    panel.hidden = false;
    panel.classList.add("rt-prem-settings-shown");
  }

  function close() {
    if (panel && panelAnchor && panelAnchor.parentNode) {
      panelAnchor.parentNode.insertBefore(panel, panelAnchor);
      panelAnchor.remove();
      panel.classList.remove("rt-prem-settings-shown");
    }
    overlay.remove();
    document.documentElement.classList.remove("rt-prem-locked");
    document.removeEventListener("keydown", escHandler);
  }

  function escHandler(e) {
    if (e.key === "Escape") close();
  }
  header.querySelector(".rt-prem-settings-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);
}

const VIDEOS_OVERLAY_ID = "rt-video-gallery-overlay";
const VIDEOS_STYLE_ID = "rt-video-gallery-inline-style";

function ensureVideoGalleryStyles() {
  let style = document.getElementById(VIDEOS_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = VIDEOS_STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = `
    #rt-video-gallery-overlay *,
    #rt-video-gallery-overlay *::before,
    #rt-video-gallery-overlay *::after {
      box-sizing: border-box;
    }

    #rt-video-gallery-overlay .rt-video-gallery-sheet {
      width: min(1120px, calc(100vw - 34px)) !important;
      height: min(760px, calc(100vh - 34px)) !important;
      max-height: calc(100vh - 34px) !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-header {
      flex: 0 0 auto !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-body {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 14px !important;
      padding: 16px !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-topline {
      flex: 0 0 auto !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 16px !important;
      flex-wrap: wrap !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-layout {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: row !important;
      gap: 16px !important;
      align-items: stretch !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-list {
      flex: 0 0 330px !important;
      width: 330px !important;
      max-width: 38% !important;
      min-height: 0 !important;
      max-height: 100% !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      border: 1px solid rgba(148, 163, 184, .32) !important;
      border-radius: 16px !important;
      background: rgba(248, 250, 252, .78) !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-list-title {
      flex: 0 0 auto !important;
      padding: 12px 14px !important;
      font-weight: 700 !important;
      border-bottom: 1px solid rgba(148, 163, 184, .24) !important;
      background: rgba(255, 255, 255, .72) !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-list-items {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      max-height: 100% !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain !important;
      padding: 8px !important;
      display: grid !important;
      gap: 8px !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-video-btn {
      display: grid !important;
      grid-template-columns: 92px 1fr !important;
      gap: 10px !important;
      width: 100% !important;
      text-align: right !important;
      border: 1px solid transparent !important;
      border-radius: 13px !important;
      padding: 7px !important;
      background: transparent !important;
      cursor: pointer !important;
      color: inherit !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-video-btn:hover,
    #rt-video-gallery-overlay .rt-video-gallery-video-btn.rt-video-gallery-selected {
      border-color: rgba(59, 130, 246, .42) !important;
      background: rgba(59, 130, 246, .08) !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-thumb {
      width: 92px !important;
      height: 52px !important;
      border-radius: 9px !important;
      object-fit: cover !important;
      background: #e5e7eb !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-video-title {
      align-self: center !important;
      font-size: 13px !important;
      line-height: 1.35 !important;
      font-weight: 650 !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-preview {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-current-title {
      flex: 0 0 auto !important;
      font-weight: 700 !important;
      min-height: 22px !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-frame-wrap {
      position: relative !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      height: auto !important;
      overflow: hidden !important;
      border-radius: 18px !important;
      background: #0f172a !important;
      border: 1px solid rgba(15, 23, 42, .16) !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-frame {
      width: 100% !important;
      height: 100% !important;
      min-height: 0 !important;
      border: 0 !important;
      display: block !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-empty {
      display: grid !important;
      place-items: center !important;
      height: 100% !important;
      min-height: 0 !important;
      padding: 24px !important;
      text-align: center !important;
      color: #475569 !important;
      background: #f8fafc !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-frame[hidden],
    #rt-video-gallery-overlay .rt-video-gallery-empty[hidden],
    #rt-video-gallery-overlay .rt-video-gallery-frame:not([hidden]) + .rt-video-gallery-empty {
      display: none !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-footer {
      flex: 0 0 auto !important;
      display: flex !important;
      justify-content: flex-start !important;
      gap: 10px !important;
    }

    #rt-video-gallery-overlay .rt-video-gallery-link-disabled {
      pointer-events: none !important;
      opacity: .45 !important;
    }

    @media (max-width: 820px) {
      #rt-video-gallery-overlay .rt-video-gallery-layout {
        flex-direction: column !important;
      }

      #rt-video-gallery-overlay .rt-video-gallery-list {
        flex: 0 0 auto !important;
        width: 100% !important;
        max-width: none !important;
        max-height: 240px !important;
      }

      #rt-video-gallery-overlay .rt-video-gallery-frame-wrap,
      #rt-video-gallery-overlay .rt-video-gallery-frame,
      #rt-video-gallery-overlay .rt-video-gallery-empty {
        min-height: 280px !important;
      }
    }
  `;
}

function parsePlaylistId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.searchParams.get("list") || raw;
  } catch {
    const match = raw.match(/[?&]list=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : raw.replace(/^list=/, "").trim();
  }
}

function isVideoGalleryAdmin() {
  const auth = window.__RAVTEXT_AUTH__ || {};
  return !!auth.admin;
}

async function fetchServerVideoPlaylist() {
  const res = await fetch("/api/video-gallery/playlist", {
    method: "GET",
    credentials: "same-origin",
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`video playlist load failed: ${res.status}`);
  }

  return res.json();
}

async function saveServerVideoPlaylist({ name, playlistId }) {
  const res = await fetch("/api/admin/video-gallery/playlist", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, playlistId }),
  });

  let data = {};
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    throw new Error(data?.error || `video playlist save failed: ${res.status}`);
  }

  return data;
}

async function openVideoGallery() {
  if (document.getElementById(VIDEOS_OVERLAY_ID)) return;

  ensureVideoGalleryStyles();

  const isAdmin = isVideoGalleryAdmin();

  const overlay = document.createElement("div");
  overlay.id = VIDEOS_OVERLAY_ID;
  overlay.className = "rt-prem-settings-overlay rt-video-gallery-overlay";
  overlay.dir = "rtl";

  const sheet = document.createElement("div");
  sheet.className = "rt-prem-settings-sheet rt-video-gallery-sheet";

  const header = document.createElement("div");
  header.className = "rt-prem-settings-header rt-video-gallery-header";
  header.innerHTML = `
    <div class="rt-prem-settings-title rt-video-gallery-title">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="rt-video-title-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ff2d55"/>
            <stop offset="55%" stop-color="#ff7a18"/>
            <stop offset="100%" stop-color="#ffd166"/>
          </linearGradient>
        </defs>
        <rect x="2.5" y="5" width="19" height="14" rx="4" fill="url(#rt-video-title-grad)"/>
        <path d="M10 9.2v5.6l5-2.8-5-2.8z" fill="#fff"/>
      </svg>
      <span>סרטוני עזרה והדרכה</span>
    </div>
    <button type="button" class="rt-prem-settings-close" aria-label="סגור">x</button>
  `;
  sheet.appendChild(header);

  const adminControls = isAdmin ? `
    <div class="rt-video-gallery-admin">
      <label>
        <span>הגדרת מנהל: קישור או מזהה פלייליסט YouTube</span>
        <input class="rt-video-gallery-admin-input" type="text" dir="ltr" placeholder="https://www.youtube.com/playlist?list=..." />
      </label>
      <button type="button" class="rt-video-gallery-admin-save">שמור פלייליסט</button>
    </div>
  ` : "";

  const body = document.createElement("div");
  body.className = "rt-video-gallery-body";
  body.innerHTML = `
    <div class="rt-video-gallery-topline">
      <div class="rt-video-gallery-heading">
        <strong>סרטוני עזרה והדרכה</strong>
        <small>בחר סרטון מהרשימה וצפה בו בתצוגה המקדימה.</small>
      </div>
      ${adminControls}
    </div>

    <div class="rt-video-gallery-layout">
      <aside class="rt-video-gallery-list" aria-label="רשימת סרטוני הדרכה">
        <div class="rt-video-gallery-list-title">רשימת סרטונים</div>
        <div class="rt-video-gallery-list-items"></div>
      </aside>

      <section class="rt-video-gallery-preview">
        <div class="rt-video-gallery-current-title"></div>
        <div class="rt-video-gallery-frame-wrap">
          <iframe class="rt-video-gallery-frame" title="סרטון הדרכה" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
          <div class="rt-video-gallery-empty">טוען סרטונים...</div>
        </div>
        <div class="rt-video-gallery-footer">
          <a class="rt-video-gallery-youtube" href="#" target="_blank" rel="noopener">פתח ביוטיוב</a>
        </div>
      </section>
    </div>
  `;

  sheet.appendChild(body);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.documentElement.classList.add("rt-prem-locked");

  const iframe = body.querySelector(".rt-video-gallery-frame");
  const empty = body.querySelector(".rt-video-gallery-empty");
  const youtubeLink = body.querySelector(".rt-video-gallery-youtube");
  const currentTitle = body.querySelector(".rt-video-gallery-current-title");
  const listItems = body.querySelector(".rt-video-gallery-list-items");
  const adminInput = body.querySelector(".rt-video-gallery-admin-input");
  const adminSave = body.querySelector(".rt-video-gallery-admin-save");

  let currentPlaylistId = "";
  let videoLoadTimer = 0;

  function armVideoLoadFallback() {
    window.clearTimeout(videoLoadTimer);
    videoLoadTimer = window.setTimeout(() => {
      if (!iframe.hidden && iframe.getAttribute("src")) {
        // אי אפשר לזהות בוודאות חסימת iframe חיצוני בגלל cross-origin,
        // לכן לא מסתירים את הנגן אלא רק משאירים קישור פתיחה ביוטיוב.
        youtubeLink.textContent = "אם הסרטון לא נטען כאן, פתח ביוטיוב";
      }
    }, 4500);
  }

  function setEmpty(message) {
    iframe.removeAttribute("src");
    iframe.hidden = true;
    empty.hidden = false;
    empty.textContent = message;
    youtubeLink.classList.add("rt-video-gallery-link-disabled");
    youtubeLink.href = "#";
  }

  function showVideo(video, allVideos = []) {
    if (!video?.videoId) {
      if (currentPlaylistId) {
        iframe.hidden = false;
        empty.hidden = true;
        iframe.src = `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(currentPlaylistId)}`;
        youtubeLink.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(currentPlaylistId)}`;
        youtubeLink.classList.remove("rt-video-gallery-link-disabled");
        currentTitle.textContent = "סרטוני עזרה והדרכה";
      }
      return;
    }

    iframe.hidden = false;
    empty.hidden = true;
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}?rel=0&list=${encodeURIComponent(currentPlaylistId)}`;
    youtubeLink.href = video.url || `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
    youtubeLink.classList.remove("rt-video-gallery-link-disabled");
    currentTitle.textContent = video.title || "סרטון הדרכה";

    for (const btn of listItems.querySelectorAll(".rt-video-gallery-video-btn")) {
      btn.classList.toggle("rt-video-gallery-selected", btn.dataset.videoId === video.videoId);
    }
  }

  function renderVideoList(items) {
    listItems.innerHTML = "";

    if (!items.length) {
      const msg = document.createElement("div");
      msg.className = "rt-video-gallery-empty-list";
      msg.textContent = currentPlaylistId
        ? "לא נמצאו סרטונים להצגה ברשימה. ניתן לצפות בפלייליסט בתצוגה המקדימה."
        : "לא הוגדרו עדיין סרטונים.";
      listItems.appendChild(msg);
      return;
    }

    for (const video of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rt-video-gallery-video-btn";
      btn.dataset.videoId = video.videoId || "";

      const img = document.createElement("img");
      img.className = "rt-video-gallery-thumb";
      img.alt = "";
      img.loading = "lazy";
      img.src = video.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/mqdefault.jpg`;

      const title = document.createElement("span");
      title.className = "rt-video-gallery-video-title";
      title.textContent = video.title || "סרטון הדרכה";

      btn.appendChild(img);
      btn.appendChild(title);
      btn.addEventListener("click", () => showVideo(video, items));

      listItems.appendChild(btn);
    }
  }

  function showPlaylist(data) {
    currentPlaylistId = parsePlaylistId(data?.playlistId || data?.list || "");
    const items = Array.isArray(data?.items) ? data.items : [];

    if (adminInput) adminInput.value = currentPlaylistId;

    renderVideoList(items);

    if (!currentPlaylistId) {
      setEmpty(isAdmin
        ? "לא הוגדר עדיין פלייליסט. הדבק קישור פלייליסט ושמור אותו."
        : "עדיין לא הוגדרו סרטוני עזרה והדרכה."
      );
      currentTitle.textContent = "";
      return;
    }

    if (items.length) {
      showVideo(items[0], items);
    } else {
      iframe.hidden = false;
      empty.hidden = true;
      iframe.src = `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(currentPlaylistId)}`;
      youtubeLink.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(currentPlaylistId)}`;
      youtubeLink.classList.remove("rt-video-gallery-link-disabled");
      currentTitle.textContent = "סרטוני עזרה והדרכה";
    }
  }

  async function reloadPlaylist() {
    try {
      showPlaylist(await fetchServerVideoPlaylist());
    } catch {
      setEmpty("שגיאה בטעינת סרטוני העזרה וההדרכה.");
      currentTitle.textContent = "";
    }
  }

  async function saveAdminPlaylist() {
    if (!isAdmin || !adminInput) return;

    const playlistId = parsePlaylistId(adminInput.value);
    if (!playlistId) {
      window.alert("הדבק קישור או מזהה פלייליסט לפני שמירה.");
      return;
    }

    try {
      const saved = await saveServerVideoPlaylist({
        name: "סרטוני עזרה והדרכה",
        playlistId,
      });
      showPlaylist(saved);
      window.alert("פלייליסט סרטוני העזרה וההדרכה נשמר.");
    } catch (err) {
      window.alert(`שמירת הפלייליסט נכשלה: ${err?.message || err}`);
    }
  }

  if (adminSave) adminSave.addEventListener("click", saveAdminPlaylist);
  if (adminInput) {
    adminInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        saveAdminPlaylist();
      }
    });
  }

  function close() {
    overlay.remove();
    document.documentElement.classList.remove("rt-prem-locked");
    document.removeEventListener("keydown", escHandler);
  }

  function escHandler(e) {
    if (e.key === "Escape") close();
  }

  header.querySelector(".rt-prem-settings-close").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);

  reloadPlaylist();
}

function buildIconButton({ id, cls, title, label, html, text }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = id;
  btn.className = `rt-prem-icon-btn ${cls}`;
  btn.title = title;
  btn.setAttribute("aria-label", label);
  // משה 2026-05-10: עוטפים את האייקון ב-.rt-prem-icon-glyph ומוסיפים
  // .rt-prem-icon-text שנשלף בריחוף — אותו דפוס כמו "עדכוני פיתוח".
  // הטקסט הוא string פשוט (לא HTML) כדי שלא יהיה סיכון להזרקה.
  const glyph = `<span class="rt-prem-icon-glyph">${html}</span>`;
  const textSpan = text ? `<span class="rt-prem-icon-text"></span>` : "";
  btn.innerHTML = glyph + textSpan;
  if (text) {
    btn.querySelector(".rt-prem-icon-text").textContent = text;
  }
  return btn;
}

export function installHeaderPremiumIcons() {
  if (typeof document === "undefined") return;
  // משה 2026-05-10: guard לפי אייקון ההגדרות (תמיד מותקן לכולם), כי היהלום לא
  // מותקן למשתמשים עם מנוי תקופתי — שימוש בו כ-guard יחמיץ הגנה כפולה למנויים.
  // (משלב את התיקון שעשה משה ב-PR #160 שהשתמש ב-diamond, עם הזיהוי שלי.)
  if (document.getElementById("rt-prem-icon-settings")) return;

  const actions = document.querySelector(".app-header .app-header-actions");
  if (!actions) return;

  const auth = window.__RAVTEXT_AUTH__ || { loggedIn: false, paid: false };

  const videosIcon = buildIconButton({
    id: "rt-prem-icon-videos",
    cls: "rt-prem-icon-videos",
    title: "סרטוני הדרכה",
    label: "פתח גלריית סרטונים",
    text: "סרטונים",
    html: `
      <svg class="rt-video-icon-svg" width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="rt-video-icon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="currentColor" stop-opacity="1"/>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0.78"/>
          </linearGradient>
        </defs>
        <rect x="2.25" y="5" width="19.5" height="14" rx="4.2" fill="url(#rt-video-icon-grad)" stroke="rgba(255,255,255,0.72)" stroke-width="0.65"/>
        <path class="rt-video-icon-play" d="M10.2 8.7v6.6l5.7-3.3-5.7-3.3z" fill="rgba(255,255,255,0.96)"/>
        <path class="rt-video-icon-glint" d="M6 7.4h5.2" stroke="rgba(255,255,255,0.78)" stroke-width="1.1" stroke-linecap="round"/>
      </svg>
    `,
  });
  videosIcon.addEventListener("click", openVideoGallery);

  // משה 2026-05-09: גלגל שיניים אלגנטי עם גרדיאנט פנימי + סיבוב hover.
  // (קודם היה מפתח שוודי — חסר השראה. הגלגל מקובל יותר ומיד מזוהה כ"הגדרות".)
  const settingsIcon = buildIconButton({
    id: "rt-prem-icon-settings",
    cls: "rt-prem-icon-settings",
    title: "הגדרות",
    label: "פתח הגדרות",
    text: "הגדרות",
    html: `
      <svg class="rt-prem-settings-svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="rt-prem-gear-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="currentColor" stop-opacity="1"/>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0.78"/>
          </linearGradient>
        </defs>
        <path d="M19.4 13c.04-.33.07-.66.07-1s-.03-.67-.07-1l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.4 7.4 0 0 0-1.73-1L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.61a7.4 7.4 0 0 0-1.73 1l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.53 11c-.04.33-.07.66-.07 1s.03.67.07 1l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1a7.4 7.4 0 0 0 1.73 1l.38 2.61A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .5-.42l.38-2.61a7.4 7.4 0 0 0 1.73-1l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64L19.4 13z" fill="url(#rt-prem-gear-grad)" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3.2" fill="rgba(255,255,255,0.95)" stroke="currentColor" stroke-width="0.6"/>
        <circle cx="12" cy="12" r="1.4" fill="currentColor"/>
      </svg>
    `,
  });
  settingsIcon.addEventListener("click", openSettings);

  // משה 2026-05-10: אייקון הורדה (📥) ליד אייקון ההגדרות. מחליף את לשונית
  // "הורדות" שהוסרה מהריבון. SVG חץ-יורד-לתוך-תיבה — קריא מיידית כ"הורד למחשב".
  const downloadsIcon = buildIconButton({
    id: "rt-prem-icon-downloads",
    cls: "rt-prem-icon-downloads",
    title: "הורדות",
    label: "פתח חלון הורדות",
    text: "הורדות",
    html: `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    `,
  });
  downloadsIcon.addEventListener("click", openDownloads);

  // Gift — מתנה חודשית
  const gift = buildIconButton({
    id: "rt-prem-icon-gift",
    cls: "rt-prem-icon-gift",
    title: isGiftAlreadyClaimed()
      ? "המתנה החודשית כבר מומשה. תחזור בחודש הבא :)"
      : "מתנה חודשית: 20 דקות שימוש חינם — לחץ למימוש",
    label: "מימוש מתנה חודשית",
    text: "מתנה",
    html: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
  });
  if (isGiftAlreadyClaimed()) gift.disabled = true;
  gift.addEventListener("click", async () => {
    if (gift.disabled) return;
    if (!auth.loggedIn) {
      showToast({
        kind: "info",
        title: "מתנה חודשית",
        msg: "כדי לממש את המתנה צריך להתחבר עם גוגל.",
        actionText: "התחברות",
        action: () => { window.location.href = "/api/auth/login"; },
      });
      return;
    }
    gift.disabled = true;
    try {
      const res = await claimMonthlyGift();
      if (res && res.granted) {
        markGiftClaimedLocally();
        showToast({
          kind: "info",
          title: "🎁 המתנה התקבלה",
          msg: "20 דקות שימוש חינם נוספו לחשבונך לחודש הזה. נצל בחוכמה!",
          autoCloseMs: 6000,
        });
      } else {
        markGiftClaimedLocally();
        showToast({
          kind: "info",
          title: "כבר מומש החודש",
          msg: "המתנה החודשית כבר נוצלה. תוכל לממש שוב בתחילת החודש הבא.",
          autoCloseMs: 5000,
        });
      }
    } catch (err) {
      gift.disabled = false;
      showToast({
        kind: "danger",
        title: "תקלה זמנית",
        msg: (err && err.message) || "לא הצלחנו להפעיל את המתנה כרגע. נסה שוב בעוד דקה.",
        autoCloseMs: 5000,
      });
    }
  });

  // משה 2026-05-09: היהלום נעלם רק למשתמשים עם מנוי תקופתי פעיל (subscription).
  // משתמשי חבילת שעות / מקבלי מתנה / חינמיים — רואים את היהלום כדי שיוכלו להטעין.
  // עד אז עשיתי שכולם רואים אותו, וזה הסתיר/שינה אותו לשגוי לקבוצות שאמורות
  // עדיין להיתקל בקריאה לפעולה.
  const hideForActiveSubscription = !!(auth.paid && auth.planType === "subscription");

  if (hideForActiveSubscription) {
    // אין יהלום למנוי פעיל. מציבים רק את הטיימר/מתנה/מפתח/אווטאר.
    const avatarWrap1 = document.getElementById("profile-avatar-wrap");
    const ref1 = avatarWrap1 || null;
    if (ref1) {
      actions.insertBefore(videosIcon, ref1);
      actions.insertBefore(settingsIcon, ref1);
      actions.insertBefore(downloadsIcon, ref1);
      actions.insertBefore(gift, ref1);
    } else {
      actions.appendChild(videosIcon);
      actions.appendChild(settingsIcon);
      actions.appendChild(downloadsIcon);
      actions.appendChild(gift);
    }
    if (avatarWrap1) {
      const avatarBtn = avatarWrap1.querySelector(".profile-avatar");
      if (avatarBtn && !avatarBtn.querySelector(".rt-prem-active-ribbon")) {
        const ribbon = document.createElement("span");
        ribbon.className = "rt-prem-active-ribbon";
        ribbon.textContent = "מנוי";
        avatarBtn.appendChild(ribbon);
      }
    }
    return;
  }

  // Premium diamond — יהלום מהבהב מתחלף צבעים
  const diamond = buildIconButton({
    id: "rt-prem-icon-diamond",
    cls: "rt-prem-icon-diamond" + (auth.paid ? " rt-prem-paid" : " rt-prem-shine"),
    title: auth.paid
      ? "החשבון שלך פעיל. לחץ להטענת זמן נוסף"
      : "שדרג לפרמיום — שימוש מלא ללא הגבלה",
    label: "פרמיום",
    text: "פרמיום",
    html: `
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" class="rt-prem-diamond-svg">
        <defs>
          <linearGradient id="rt-prem-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="currentColor" stop-opacity="1"/>
            <stop offset="50%" stop-color="currentColor" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="currentColor" stop-opacity="1"/>
          </linearGradient>
        </defs>
        <path d="M6 3 H18 L22 9 L12 22 L2 9 Z" fill="url(#rt-prem-grad)" stroke="rgba(255,255,255,0.65)" stroke-width="0.6" stroke-linejoin="round"/>
        <path d="M6 3 L9 9 L2 9 Z M18 3 L15 9 L22 9 Z M9 9 L15 9 L12 22 Z M9 9 L12 3 L15 9 Z" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.4)" stroke-width="0.4" stroke-linejoin="round"/>
        <path d="M8 5 L10 8" stroke="rgba(255,255,255,0.85)" stroke-width="0.7" stroke-linecap="round" class="rt-prem-diamond-spark"/>
      </svg>
    `,
  });
  diamond.addEventListener("click", openPremiumPage);

  // סדר הוספה ל-flex-RTL: append מוסיף לשמאל. הסדר הוויזואלי משמאל לימין:
  // [wrench] [gift] [diamond] [avatar]. אנחנו רוצים [avatar] בקצה השמאלי הביותר,
  // שכבר נוסף ע"י installAuthUi לפני הקריאה הזאת. לכן נכניס את 3 האייקונים
  // *לפני* ה-avatar באמצעות insertBefore.
  const avatarWrap = document.getElementById("profile-avatar-wrap");
  const ref = avatarWrap || null;
  if (ref) {
    actions.insertBefore(videosIcon, ref);
    actions.insertBefore(settingsIcon, ref);
    actions.insertBefore(downloadsIcon, ref);
    actions.insertBefore(gift, ref);
    actions.insertBefore(diamond, ref);
  } else {
    actions.appendChild(videosIcon);
    actions.appendChild(settingsIcon);
    actions.appendChild(downloadsIcon);
    actions.appendChild(gift);
    actions.appendChild(diamond);
  }

  // אם המנוי פעיל — הצג סרט קטן על האווטאר
  if (auth.paid && avatarWrap) {
    const avatarBtn = avatarWrap.querySelector(".profile-avatar");
    if (avatarBtn && !avatarBtn.querySelector(".rt-prem-active-ribbon")) {
      const ribbon = document.createElement("span");
      ribbon.className = "rt-prem-active-ribbon";
      ribbon.textContent = "מנוי";
      avatarBtn.appendChild(ribbon);
    }
  }
}
