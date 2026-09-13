import pp from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 600000, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 } });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));
await p.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));

const spot = await p.evaluate(() => {
  const ed = document.querySelector(".ProseMirror");
  const r = ed.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 25) };
});
// בוחרים טווח אמיתי של מילים דרך TipTap, לא בלחיצה עיוורת
await p.evaluate(() => {
  const ed = window.paneManager.getActiveEditor() || window.paneManager.getMainPane().editor;
  ed.commands.focus();
  ed.commands.setTextSelection({ from: 5, to: 18 });
  window.__ctxErr = [];
  const origWarn = console.warn;
  console.warn = (...a) => { window.__ctxErr.push(a.map(String).join(" ")); origWarn(...a); };
});
await p.mouse.click(spot.x, spot.y, { clickCount: 2 });
await new Promise((r) => setTimeout(r, 400));
const sel = await p.evaluate(() => {
  const pm = window.paneManager;
  const ed = pm.getActiveEditor();
  const { from, to } = ed.state.selection;
  return { from, to, text: ed.state.doc.textBetween(from, to, " ", " "), marks: Object.keys(ed.schema.marks) };
});
console.log("סימון לפני:", JSON.stringify(sel));

await p.mouse.click(spot.x, spot.y, { button: "right" });
await new Promise((r) => setTimeout(r, 500));
const clicked = await p.evaluate(() => {
  const btn = [...document.querySelectorAll(".ctx-menu button")].find((x) => x.textContent.includes("מודגש"));
  if (!btn) return "אין כפתור";
  btn.click();
  return "נלחץ";
});
console.log("כפתור:", clicked);
await new Promise((r) => setTimeout(r, 1200));
const after = await p.evaluate((range) => {
  const pm = window.paneManager;
  const ed = pm.getActiveEditor();
  const names = [];
  ed.state.doc.nodesBetween(range.from, range.to, (n) => {
    if (n.isText) names.push(...n.marks.map((m) => m.type.name));
  });
  return {
    marksInRange: [...new Set(names)],
    isBoldActive: ed.isActive("bold"),
    html: ed.getHTML().slice(0, 160),
  };
}, sel);
console.log("אחרי:", JSON.stringify(after));
console.log("אזהרות:", await p.evaluate(() => window.__ctxErr || []));
await b.close();
