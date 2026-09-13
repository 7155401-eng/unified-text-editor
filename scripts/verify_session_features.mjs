// verify_session_features.mjs — בדיקה בדפדפן לכל מה שנוסף ב-13/09:
//   1. בורר גודל הדף — הקופסה במסך משתנה, והמנוע מחשב לפי אותו גודל.
//   2. תפריט העכבר הימני — נפתח, ופעולותיו באמת עובדות (העתקה/הדגשה).
//   3. ייבוא וילנא — בלי [1] [2], דיבור המתחיל מודגש, ברכות כברירת מחדל.
//   4. שני צדי רש"י נגמרים באותו גובה.
//
// שימוש: node scripts/verify_session_features.mjs

import pp from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const browser = await pp.launch({
  executablePath: CHROME, headless: "new", protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 },
});
const page = await browser.newPage();
const context = browser.defaultBrowserContext();
try { await context.overridePermissions(new URL(URL).origin, ["clipboard-read", "clipboard-write"]); } catch {}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

console.log(`פותח ${URL}`);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "auto");
  localStorage.setItem("ravtext.vilnaDaf.mode", "strict");
  localStorage.setItem("ravtext.vilnaDaf.minScale", "55");
  localStorage.setItem("ravtext.vilnaDaf.maxScale", "150");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
  localStorage.removeItem("ravtext.pageSize.v1");
});
await page.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));

// ===================== 1. בורר גודל הדף =====================
console.log("\n[1] בורר גודל הדף");
const sizeUi = await page.evaluate(() => {
  const sel = document.getElementById("page-size-select");
  return {
    exists: !!sel,
    options: sel ? [...sel.options].map((o) => o.value) : [],
    value: sel?.value,
    info: document.getElementById("page-size-info")?.textContent || "",
  };
});
check("הבורר קיים בסרגל", sizeUi.exists);
check("יש בו A4 / A5 / Letter / מותאם אישית",
  ["a4", "a5", "letter", "custom"].every((x) => sizeUi.options.includes(x)), sizeUi.options.join(","));
check("ברירת המחדל היא A4", sizeUi.value === "a4", String(sizeUi.value));

const defaultGeom = await page.evaluate(() => {
  const pg = document.querySelector(".pages-container .page");
  const cs = getComputedStyle(document.documentElement);
  return {
    w: pg ? Math.round(pg.getBoundingClientRect().width) : 0,
    h: pg ? Math.round(pg.getBoundingClientRect().height) : 0,
    varW: cs.getPropertyValue("--ravtext-page-width").trim(),
    varH: cs.getPropertyValue("--ravtext-page-height").trim(),
    zoom: cs.getPropertyValue("--ravtext-print-zoom").trim(),
  };
});
check("A4 שומר בדיוק על הגודל ההיסטורי 380×537",
  defaultGeom.varW === "380px" && defaultGeom.varH === "537px", JSON.stringify(defaultGeom));
check("זום ההדפסה ל-A4 נשאר 2.0887", Math.abs(parseFloat(defaultGeom.zoom) - 2.0887) < 0.002, defaultGeom.zoom);

// מעבר ל-A5 לרוחב — צריך לשנות את יחס העמוד
await page.evaluate(() => {
  const sel = document.getElementById("page-size-select");
  sel.value = "a5l";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 2500));
// עמוד מחוץ לתחום הנראה מקבל content-visibility:auto ומדווח 0×0.
// גוללים אליו לפני המדידה, אחרת מודדים קופסה ריקה.
// שינוי גודל מפעיל רינדור מחדש; עד שהוא נגמר יש בדף עמודים ישנים או
// מיכל ריק. ממתינים עד שקופסת העמוד באמת שווה למשתנה החדש.
// רינדור מלא של המסמך אחרי שינוי גודל יכול לקחת דקה ויותר בצורת גפ"ת.
for (let i = 0; i < 180; i++) {
  const ok = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const want = parseInt(cs.getPropertyValue("--ravtext-page-height"), 10);
    const pg = [...document.querySelectorAll(".pages-container .page")]
      .find((el) => el.offsetParent !== null);
    if (!pg || !want) return false;
    pg.scrollIntoView({ block: "center" });
    return Math.abs(pg.getBoundingClientRect().height - want) <= 1;
  });
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const landscape = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  // בוחרים עמוד שבאמת מוצג (offsetParent קיים) — יש בדף גם מיכלים מוסתרים
  // (תצוגה מקדימה, מדידה) שהעמודים בהם מדווחים 0×0.
  const pg = [...document.querySelectorAll(".pages-container .page")]
    .find((el) => el.offsetParent !== null) || document.querySelector(".pages-container .page");
  return {
    varW: cs.getPropertyValue("--ravtext-page-width").trim(),
    varH: cs.getPropertyValue("--ravtext-page-height").trim(),
    zoom: parseFloat(cs.getPropertyValue("--ravtext-print-zoom")),
    // מודדים את קופסת ה-CSS ולא את ה-rect: עמוד עם content-visibility
    // שלא צויר עדיין מחזיר rect אפסי, אבל קופסת ה-CSS שלו נכונה תמיד.
    boxW: pg ? Math.round(parseFloat(getComputedStyle(pg).width)) : 0,
    boxH: pg ? Math.round(parseFloat(getComputedStyle(pg).height)) : 0,
  };
});
check("A5 לרוחב — העמוד באמת רחב מגובה", parseInt(landscape.varH, 10) < parseInt(landscape.varW, 10),
  `${landscape.varW}×${landscape.varH}`);
