// verify_daf_lock_browser.mjs — בדיקה בדפדפן אמיתי, מקצה לקצה.
//
// זו הבדיקה שבאמת חשובה: לא "הקוד רץ", אלא "העמוד על המסך נגמר היכן שנגמר
// הדף בוילנא". הסקריפט פותח את האתר, מייבא דפי גמרא דרך החלון האמיתי,
// מרנדר, ואז מודד את העמודים שנוצרו.
//
// מה נבדק:
//   1. מספר העמודים = מספר הדפים שיובאו (דף = עמוד).
//   2. תוויות הדפים על העמודים, בסדר הנכון.
//   3. אף עמוד לא חורג מגבולות הדף.
//   4. המילים האחרונות בעמוד = המילים האחרונות של אותו דף במקור.
//   5. אפס אובדן טקסט: כל טקסט הגמרא של הטווח מופיע על העמודים.
//
// שימוש: node scripts/verify_daf_lock_browser.mjs
//   VERIFY_URL=http://127.0.0.1:5211/  VERIFY_FROM=2 VERIFY_TO=9

import puppeteer from "puppeteer-core";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/";
const FROM = parseInt(process.env.VERIFY_FROM || "2", 10);
const TO = parseInt(process.env.VERIFY_TO || "9", 10);
const SLUG = process.env.VERIFY_SLUG || "berakhot";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const data = JSON.parse(await readFile(resolve(ROOT, "public", "data", "sefaria", "vilna_shas", `${SLUG}.json`), "utf8"));
const book = data.book;
const expectedLabels = [];
const HE_ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const HE_TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const heNum = (n) => {
  if (n === 15) return "טו";
  if (n === 16) return "טז";
  let out = "";
  if (n >= 100) { out += "ק".repeat(Math.floor(n / 100)); n %= 100; }
  out += HE_TENS[Math.floor(n / 10)] || "";
  out += HE_ONES[n % 10] || "";
  return out;
};
for (let ai = FROM; ai <= TO; ai++) {
  expectedLabels.push(`${heNum(Math.floor(ai / 2) + 1)}${ai % 2 === 0 ? "." : ":"}`);
}
const lastWordsOfAmud = {};
const firstWordsOfAmud = {};
const allGemaraWords = [];
for (let ai = FROM; ai <= TO; ai++) {
  const segs = (book.gemara[ai] || []).filter(Boolean);
  const words = segs.join(" ").split(/\s+/).filter(Boolean);
  lastWordsOfAmud[ai] = words.slice(-4).join(" ");
  firstWordsOfAmud[ai] = words.slice(0, 4).join(" ");
  allGemaraWords.push(...words);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

console.log(`פותח ${URL}`);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });

// הגדרות מוצא ידועות — כדי שהבדיקה לא תושפע ממה שנשאר מהפעם הקודמת.
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

// גודל העמוד: ברירת המחדל של האתר היא עמוד מסך קטן (380x537). דף גמרא שלם
// עם רש"י לא נכנס בו גם באות זעירה. הבדיקה רצה על עמוד בגודל A4, שזה
// הגודל שבו באמת מדפיסים דף גמרא. אפשר לשנות עם VERIFY_PAGE=default.
const PAGE_SIZE = process.env.VERIFY_PAGE || "a4";
if (PAGE_SIZE !== "default") {
  // חייבים לשנות גם את משתני ה-CSS (מהם המנוע קורא את גודל העמוד) וגם את
  // הכלל של .page (שבו הגודל כתוב בפיקסלים קבועים). אם משנים רק את
  // המשתנים — המנוע בונה עמוד A4 בתוך קופסה של 537px, והתוכן נחתך בשקט
  // בגלל overflow:hidden. זה בדיוק מה שקרה בבדיקה הראשונה.
  await page.evaluate(() => {
    const st = document.createElement("style");
    st.id = "verify-a4-page";
    st.textContent = `
      :root, .pages-container {
        --ravtext-page-width: 794px;
        --ravtext-page-height: 1123px;
      }
      .page { width: 794px !important; height: 1123px !important; flex: 0 0 1123px !important; }
      .pages-container > .page:not(.measure-page) { contain-intrinsic-size: 794px 1123px !important; }
    `;
    document.head.appendChild(st);
  });
  await new Promise((r) => setTimeout(r, 300));
}

