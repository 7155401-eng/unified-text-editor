// probe: מה קורה בלחיצה ימנית בעורך
import pp from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 300000, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
p.on("console", (m) => { if (m.type() === "error") errs.push("c:" + m.text().slice(0, 150)); });
await p.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));

const before = await p.evaluate(() => ({
  panes: document.querySelectorAll(".pane").length,
  editors: document.querySelectorAll(".ProseMirror").length,
  ctxMenus: document.querySelectorAll(".ctx-menu").length,
  bubbles: document.querySelectorAll("[class*=bubble], [class*=floating]").length,
}));
console.log("לפני:", JSON.stringify(before));

// לחיצה ימנית בתוך העורך הראשי
const box = await p.evaluate(() => {
  const ed = document.querySelector(".ProseMirror");
  if (!ed) return null;
  const r = ed.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) };
});
console.log("מיקום העורך:", JSON.stringify(box));
if (box) {
  await p.mouse.click(box.x, box.y, { button: "left" });
  await new Promise((r) => setTimeout(r, 300));
  await p.mouse.click(box.x, box.y, { button: "right" });
  await new Promise((r) => setTimeout(r, 800));
}

const after = await p.evaluate(() => {
  const menus = [...document.querySelectorAll(".ctx-menu")];
  return {
    ctxMenus: menus.length,
    visible: menus.map((m) => {
      const r = m.getBoundingClientRect();
      const cs = getComputedStyle(m);
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top), right: Math.round(r.right),
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        zIndex: cs.zIndex, position: cs.position,
        buttons: m.querySelectorAll("button").length,
        offscreen: r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight,
      };
    }),
    anyOther: [...document.querySelectorAll("[class*=menu]")].map((e) => e.className).slice(0, 8),
  };
});
console.log("אחרי לחיצה ימנית:", JSON.stringify(after, null, 1));
console.log("שגיאות:", errs.slice(0, 5));
await p.screenshot({ path: "C:/Users/User/ravtext_work/ctxmenu.png" });
await b.close();
