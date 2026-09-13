// probe: האם כשל ה-PDF (tainted canvas) קיים גם בלי נעילת דף?
// אם כן — הוא לא קשור לתכונה החדשה אלא לטעינת משאב חיצוני בדף.
import pp from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const WITH_DAF = process.env.WITH_DAF === "1";

const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 600000, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const logs = [];
p.on("console", (m) => { const t = m.text(); if (/PDF|canvas|taint|Security/i.test(t)) logs.push(`${m.type()}: ${t.slice(0, 160)}`); });
p.on("pageerror", (e) => logs.push("pageerror: " + e.message.slice(0, 160)));

await p.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate((withDaf) => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", withDaf ? "auto" : "0");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
}, WITH_DAF);
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 10000));

// אילו משאבים חיצוניים נטענו בדף (הם מה שמלכלך את ה-canvas)
const external = await p.evaluate(() => {
  const here = location.origin;
  const out = [];
  for (const img of document.images) if (img.src && !img.src.startsWith(here) && !img.src.startsWith("data:")) out.push("img:" + img.src.slice(0, 80));
  for (const l of document.querySelectorAll("link[rel=stylesheet], script[src]")) {
    const u = l.href || l.src;
    if (u && !u.startsWith(here) && !u.startsWith("data:")) out.push("res:" + u.slice(0, 80));
  }
  const fonts = [];
  try { for (const f of document.fonts) if (f.status === "loaded") fonts.push(f.family); } catch {}
  return { external: [...new Set(out)].slice(0, 10), fonts: [...new Set(fonts)].slice(0, 8) };
});

const pages = await p.evaluate(() => document.querySelectorAll(".pages-container .page").length);
console.log("מצב:", WITH_DAF ? "עם נעילת דף" : "בלי נעילת דף", "· עמודים:", pages);
console.log("משאבים חיצוניים בדף:", JSON.stringify(external.external));

logs.length = 0;
await p.evaluate(() => document.getElementById("pdf-download")?.click());
await new Promise((r) => setTimeout(r, 25000));
console.log("לוגים מהייצוא:");
for (const l of logs.slice(0, 8)) console.log("   ", l);
console.log(logs.length ? "" : "    (אין לוגים — הייצוא לא דיווח על בעיה)");
await b.close();