check("קופסת העמוד במסך זהה למה שהמנוע מקבל",
  landscape.boxW === parseInt(landscape.varW, 10) && landscape.boxH === parseInt(landscape.varH, 10),
  `קופסה ${landscape.boxW}×${landscape.boxH} מול משתנים ${landscape.varW}×${landscape.varH}`);

// חזרה ל-A4 להמשך הבדיקות
await page.evaluate(() => {
  const sel = document.getElementById("page-size-select");
  sel.value = "a4";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 2500));

// ===================== 2. תפריט העכבר הימני =====================
console.log("\n[2] תפריט העכבר הימני");
const spot = await page.evaluate(() => {
  const ed = document.querySelector(".ProseMirror");
  if (!ed) return null;
  const r = ed.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 25) };
});
// מסמנים מילה ואז לוחצים ימני
// בוחרים טווח מילים אמיתי. לחיצה כפולה "עיוורת" נפלה פעם על רווח בלבד,
// וכל הבדיקה נראתה כאילו ההדגשה לא עובדת.
await page.evaluate(() => {
  const pm = window.paneManager;
  const ed = pm.getActiveEditor?.() || pm.getMainPane()?.editor;
  ed.commands.focus();
  ed.commands.setTextSelection({ from: 5, to: 18 });
});
await new Promise((r) => setTimeout(r, 300));
const selectedBefore = await page.evaluate(() => {
  const pm = window.paneManager;
  const ed = pm.getActiveEditor?.() || pm.getMainPane()?.editor;
  const { from, to } = ed.state.selection;
  return { text: ed.state.doc.textBetween(from, to, " ", " "), from, to };
});
await page.mouse.click(spot.x, spot.y, { button: "right" });
await new Promise((r) => setTimeout(r, 600));

const menu = await page.evaluate(() => {
  const m = document.querySelector(".ctx-menu");
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return {
    buttons: [...m.querySelectorAll("button")].map((b) => ({ t: b.textContent, disabled: b.disabled })),
    onScreen: r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1,
  };
});
check("התפריט נפתח", !!menu);
check("יש בו פעולות עיצוב (מודגש/נטוי/קו תחתון)",
  !!menu && ["מודגש", "נטוי", "קו תחתון"].every((w) => menu.buttons.some((b) => b.t.includes(w))),
  menu ? menu.buttons.map((b) => b.t).join("|") : "");
check("התפריט כולו בתוך המסך", !!menu && menu.onScreen);
check("יש טקסט מסומן והפעולות פעילות",
  !!selectedBefore.text && !!menu && !menu.buttons.find((b) => b.t.includes("העתק"))?.disabled,
  `מסומן="${selectedBefore.text.slice(0, 12)}"`);

// לחיצה על "מודגש" — הפעולה חייבת להשפיע על הטקסט המסומן
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".ctx-menu button")].find((x) => x.textContent.includes("מודגש"));
  b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  b.click();
});
await new Promise((r) => setTimeout(r, 800));
const boldApplied = await page.evaluate((range) => {
  const pm = window.paneManager;
  const ed = pm.getActiveEditor?.() || pm.getMainPane()?.editor;
  let bold = false;
  ed.state.doc.nodesBetween(range.from, range.to, (node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "bold" || m.type.name === "strong")) bold = true;
  });
  return bold;
}, selectedBefore);
check("לחיצה על 'מודגש' באמת הדגישה את הטקסט המסומן", boldApplied);
await page.evaluate(() => document.querySelectorAll(".ctx-menu").forEach((m) => m.remove()));

