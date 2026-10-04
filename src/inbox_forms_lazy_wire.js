let inboxFormsPromise = null;

function loadInboxForms() {
  if (!inboxFormsPromise) {
    inboxFormsPromise = import("./inbox_forms.js").catch((err) => {
      inboxFormsPromise = null;
      throw err;
    });
  }
  return inboxFormsPromise;
}

function ensureTroubleshootingHeaderButton() {
  const actions = document.querySelector(".app-header-actions");
  if (!actions) return document.getElementById("btn-troubleshooting");

  let btn = document.getElementById("btn-troubleshooting");
  if (btn) return btn;

  btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btn-troubleshooting";
  btn.className = "header-action-btn header-action-btn-icon";
  btn.title = "פתרון בעיות ומגבלות ידועות";
  btn.setAttribute("aria-label", "פתרון בעיות ומגבלות ידועות");
  btn.innerHTML = '<span class="header-action-icon">🛠️</span><span class="header-action-text">פתרון בעיות</span>';

  const afterDevUpdates = document.getElementById("btn-dev-updates");
  if (afterDevUpdates && afterDevUpdates.parentNode === actions) {
    afterDevUpdates.after(btn);
  } else {
    actions.insertBefore(btn, actions.firstElementChild || null);
  }
  return btn;
}

function wireLazyOpen(button, exportName) {
  if (!button || button.dataset.inboxLazyWired === "1") return;
  button.dataset.inboxLazyWired = "1";
  button.addEventListener("click", async (ev) => {
    ev.preventDefault();
    try {
      const mod = await loadInboxForms();
      const open = mod && mod[exportName];
      if (typeof open === "function") open();
    } catch (err) {
      console.warn("[inbox] deferred module load failed", err);
    }
  });
}

export function wireInboxButtonsLazy() {
  wireLazyOpen(ensureTroubleshootingHeaderButton(), "openTroubleshootingModal");
  wireLazyOpen(document.getElementById("btn-report-bug"), "openBugReportModal");
  wireLazyOpen(document.getElementById("btn-contact"), "openContactModal");
  wireLazyOpen(document.getElementById("btn-dev-updates"), "openDevUpdatesModal");
}
