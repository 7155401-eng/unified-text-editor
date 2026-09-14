// verify_daf_lock_pdf.mjs — ייצוא PDF כשנעילת הדף דלוקה.
//
// למה זו בדיקה נפרדת: הייצוא מצלם כל עמוד מה-DOM ומדביק לקובץ. אם נעילת
// הדף משאירה מיכלי-ניסיון מוסתרים, או אם העמודים לא "ממומשים" (content-
// visibility), ה-PDF יכול לצאת עם עמודים חסרים או ריקים. כאן בודקים על
// הקובץ עצמו כמה עמודים יש בו ושהוא תקין.
//
// שימוש: node scripts/verify_daf_lock_pdf.mjs

import pp from "puppeteer-core";
import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/";
const DL_DIR = resolve(ROOT, ".pdf-verify-downloads");
const FROM_LABEL = "ב.";
const TO_LABEL = "ג:";        // ארבעה עמודים — מספיק לבדיקה ולא לוקח נצח
const EXPECTED_DAFIM = 4;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

if (existsSync(DL_DIR)) await rm(DL_DIR, { recursive: true, force: true });
await mkdir(DL_DIR, { recursive: true });

const browser = await pp.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const client = await page.createCDPSession();
await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL_DIR });

console.log(`פותח ${URL}`);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "auto");
  localStorage.setItem("ravtext.vilnaDaf.mode", "strict");
  localStorage.setItem("ravtext.vilnaDaf.minScale", "55");
  localStorage.setItem("ravtext.vilnaDaf.maxScale", "150");
  localStorage.setItem("ravtext.vilnaDaf.showLabel", "1");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await page.evaluate(() => {
  const st = document.createElement("style");
  st.textContent = `
    :root, .pages-container { --ravtext-page-width: 794px; --ravtext-page-height: 1123px; }
    .page { width: 794px !important; height: 1123px !important; flex: 0 0 1123px !important; }
    .pages-container > .page:not(.measure-page) { contain-intrinsic-size: 794px 1123px !important; }
  `;
  document.head.appendChild(st);
});

// --- ייבוא ---
await page.waitForSelector("#btn-vilna-import", { timeout: 30000 });
await page.$eval("#btn-vilna-import", (el) => el.click());
await page.waitForSelector("#vilna-import-tractate", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const sel = document.querySelector("#vilna-import-tractate");
  sel.value = "berakhot";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate((f, t) => {
  const modal = document.querySelector(".sef-modal");
  const selects = modal.querySelectorAll("select");
  const fire = (el, ev = "change") => el.dispatchEvent(new Event(ev, { bubbles: true }));
  selects[1].value = "dafim"; fire(selects[1]);
  const texts = [...modal.querySelectorAll("input")].filter((i) => i.type !== "checkbox");
  texts[0].value = f; fire(texts[0], "input");
  texts[1].value = t; fire(texts[1], "input");
}, FROM_LABEL, TO_LABEL);
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => [...document.querySelectorAll(".sef-modal button")]
  .find((x) => x.textContent.includes("ייבא לעורך")).click());

const deadline = Date.now() + 420000;
let ready = false;
while (Date.now() < deadline) {
  const st = await page.evaluate(() => ({
    pages: document.querySelectorAll(".pages-container .page").length,
    total: window.__VILNA_DAF_REPORT__?.pagesTotal || 0,
  }));
  if (st.total > 0 && st.pages >= st.total) { ready = true; break; }
  await new Promise((r) => setTimeout(r, 1000));
}
check("הרינדור הסתיים", ready);
const domPages = await page.evaluate(() => document.querySelectorAll(".pages-container .page").length);
check(`${EXPECTED_DAFIM} דפים → ${EXPECTED_DAFIM} עמודים במסך`, domPages === EXPECTED_DAFIM, `=${domPages}`);

// --- ייצוא PDF ---
const hasBtn = await page.evaluate(() => !!document.getElementById("pdf-download"));
check("כפתור הורדת PDF קיים", hasBtn);
if (hasBtn) {
  await page.evaluate(() => document.getElementById("pdf-download").click());
  const dl = Date.now() + 420000;
  let file = null;
  while (Date.now() < dl) {
    const files = (await readdir(DL_DIR)).filter((f) => f.endsWith(".pdf"));
    if (files.length) {
      // ממתינים שההורדה תיגמר (אין יותר קובץ .crdownload)
      const partial = (await readdir(DL_DIR)).some((f) => f.endsWith(".crdownload"));
      if (!partial) { file = files[0]; break; }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  check("נוצר קובץ PDF", !!file, file || "לא נוצר");

  if (file) {
    const buf = await readFile(resolve(DL_DIR, file));
    const head = buf.subarray(0, 5).toString("latin1");
    check("הקובץ הוא PDF תקין", head === "%PDF-", head);
    const text = buf.toString("latin1");
    const pageObjects = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const countMatch = text.match(/\/Count\s+(\d+)/);
    const pdfPages = countMatch ? parseInt(countMatch[1], 10) : pageObjects;
    // הייצוא מוסיף עמוד שער אחד לפני העמודים
    check(`ב-PDF יש ${EXPECTED_DAFIM} עמודים + שער`, pdfPages === EXPECTED_DAFIM + 1 || pdfPages === EXPECTED_DAFIM,
      `=${pdfPages}`);
    check("הקובץ אינו ריק", buf.length > 50000, `${Math.round(buf.length / 1024)}KB`);
    console.log(`    (${file} · ${Math.round(buf.length / 1024)}KB · ${pdfPages} עמודי PDF)`);
  }
}

// --- מיכלי הניסיון לא נכנסו לייצוא ---
const trials = await page.evaluate(() => document.querySelectorAll("[data-daf-trial]").length);
check("לא נשארו מיכלי-ניסיון בדף", trials === 0, `=${trials}`);
check("אין שגיאות JS", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