// ===================== 3. ייבוא וילנא =====================
console.log("\n[3] ייבוא וילנא");
await page.waitForSelector("#btn-vilna-import", { timeout: 30000 });
await page.$eval("#btn-vilna-import", (el) => el.click());
await page.waitForSelector("#vilna-import-tractate", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
const defaultTractate = await page.evaluate(() => {
  const sel = document.querySelector("#vilna-import-tractate");
  return { value: sel.value, label: sel.options[sel.selectedIndex]?.textContent };
});
check("ברירת המחדל היא ברכות ולא ערכין", defaultTractate.value === "berakhot",
  `${defaultTractate.value} (${defaultTractate.label})`);

await page.evaluate(() => {
  const modal = document.querySelector(".sef-modal");
  const selects = modal.querySelectorAll("select");
  const fire = (el, ev = "change") => el.dispatchEvent(new Event(ev, { bubbles: true }));
  selects[1].value = "dafim"; fire(selects[1]);
  const t = [...modal.querySelectorAll("input")].filter((i) => i.type !== "checkbox");
  t[0].value = "ב."; fire(t[0], "input");
  t[1].value = "ג."; fire(t[1], "input");
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => [...document.querySelectorAll(".sef-modal button")]
  .find((x) => x.textContent.includes("ייבא לעורך")).click());

const deadline = Date.now() + 420000;
while (Date.now() < deadline) {
  const st = await page.evaluate(() => ({
    pages: document.querySelectorAll(".pages-container .page").length,
    total: window.__VILNA_DAF_REPORT__?.pagesTotal || 0,
  }));
  if (st.total > 0 && st.pages >= st.total) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 2500));

const pageInfo = await page.evaluate(() => {
  const pg = document.querySelector(".pages-container .page");
  const lines = [...pg.querySelectorAll(".v9-line")];
  const text = lines.map((l) => l.textContent).join(" ");
  // V9 מרנדר הדגשה כ-span עם font-weight ולא כ-<strong>
  const bolds = [...pg.querySelectorAll('strong, b, .note-lemma, span[style*="font-weight"]')]
    .filter((e) => e.textContent.trim());
  const pr = pg.getBoundingClientRect();
  const sideBottom = (role) => {
    const rel = lines.filter((l) => l.dataset.v9Role === role);
    if (!rel.length) return null;
    return Math.round(Math.max(...rel.map((l) => l.getBoundingClientRect().bottom)) - pr.top);
  };
  return {
    hasBracketNumbers: /\[\d+\]/.test(text),
    boldCount: bolds.length,
    boldSamples: bolds.slice(0, 6).map((b) => b.textContent.slice(0, 40)),
    // הרצף הארוך ביותר של מילים מודגשות רצופות בתוך אותה שורה
    maxBoldRun: (() => {
      let best = 0;
      for (const line of lines) {
        let run = 0;
        for (const el of line.children) {
          const isBold = /700|bold/i.test(el.style?.fontWeight || "") || /^(STRONG|B)$/.test(el.tagName);
          if (isBold && el.textContent.trim()) { run++; best = Math.max(best, run); }
          else if (el.textContent.trim()) run = 0;
        }
      }
      return best;
    })(),
    rightBottom: sideBottom("right"),
    leftBottom: sideBottom("left"),
    pageHeight: Math.round(pr.height),
    pages: document.querySelectorAll(".pages-container .page").length,
  };
});
check("אין [1] [2] בהערות", !pageInfo.hasBracketNumbers);
check("הדיבור המתחיל מודגש", pageInfo.boldCount > 0, `=${pageInfo.boldCount}`);
// V9 מרנדר כל מילה בספאן נפרד, ולכן דיבור מתחיל בן חמש מילים מופיע
// כחמישה ספאנים מודגשים רצופים. הבדיקה הנכונה: כמה מילים רצופות מודגשות.
check("ההדגשה מכסה כמה מילים (ולא רק את המילה הראשונה)",
  pageInfo.maxBoldRun >= 2, `רצף מודגש מקסימלי: ${pageInfo.maxBoldRun} מילים`);

// ===================== 4. שני הצדדים באותו גובה =====================
console.log("\n[4] שני צדי רש\"י");
const gap = (pageInfo.rightBottom !== null && pageInfo.leftBottom !== null)
  ? Math.abs(pageInfo.rightBottom - pageInfo.leftBottom) : null;
const gapPct = gap !== null ? Math.round((gap / pageInfo.pageHeight) * 100) : null;
console.log(`    ימין נגמר ב-${pageInfo.rightBottom} · שמאל ב-${pageInfo.leftBottom} · עמוד ${pageInfo.pageHeight} · פער ${gapPct}%`);
check("שני הצדדים נגמרים בגובה דומה (פער עד 12% מגובה העמוד)",
  gap !== null && gapPct <= 12, `פער ${gap}px (${gapPct}%)`);

// 404 של /api בשרת הפיתוח (אין Worker מקומי) אינו שגיאה של הקוד.
const devNoise = /Failed to load resource|not valid JSON|ERR_UNKNOWN_URL_SCHEME|favicon|ERR_EMPTY_RESPONSE/i;
const realErrors = errors.filter((e) => !devNoise.test(e));
check("אין שגיאות JS אמיתיות", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

await page.screenshot({ path: "C:/Users/User/ravtext_work/session_features.png" });
await browser.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