// --- ייבוא דרך החלון האמיתי ---
await page.waitForSelector("#btn-vilna-import", { timeout: 30000 });
await page.$eval("#btn-vilna-import", (el) => el.click());
await page.waitForSelector("#vilna-import-tractate", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

const fromLabel = expectedLabels[0];
const toLabel = expectedLabels[expectedLabels.length - 1];
// select[0] = מסכת. בלי לבחור אותה מקבלים את הראשונה ברשימה (ערכין) —
// וזו בדיוק הטעות שהפילה את הבדיקה הזו בפעם הראשונה.
await page.evaluate((slug) => {
  const modal = document.querySelector(".sef-modal");
  const sel = modal.querySelector("#vilna-import-tractate");
  sel.value = slug;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}, SLUG);
await new Promise((r) => setTimeout(r, 2500));
const chosen = await page.evaluate(() => document.querySelector("#vilna-import-tractate").value);
check("נבחרה המסכת הנכונה", chosen === SLUG, `${chosen} מול ${SLUG}`);

await page.evaluate((fromL, toL) => {
  const modal = document.querySelector(".sef-modal");
  const selects = modal.querySelectorAll("select");
  const inputs = modal.querySelectorAll("input");
  const fire = (el, type = "change") => el.dispatchEvent(new Event(type, { bubbles: true }));
  // select[1] = "מה לייבא"
  selects[1].value = "dafim";
  fire(selects[1]);
  const texts = [...inputs].filter((i) => i.type !== "checkbox");
  texts[0].value = fromL; fire(texts[0], "input");
  texts[1].value = toL; fire(texts[1], "input");
}, fromLabel, toLabel);
await new Promise((r) => setTimeout(r, 400));

const previewText = await page.evaluate(() => document.querySelector(".sef-modal")?.innerText || "");
check("החלון מראה תצוגה מקדימה עם מספר עמודים", /\d+ עמודים/.test(previewText), previewText.slice(0, 80));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".sef-modal button")];
  const b = btns.find((x) => x.textContent.includes("ייבא לעורך"));
  b.click();
});

// --- ממתינים לרינדור ---
const deadline = Date.now() + 420000;
let ready = false;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => ({
    pages: document.querySelectorAll(".pages-container .page").length,
    report: window.__VILNA_DAF_REPORT__ ? window.__VILNA_DAF_REPORT__.segments.length : 0,
    total: window.__VILNA_DAF_REPORT__ ? window.__VILNA_DAF_REPORT__.pagesTotal : 0,
  }));
  if (state.report > 0 && state.pages >= state.total && state.total > 0) { ready = true; break; }
  await new Promise((r) => setTimeout(r, 1000));
}
check("הרינדור הסתיים בזמן", ready);

const result = await page.evaluate(() => {
  const pages = [...document.querySelectorAll(".pages-container .page")];
  return {
    report: window.__VILNA_DAF_REPORT__,
    pages: pages.map((p) => {
      const labelEl = p.querySelector(".v9-daf-label");
      // כל שורה היא אלמנט נפרד; חייבים לחבר עם רווח, אחרת המילה האחרונה
      // של שורה והמילה הראשונה של הבאה נדבקות ואי אפשר לחפש ביטוי.
      const lines = [...p.querySelectorAll(".v9-line")];
      const joinText = (arr) => arr.map((x) => x.textContent).join(" ").replace(/\s+/g, " ").trim();
      return {
        label: p.dataset.dafLabel || "",
        part: p.dataset.dafPart || "",
        scale: p.dataset.dafScale || "",
        labelShown: labelEl ? labelEl.textContent : "",
        height: p.offsetHeight,
        scrollHeight: p.scrollHeight,
        text: joinText(lines),
        mainText: joinText(lines.filter((x) => x.classList.contains("v9-role-main"))),
        sideText: joinText(lines.filter((x) => !x.classList.contains("v9-role-main"))),
      };
    }),
  };
});

