// תוספי UI: תפריט עכבר ימני, קיצורי Ctrl, וכיווניות RTL/LTR לשדות טקסט.
// Verbatim port of widgets_ext.py adapted for HTML inputs/textareas.

export const LABELS_HE = {
  copy: "העתק   Ctrl+C",
  cut: "גזור    Ctrl+X",
  paste: "הדבק   Ctrl+V",
  select_all: "בחר הכל  Ctrl+A",
  ltr: "כתיבה משמאל לימין",
  rtl: "כתיבה מימין לשמאל",
};

export const LABELS_EN = {
  copy: "Copy   Ctrl+C",
  cut: "Cut    Ctrl+X",
  paste: "Paste  Ctrl+V",
  select_all: "Select All  Ctrl+A",
  ltr: "Left-to-right typing",
  rtl: "Right-to-left typing",
};

function buildMenu(items) {
  const menu = document.createElement("div");
  menu.className = "haredi-caricature-context-menu";
  menu.setAttribute("role", "menu");
  menu.style.cssText =
    "position:fixed;z-index:99999;background:#1A2240;color:#E8EAF0;" +
    "border:1px solid #2A3454;border-radius:6px;padding:4px 0;" +
    "min-width:200px;font-family:'Segoe UI','David',sans-serif;font-size:12px;" +
    "box-shadow:0 6px 18px rgba(0,0,0,0.45);user-select:none;";
  for (const item of items) {
    if (item === "-") {
      const sep = document.createElement("div");
      sep.style.cssText = "height:1px;background:#2A3454;margin:4px 0;";
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement("div");
    row.textContent = item.label;
    row.style.cssText =
      "padding:6px 14px;cursor:pointer;text-align:right;direction:rtl;";
    row.addEventListener("mouseenter", () => { row.style.background = "#2A3454"; });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    row.addEventListener("click", (e) => {
      e.preventDefault();
      try { item.action(); } catch (err) {}
      hideMenu(menu);
    });
    menu.appendChild(row);
  }
  return menu;
}

function hideMenu(menu) {
  if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
}

export function attachContextMenu(widget, lang = "he") {
  const L = lang === "he" ? LABELS_HE : LABELS_EN;
  if (!widget) return null;

  let activeMenu = null;

  function selectAll() {
    try {
      if (widget.select) widget.select();
      else if (widget.focus) {
        widget.focus();
        document.execCommand("selectAll");
      }
    } catch (e) { /* ignore */ }
  }

  widget.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (activeMenu) hideMenu(activeMenu);
    const items = [
      { label: L.copy, action: () => document.execCommand("copy") },
      { label: L.cut, action: () => document.execCommand("cut") },
      { label: L.paste, action: () => document.execCommand("paste") },
      "-",
      { label: L.select_all, action: selectAll },
      "-",
      { label: L.rtl, action: () => setDirection(widget, "rtl") },
      { label: L.ltr, action: () => setDirection(widget, "ltr") },
    ];
    activeMenu = buildMenu(items);
    document.body.appendChild(activeMenu);
    activeMenu.style.left = e.clientX + "px";
    activeMenu.style.top = e.clientY + "px";

    function dismiss(ev) {
      if (activeMenu && (!ev || !activeMenu.contains(ev.target))) {
        hideMenu(activeMenu);
        activeMenu = null;
        document.removeEventListener("mousedown", dismiss, true);
        document.removeEventListener("keydown", onKey, true);
      }
    }
    function onKey(ev) {
      if (ev.key === "Escape") dismiss();
    }
    setTimeout(() => {
      document.addEventListener("mousedown", dismiss, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  });

  // Ctrl+A on input/textarea
  widget.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      selectAll();
    }
  });

  return null;
}

/** RTL/LTR לשדה. justify='right' / 'left' + dir attribute. */
export function setDirection(widget, direction) {
  if (!widget) return;
  try {
    if (direction === "rtl") {
      widget.setAttribute("dir", "rtl");
      widget.style.textAlign = "right";
    } else {
      widget.setAttribute("dir", "ltr");
      widget.style.textAlign = "left";
    }
  } catch (e) { /* ignore */ }
}
