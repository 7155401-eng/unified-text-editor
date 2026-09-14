// verify_pdf_blob.mjs — האם ייצוא ה-PDF באמת מייצר קובץ?
//
// בדיקת ההורדה ב-headless אינה אמינה (הורדת blob לא תמיד נתפסת), לכן
// בודקים ישירות את מה שחשוב: האם נוצר Blob של PDF, ומה גודלו.
// עוטפים את URL.createObjectURL ורושמים כל blob מסוג application/pdf.

import pp from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const WITH_DAF = process.env.WITH_DAF !== "0";

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const logs = [];
p.on("console", (m) => { const t = m.text(); if (/PDF|taint|Security/i.test(t)) logs.push(t.slice(0, 120)); });

// הזרקה לפני טעינת הדף: לוכד כל blob של PDF
await p.evaluateOnNewDocument(() => {
  window.__pdfBlobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    try {
      if (obj instanceof Blob && /pdf/i.test(obj.type || "")) {
        window.__pdfBlobs.push({ size: obj.size, type: obj.type });
      }
    } catch { /* לא מפריעים לזרימה */ }
    return orig(obj);
  };
  window.__printCalled = false;
  const origPrint = window.print.bind(window);
  window.print = () => { window.__printCalled = true; };
});

await p.goto(URL_, { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate((lock) => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", lock ? "auto" : "0");
  localStorage.setItem("ravtext.vilnaDaf.fitPageToText", "0");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
}, WITH_DAF);
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
// הרינדור האוטומטי מושבת במערכת (AUTO_RENDER_GATE) — לוחצים "רנדר".
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate(() => document.getElementById("btn-render")?.click());
// ממתינים לרינדור אמיתי — המסמך הפותח בצורת גפ"ת לוקח זמן.
let pages = 0;
for (let i = 0; i < 180; i++) {
  pages = await p.evaluate(() => document.querySelectorAll(".pages-container .page").length);
  if (pages > 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 4000));
pages = await p.evaluate(() => document.querySelectorAll(".pages-container .page").length);
console.log(`מצב: ${WITH_DAF ? "עם" : "בלי"} נעילת דף · עמודים על המסך: ${pages}`);
check("יש עמודים לייצא", pages > 0, `=${pages}`);

await p.evaluate(() => document.getElementById("pdf-download")?.click());
const deadline = Date.now() + 300000;
let res = null;
while (Date.now() < deadline) {
  res = await p.evaluate(() => ({
    blobs: window.__pdfBlobs || [],
    printCalled: !!window.__printCalled,
    btn: document.getElementById("pdf-download")?.textContent?.trim(),
  }));
  if (res.blobs.length || res.printCalled) break;
  await new Promise((r) => setTimeout(r, 1000));
}

console.log(`תוצאה: blobs=${JSON.stringify(res.blobs)} · נפילה-להדפסה=${res.printCalled}`);
if (logs.length) console.log("לוג:", [...new Set(logs)].slice(0, 4).join(" | "));

check("נוצר קובץ PDF (blob)", res.blobs.length > 0, "לא נוצר");
check("הקובץ אינו ריק", res.blobs.length > 0 && res.blobs[0].size > 20000,
  res.blobs[0] ? `${Math.round(res.blobs[0].size / 1024)}KB` : "-");
check("לא נדרשה נפילה להדפסת דפדפן", !res.printCalled);

await b.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