const geomProbe = await page.evaluate(() => {
  const containers = [...document.querySelectorAll(".pages-container")];
  const pg = document.querySelector(".pages-container .page");
  return {
    containerCount: containers.length,
    containerVar: containers.map((c) => getComputedStyle(c).getPropertyValue("--ravtext-page-height").trim()),
    pageVar: pg ? getComputedStyle(pg).getPropertyValue("--ravtext-page-height").trim() : null,
    pageHeight: pg ? getComputedStyle(pg).height : null,
    pageOffsetHeight: pg ? pg.offsetHeight : null,
    sameContainer: pg && containers.length ? pg.parentElement === containers[0] : null,
  };
});
console.log("geom:", JSON.stringify(geomProbe));
console.log(`\nנבנו ${result.pages.length} עמודים · דוח: ${JSON.stringify(result.report?.segments?.length)} קטעים`);

check("מספר העמודים = מספר הדפים", result.pages.length === expectedLabels.length,
  `${result.pages.length} מול ${expectedLabels.length}`);
check("תוויות הדפים בסדר הנכון",
  result.pages.map((p) => p.label).join(",") === expectedLabels.join(","),
  result.pages.map((p) => p.label).join(","));
check("שם הדף מוצג על כל עמוד", result.pages.every((p) => p.labelShown), 
  result.pages.map((p) => p.labelShown || "-").join(","));
check("אף דף לא נשבר לשני עמודים", !result.pages.some((p) => p.part));
check("קופסת העמוד תואמת את מה שהמנוע חישב",
  geomProbe.pageOffsetHeight === parseInt(geomProbe.pageVar, 10),
  `${geomProbe.pageOffsetHeight} מול ${geomProbe.pageVar}`);
check("אין חריגה מגבולות העמוד",
  result.pages.every((p) => p.scrollHeight <= p.height + 2),
  result.pages.map((p) => `${p.scrollHeight}/${p.height}`).join(" "));
// בשרת הפיתוח אין את ה-Worker, ולכן /api/streams/parse מחזיר 404 והדפדפן
// רושם שגיאת רשת. זה קיים גם בלי השינוי הזה ואינו קשור לנעילת דף.
const devNoise = /Failed to load resource|not valid JSON|ERR_UNKNOWN_URL_SCHEME|favicon/i;
const criticalErrors = errors.filter((e) => !devNoise.test(e));
check("אין שגיאות JS אמיתיות בדף", criticalErrors.length === 0, criticalErrors.slice(0, 3).join(" | "));
if (errors.length) console.log(`    (${errors.length} שגיאות רשת של שרת הפיתוח — לא קשורות)`);

// --- סוף עמוד = סוף הדף בוילנא ---
// V9 ממקם כל מילה בנפרד, ולכן ב-textContent של שורה אין רווחים בין מילים.
// לכן ההשוואה היא על רצף האותיות בלבד: מורידים כל דבר שאינו אות עברית.
const letters = (s) => String(s || "").replace(/[^א-ת]/g, "");

const byLabel = new Map();
for (const p of result.pages) {
  const key = p.label || "(ללא)";
  if (!byLabel.has(key)) byLabel.set(key, []);
  byLabel.get(key).push(p);
}

let endsOk = 0;
let startsOk = 0;
for (let i = 0; i < expectedLabels.length; i++) {
  const label = expectedLabels[i];
  const ai = FROM + i;
  const group = byLabel.get(label) || [];
  const mainLetters = letters(group.map((p) => p.mainText).join(""));
  const head = letters(firstWordsOfAmud[ai]);
  const tail = letters(lastWordsOfAmud[ai]);
  if (mainLetters.startsWith(head)) startsOk++;
  else console.log(`    דף ${label}: העמוד לא מתחיל בתחילת הדף`);
  if (mainLetters.endsWith(tail)) endsOk++;
  else console.log(`    דף ${label}: העמוד לא נגמר בסוף הדף`);
}
check("תחילת כל עמוד היא תחילת הדף בוילנא", startsOk === expectedLabels.length,
  `${startsOk}/${expectedLabels.length}`);
