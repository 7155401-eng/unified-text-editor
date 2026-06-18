const B = "nested-notes-open-stream-menu-btn";
const H = "nested-notes-short-help-btn";
const W = "nested-notes-stream-menu-buttons";
const P = "nested-notes-stream-menu-popover";
const I = "talmud-streams-input";
const MAX = 2;
let installed = 0;
const groups = [
["חלוניות", [
["+ חלונית", "pane-add"],
["✕ הסר חלונית", "pane-remove"],
["מחק את כל חלונות הזרמים", "delete-stream-panes"],
["נקה את כל תוכן החלונות", "clear-all-pane-content"],
["✂ פצל לחלוניות", "split-to-panes"],
["✂ הפרד הערות", "split-special-notes"],
["🔗 מזג / פרק", "merge-toggle"],
["⤺ אחד", "merge-from-panes"],
]],
["תצוגה וכלים", [
["תצוגה", "tab:view"],
["⚙ כלים", "tools-toggle"],
["🔗 גלילה", "sync-toggle"],
["▥ זרמים לרוחב", "pane-layout-toggle"],
["☷ שורות", "lines-toggle"],
["↺ איפוס", "pane-clear-storage"],
]],
];
const HELP_TEXT = [
"איך מקשרים הערות לפנים — בקצרה:",
"",
"1. במקום שבו צריך הערה כותבים בטקסט הראשי סימן זרם, למשל @01.",
"2. בחלון של זרם 01 כותבים את ההערות לפי הסדר.",
"3. ה-@01 הראשון בטקסט הראשי מתחבר להערה הראשונה בזרם 01.",
"4. ה-@01 השני מתחבר להערה השנייה, וכן הלאה.",
"5. אם יש הערה בתוך הערה, כותבים בתוכה סימן אחר, למשל @02; גם הוא מתחבר לפי הסדר שבו הסימנים מופיעים במסמך.",
"6. אחרי שינוי לוחצים רנדר כדי לראות את התוצאה בעמודים.",
].join("\n");
const $ = id => document.getElementById(id);
const qa = s => Array.from(document.querySelectorAll(s));
function txt(e) {
return [e?.textContent, e?.value, e?.title, e?.getAttribute?.("aria-label"), e?.id]
.filter(Boolean)
.join(" ")
.replace(/\s+/g, " ")
.trim();
}
function vis(e) {
try {
if (!(e instanceof HTMLElement) || !e.isConnected) return 0;
const s = getComputedStyle(e);
const r = e.getBoundingClientRect();
return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0 && r.width > 0 && r.height > 0;
} catch (_) {
return 1;
}
}
function mine(e) {
return !!($(W)?.contains(e) || $(B)?.contains(e) || $(H)?.contains(e) || $(P)?.contains(e));
}
function controls() {
return qa("button,[role='button'],input[type='button'],input[type='submit'],input[type='checkbox'],input[type='radio'],select,label,summary,a[href]")
.filter(e => vis(e) && !mine(e));
}
function anchor() {
return controls().find(e => {
const t = txt(e);
return t.includes("הערות להערות") || /הצג.*הערות.*להערות/.test(t) || /תמיכה.*הערות.*להערות/.test(t);
}) || $("talmud-stream-picker") || $("talmud-add-stream-btn") || $(I) || document.querySelector(".source-stream-toolbar") || document.querySelector(".panes-toolbar");
}
function msg(s) {
const m = $("stream-menu-status");
if (m) m.textContent = s || "";
}
function paneManager() {
return typeof window !== "undefined" ? window.paneManager : null;
}
function requestRender() {
try { window.__ravtextApplyPaneWidths?.(); } catch (_) {}
try { window.__ravtextRerender?.(); } catch (_) {}
}
function showShortHelp() {
const old = $("nested-notes-short-help-dialog");
if (old) old.remove();
const dlg = document.createElement("dialog");
dlg.id = "nested-notes-short-help-dialog";
dlg.dir = "rtl";
dlg.style.cssText = [
"max-width:min(560px,calc(100vw - 28px))",
"border:1px solid rgba(0,0,0,.18)",
"border-radius:14px",
"padding:0",
"box-shadow:0 16px 44px rgba(0,0,0,.25)",
"background:var(--rt-surface,#fff)",
"color:var(--rt-text,#222)",
"font:inherit",
].join(";");
const head = document.createElement("div");
head.textContent = "הסבר קצר";
head.style.cssText = "font-weight:700;font-size:15px;padding:14px 16px;border-bottom:1px solid rgba(0,0,0,.10)";
const body = document.createElement("div");
body.textContent = HELP_TEXT;
body.style.cssText = "white-space:pre-line;line-height:1.65;font-size:14px;padding:14px 16px";
const foot = document.createElement("div");
foot.style.cssText = "display:flex;justify-content:flex-start;padding:10px 16px;border-top:1px solid rgba(0,0,0,.10)";
const close = document.createElement("button");
close.type = "button";
close.textContent = "הבנתי";
close.style.cssText = "border:1px solid rgba(0,0,0,.16);border-radius:10px;background:rgba(0,0,0,.045);color:inherit;font:inherit;font-weight:700;cursor:pointer;padding:8px 16px";
close.addEventListener("click", () => { try { dlg.close(); } catch (_) {} dlg.remove(); });
foot.appendChild(close);
dlg.append(head, body, foot);
document.body.appendChild(dlg);
if (typeof dlg.showModal === "function") dlg.showModal();
else alert(HELP_TEXT);
}
function deleteStreamPanes() {
const mgr = paneManager();
const panes = Array.isArray(mgr?.panes) ? mgr.panes : [];
const streamPanes = panes.filter(p => p?.streamCode);
if (!mgr || !panes.length) {
alert("לא נמצאו חלונות זרמים.");
return 0;
}
if (!streamPanes.length) {
alert("אין כרגע חלונות זרמים למחיקה.");
return 0;
}
if (!confirm("אתה בטוח? פעולה זו תמחק את כל חלונות הזרמים ותשאיר רק את הזרם הראשי.")) {
return 0;
}
const state = typeof mgr.serialize === "function" ? mgr.serialize() : { version: 1, panes: [] };
const mainPanes = (state.panes || []).filter(p => !p.streamCode);
if (!mainPanes.length) {
alert("לא נמצאה חלונית ראשית, לכן לא בוצעה מחיקה.");
return 0;
}
try {
mgr.merged = false;
mgr.load({
version: state.version || 1,
activeId: mainPanes[0].id || null,
panes: mainPanes,
});
requestRender();
msg(`נמחקו ${streamPanes.length} חלונות זרמים. הזרם הראשי נשאר.`);
return 1;
} catch (err) {
console.warn("[stream-menu] delete stream panes failed:", err);
alert("לא הצלחתי למחוק את חלונות הזרמים.");
return 0;
}
}
function clearAllPaneContent() {
const mgr = paneManager();
const panes = Array.isArray(mgr?.panes) ? mgr.panes : [];
if (!mgr || !panes.length) {
alert("לא נמצאו חלונות לניקוי.");
return 0;
}
if (!confirm("אתה בטוח? פעולה זו תנקה את כל תוכן החלונות. החלונות עצמם יישארו.")) {
return 0;
}
let cleared = 0;
for (const pane of panes) {
if (!pane?.editor) continue;
try {
if (typeof pane.editor.commands?.clearContent === "function") {
pane.editor.commands.clearContent(true);
} else {
pane.editor.commands?.setContent?.({ type: "doc", content: [{ type: "paragraph" }] });
}
pane.scheduleMarkerBarUpdate?.({ immediate: true });
cleared++;
} catch (err) {
console.warn("[stream-menu] clear pane content failed:", err);
}
}
try { mgr._save?.({ immediate: true }); } catch (_) {}
try { mgr._emit?.("change"); } catch (_) {}
requestRender();
msg(`נוקה תוכן ${cleared} חלונות. החלונות נשארו.`);
return 1;
}
function runDirectCmd(cmd) {
if (cmd === "delete-stream-panes") return deleteStreamPanes();
if (cmd === "clear-all-pane-content") return clearAllPaneContent();
if (cmd === "short-help") { showShortHelp(); return 1; }
return null;
}
function runCmd(cmd, label) {
const direct = runDirectCmd(cmd);
if (direct !== null) return direct;
if (cmd.startsWith("tab:")) {
const tab = cmd.slice(4);
const b = document.querySelector(`.ribbon-tab[data-ribbon-tab="${tab}"]`);
if (b) {
b.click();
msg(`נפתח: ${label}`);
return 1;
}
msg(`כרטיסיית ${label} עדיין לא זמינה`);
return 0;
}
const b = document.createElement("button");
b.type = "button";
b.dataset.cmd = cmd;
b.textContent = label;
b.style.cssText = "position:fixed;right:-9999px;bottom:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
document.body.appendChild(b);
try {
b.click();
msg(`נשלח: ${label}`);
return 1;
} finally { setTimeout(() => b.remove(), 0); }
}
function codes() {
const s = new Set();
qa(".stream[data-stream],[data-stream]").forEach(e => {
const c = e.getAttribute("data-stream");
if (/^\d{2}$/.test(c || "")) s.add(c);
});
if (!s.size) for (let i = 1; i <= 10; i++) s.add(String(i).padStart(2, "0"));
return [...s].sort();
}
function selected() {
const i = $(I);
return i ? (i.value.match(/\d{2}/g) || []) : [];
}
function setSel(a) {
const i = $(I);
if (!i) return;
i.value = a.slice(0, MAX).sort().join(",");
i.dispatchEvent(new Event("change", { bubbles: true }));
i.dispatchEvent(new Event("input", { bubbles: true }));
msg(i.value ? `נבחרו זרמים: ${i.value}` : "לא נבחרו זרמים");
}
function open() {
const p = $(P);
return !!(p && p.style.display !== "none");
}
function wrapper() {
let w = $(W);
if (!w) {
w = document.createElement("span");
w.id = W;
w.dir = "rtl";
w.style.cssText = "display:inline-flex;align-items:center;gap:6px";
document.body.appendChild(w);
}
return w;
}
function smallButton(id, text, title, cmd) {
let b = $(id);
if (!b) {
b = document.createElement("button");
b.id = id;
b.type = "button";
b.addEventListener("click", e => {
e.preventDefault();
e.stopPropagation();
if (cmd === "toggle-menu") toggle();
else runCmd(cmd, text);
});
}
b.textContent = text;
b.title = title || text;
b.style.cssText = [
"display:inline-flex",
"align-items:center",
"justify-content:center",
"gap:5px",
"min-height:28px",
"padding:4px 10px",
"border-radius:999px",
"border:1px solid rgba(44,90,160,.38)",
"background:linear-gradient(180deg,rgba(44,90,160,.13),rgba(44,90,160,.06))",
"color:inherit",
"font:inherit",
"font-size:12px",
"font-weight:600",
"line-height:1.35",
"cursor:pointer",
"white-space:nowrap",
"box-shadow:0 1px 3px rgba(0,0,0,.12)",
"pointer-events:auto",
].join(";");
return b;
}
function placeBtn() {
const w = $(W);
if (!w) return;
const a = anchor();
if (a && vis(a) && a.parentElement && !mine(a)) {
if (w.parentElement !== a.parentElement || w.previousElementSibling !== a) {
a.insertAdjacentElement("afterend", w);
}
w.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin-inline-start:6px;vertical-align:middle;position:static;z-index:auto;pointer-events:auto";
return;
}
if (w.parentElement !== document.body) document.body.appendChild(w);
w.style.cssText = "position:fixed;z-index:10020;display:inline-flex;align-items:center;gap:6px;pointer-events:auto";
let top = 88;
let right = 12;
const pad = 10;
if (a && vis(a)) {
const r = a.getBoundingClientRect();
top = r.top + Math.max(0, (r.height - (w.offsetHeight || 28)) / 2);
right = Math.max(pad, innerWidth - r.left + 6);
}
top = Math.max(pad, Math.min(innerHeight - (w.offsetHeight || 28) - pad, top));
right = Math.max(pad, Math.min(innerWidth - (w.offsetWidth || 250) - pad, right));
w.style.top = Math.round(top) + "px";
w.style.right = Math.round(right) + "px";
w.style.left = "auto";
}
function button() {
const w = wrapper();
const menu = smallButton(B, "פתח תפריט זרמים", "פתח תפריט זרמים", "toggle-menu");
menu.setAttribute("aria-haspopup", "dialog");
menu.setAttribute("aria-expanded", open() ? "true" : "false");
const help = smallButton(H, "הסבר קצר", "הסבר קצר על קישור הערות לפנים", "short-help");
if (!w.contains(menu)) w.appendChild(menu);
if (!w.contains(help)) w.appendChild(help);
placeBtn();
}
function pop() {
let p = $(P);
if (!p) {
p = document.createElement("div");
p.id = P;
p.dir = "rtl";
p.setAttribute("role", "dialog");
p.setAttribute("aria-label", "תפריט זרמים");
document.body.appendChild(p);
}
p.style.cssText = "position:fixed;z-index:10030;display:none;flex-direction:column;width:min(760px,calc(100vw - 16px));max-height:min(82vh,680px);overflow:hidden;border:1px solid rgba(0,0,0,.16);border-radius:14px;background:var(--rt-surface,#fff);color:var(--rt-text,#222);box-shadow:0 12px 32px rgba(0,0,0,.22);font-size:12px;pointer-events:auto;box-sizing:border-box";
return p;
}
function closeBtn(t) {
const b = document.createElement("button");
b.type = "button";
b.textContent = t;
b.style.cssText = "border:1px solid rgba(0,0,0,.14);border-radius:10px;background:rgba(0,0,0,.045);color:inherit;font:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:7px 12px;min-height:32px";
b.onclick = e => {
e.preventDefault();
e.stopPropagation();
close();
};
return b;
}
function title(t) {
const d = document.createElement("div");
d.textContent = t;
d.style.cssText = "font-weight:700;font-size:12px;opacity:.78;margin:10px 0 6px";
return d;
}
function grid() {
const g = document.createElement("div");
g.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px";
return g;
}
function act(a) {
const b = document.createElement("button");
b.type = "button";
b.textContent = a[0];
const danger = a[1] === "delete-stream-panes" || a[1] === "clear-all-pane-content";
b.style.cssText = [
"display:inline-flex",
"align-items:center",
"justify-content:center",
"min-height:31px",
"padding:6px 8px",
"border-radius:9px",
`border:1px solid ${danger ? "rgba(170,40,40,.28)" : "rgba(0,0,0,.12)"}`,
`background:${danger ? "rgba(170,40,40,.055)" : "rgba(0,0,0,.035)"}`,
"color:inherit",
"font:inherit",
"font-size:12px",
"cursor:pointer",
"white-space:nowrap",
].join(";");
b.onclick = e => {
e.preventDefault();
e.stopPropagation();
runCmd(a[1], a[0]);
setTimeout(render, 120);
};
return b;
}
function render() {
const p = pop();
p.innerHTML = "";
const head = document.createElement("div");
head.style.cssText = "flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.10);background:var(--rt-surface,#fff)";
head.innerHTML = "<strong style='font-size:13px'>🌊 תפריט זרמים</strong><span style='flex:1'></span>";
head.appendChild(closeBtn("× סגור"));
const body = document.createElement("div");
body.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:10px 12px 12px;scrollbar-gutter:stable";
body.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
body.addEventListener("touchmove", e => e.stopPropagation(), { passive: true });
groups.forEach(g => {
body.appendChild(title(g[0]));
const gr = grid();
g[1].forEach(a => gr.appendChild(act(a)));
body.appendChild(gr);
});
body.appendChild(title("זרמים"));
const input = $(I);
const hint = document.createElement("div");
hint.textContent = input ? `בחר עד ${MAX} זרמים להצגה בחלוניות.` : "בקר הזרמים עדיין לא נטען במסך הזה.";
hint.style.cssText = "opacity:.72;margin:0 0 8px;font-size:11px";
body.appendChild(hint);
if (input) {
const cur = selected();
const w = document.createElement("div");
w.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px";
codes().forEach(c => {
const 