// verify_fit_page.mjs — "התאם את גודל הדף לפי גודל הטקסט".
//
// במצב הזה האות נשארת כפי שנקבעה, וגובה כל עמוד נגזר מהדף שעליו.
// נבדק: הכפתור קיים בסרגל, כל דף מקבל עמוד אחד, לכל עמוד גובה משלו,
// אין חריגה, וגודל האות לא שונה.

import pp from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const FROM = "ב.", TO = "ג.";        // שלושה עמודים
const EXPECTED = 3;

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message.slice(0, 140)));

await p.goto(URL_, { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "auto");
  localStorage.setItem("ravtext.vilnaDaf.mode", "strict");
  localStorage.setItem("ravtext.vilnaDaf.fitPageToText", "1");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
});
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 7000));

// --- הכפתור בסרגל ---
const ui = await p.evaluate(() => {
  const t = document.getElementById("daf-lock-fitpage-toggle");
  return { exists: !!t, checked: t?.checked, label: t?.parentElement?.textContent?.trim() };
});
check("הכפתור קיים בסרגל (ולא רק בחלון הייבוא)", ui.exists);
check("הכפתור משקף את ההגדרה השמורה", ui.checked === true, String(ui.checked));

// --- ייבוא ---
await p.waitForSelector("#btn-vilna-import", { timeout: 30000 });
await p.$eval("#btn-vilna-import", (el) => el.click());
await p.waitForSelector("#vilna-import-tractate", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await p.evaluate((f, t) => {
  const modal = document.querySelector(".sef-modal");
  const fire = (el, ev = "change") => el.dispatchEvent(new Event(ev, { bubbles: true }));
  const sel = modal.querySelector("#vilna-import-tractate");
  sel.value = "berakhot"; fire(sel);
  setTimeout(() => {
    const selects = modal.querySelectorAll("select");
    selects[1].value = "dafim"; fire(selects[1]);
    const texts = [...modal.querySelectorAll("input")].filter((i) => i.type !== "checkbox");
    texts[0].value = f; fire(texts[0], "input");
    texts[1].value = t; fire(texts[1], "input");
  }, 1800);
}, FROM, TO);
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate(() => [...document.querySelectorAll(".sef-modal button")]
  .find((x) => x.textContent.includes("ייבא לעורך")).click());

const dl = Date.now() + 420000;
while (Date.now() < dl) {
  const st = await p.evaluate(() => ({
    total: window.__VILNA_DAF_REPORT__?.pagesTotal || 0,
    pages: document.querySelectorAll(".pages-container .page").length,
  }));
  if (st.total > 0 && st.pages >= st.total) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 3000));

const res = await p.evaluate(() => {
  const pages = [...document.querySelectorAll(".pages-container .page")];
  return {
    report: window.__VILNA_DAF_REPORT__,
    pages: pages.map((pg) => ({
      label: pg.dataset.dafLabel,
      scale: pg.dataset.dafScale,
      inlineH: pg.style.height,
      cssVar: pg.style.getPropertyValue("--ravtext-page-height"),
      cssVarW: pg.style.getPropertyValue("--ravtext-page-width"),
      boxW: Math.round(parseFloat(getComputedStyle(pg).width)),
      boxH: Math.round(parseFloat(getComputedStyle(pg).height)),
      factor: parseFloat(pg.dataset.dafPageFactor || "0"),
      printZoom: parseFloat(pg.style.getPropertyValue("--ravtext-print-zoom") || "0"),
      viewZoom: parseFloat(pg.dataset.dafViewZoom || "1"),
      // רוחב אמיתי על המסך אחרי זום-התצוגה, מול הרוחב הזמין במיכל
      shownW: Math.round(pg.getBoundingClientRect().width),
      availW: Math.round((pg.closest(".pages-container")?.clientWidth || 0) - 20),
      scrollH: pg.scrollHeight,
      offsetH: pg.offsetHeight,
    })),
  };
});

console.log("עמודים:", res.pages.map((x) => `${x.label}=${x.boxW}x${x.boxH}px (×${x.factor}, זום ${Math.round(x.printZoom*1000)/1000})`).join(" · "));
// ★ הדרישה של משה: הגדלה בגובה וברוחב יחד, כדי שבהדפסה כל הדפים יצאו
// בגודל נייר דומה. שתי הבדיקות הבאות מודדות בדיוק את זה.
const ratios = res.pages.map((x) => x.boxW / x.boxH);
check("היחס רוחב/גובה זהה בכל העמודים (הגדלה פרופורציונלית)",
  Math.max(...ratios) - Math.min(...ratios) < 0.02,
  ratios.map((r) => r.toFixed(3)).join(","));
const paper = res.pages.map((x) => x.boxW * x.printZoom);
check("בהדפסה כל הדפים יוצאים באותו רוחב נייר",
  Math.max(...paper) - Math.min(...paper) < 2,
  paper.map((v) => Math.round(v)).join(","));
check("הרוחב גדל יחד עם הגובה",
  res.pages.every((x) => x.cssVarW && parseInt(x.cssVarW, 10) === x.boxW),
  res.pages.map((x) => x.cssVarW).join(","));
// ★ משה 14/09: העמודים חייבים להיראות במלואם, בכל גודל שהם.
check("כל עמוד נכנס ברוחב המסך (לא נחתך)",
  res.pages.every((x) => x.shownW <= x.availW + 4),
  res.pages.map((x) => `${x.shownW}/${x.availW}`).join(" "));
check(`${EXPECTED} דפים → ${EXPECTED} עמודים`, res.pages.length === EXPECTED, `=${res.pages.length}`);
check("גודל האות לא שונה (100%)", res.pages.every((x) => x.scale === "1"), res.pages.map((x) => x.scale).join(","));
check("לכל עמוד נקבע גובה משלו", res.pages.every((x) => x.inlineH && x.boxH > 0),
  res.pages.map((x) => x.inlineH).join(","));
check("הגובה נקבע גם כמשתנה CSS (כדי שההדפסה תכבד אותו)",
  res.pages.every((x) => x.cssVar && parseInt(x.cssVar, 10) === x.boxH),
  res.pages.map((x) => x.cssVar).join(","));
check("הגבהים אינם זהים — כל דף לפי התוכן שלו",
  new Set(res.pages.map((x) => x.boxH)).size > 1, res.pages.map((x) => x.boxH).join(","));
check("אין חריגה מגבולות העמוד",
  res.pages.every((x) => x.scrollH <= x.offsetH + 2),
  res.pages.map((x) => `${x.scrollH}/${x.offsetH}`).join(" "));
check("אף דף לא נשבר לשני עמודים", (res.report?.dafimOverflowed || 0) === 0);
const devNoise = /Failed to load resource|not valid JSON|ERR_/i;
check("אין שגיאות JS אמיתיות", errors.filter((e) => !devNoise.test(e)).length === 0,
  errors.slice(0, 2).join(" | "));

await b.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