check("סוף כל עמוד הוא סוף הדף בוילנא", endsOk === expectedLabels.length,
  `${endsOk}/${expectedLabels.length}`);

// --- אפס אובדן ---
const allLetters = letters(result.pages.map((p) => p.mainText).join(""));
let missing = 0;
for (let i = 0; i < allGemaraWords.length; i += 25) {
  const phrase = letters(allGemaraWords.slice(i, i + 4).join(""));
  if (phrase.length < 10) continue;
  if (!allLetters.includes(phrase)) missing++;
}
check("אפס אובדן טקסט גמרא על העמודים", missing === 0, `${missing} קטעים חסרים`);

// --- רש"י: כל פירוש של הדף חייב להיות על העמוד של אותו דף ---
let rashiMissing = 0;
let rashiTotal = 0;
for (let i = 0; i < expectedLabels.length; i++) {
  const ai = FROM + i;
  const group = byLabel.get(expectedLabels[i]) || [];
  const sideLetters = letters(group.map((p) => p.sideText).join(""));
  for (const line of (book.rashi[ai] || [])) {
    for (const c of (line || [])) {
      rashiTotal++;
      // בודקים את 12 האותיות הראשונות של הדיבור המתחיל (או של הגוף)
      const probe = letters(c.dh || c.body).slice(0, 12);
      if (probe.length >= 8 && !sideLetters.includes(probe)) rashiMissing++;
    }
  }
}
check('כל פירושי רש"י של הדף נמצאים על העמוד שלו', rashiMissing === 0,
  `${rashiMissing} חסרים מתוך ${rashiTotal}`);
console.log(`    (נבדקו ${rashiTotal} פירושי רש"י)`);

// --- בדיקת אי-רגרסיה: כשמכבים את נעילת הדף, הכול חוזר להתנהגות הרגילה ---
// (המקרה של "מסמך בלי סימני דף" נבדק בבדיקת היחידה verify_daf_lock.mjs.)
console.log("\n[רגרסיה] כיבוי נעילת הדף");
await page.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "0");
  window.__VILNA_DAF_REPORT__ = null;
  document.getElementById("btn-render")?.click();
});
{
  const dl = Date.now() + 300000;
  let pages = 0;
  while (Date.now() < dl) {
    const st = await page.evaluate(() => ({
      pages: document.querySelectorAll(".pages-container .page").length,
      status: document.getElementById("status")?.textContent || "",
    }));
    if (st.pages > 0 && !/מרענן|בונה/.test(st.status)) { pages = st.pages; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 3000));
  const st = await page.evaluate(() => ({
    pages: document.querySelectorAll(".pages-container .page").length,
    labeled: document.querySelectorAll(".pages-container .page[data-daf-label]").length,
    labelEls: document.querySelectorAll(".v9-daf-label").length,
    trials: document.querySelectorAll("[data-daf-trial]").length,
    report: !!window.__VILNA_DAF_REPORT__,
  }));
  check("אחרי כיבוי — המסמך עדיין נבנה", st.pages > 0, JSON.stringify(st));
  check("אחרי כיבוי — אין דוח נעילת דף", !st.report);
  check("אחרי כיבוי — אין תוויות דף", st.labeled === 0 && st.labelEls === 0, JSON.stringify(st));
  check("אחרי כיבוי — לא נשארו מיכלי-ניסיון", st.trials === 0);
  console.log(`    (בלי נעילת דף אותו תוכן התפרס על ${st.pages} עמודים)`);
}

// --- דוח וצילום ---
const report = {
  url: URL, slug: SLUG, fromAmud: FROM, toAmud: TO,
  pages: result.pages.map((p) => ({
    label: p.label, scale: p.scale, height: p.height, scrollHeight: p.scrollHeight,
    chars: p.text.length,
  })),
  daf: result.report,
  errors,
};
await writeFile(resolve(ROOT, "verify-daf-lock-report.json"), JSON.stringify(report, null, 2), "utf8");
await page.screenshot({ path: resolve(ROOT, "verify-daf-lock.png"), fullPage: false });
console.log("\nדוח: verify-daf-lock-report.json · צילום: verify-daf-lock.png");

await browser.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
