// verify_stream_style.mjs — האם סגנון שנבחר לזרם באמת משנה את הפלט?
//
// משה דיווח: "בחרתי סגנון מסגנונות שמורים ולא ראיתי שום שינוי בפלט".
// תיקנתי את הצנרת (המנוע קיבל הגדרות רק לזרמים שהיו ב-__STREAM_SETTINGS__),
// אבל התיקון לא הוכח. הבדיקה הזו מוכיחה אותו מקצה לקצה:
//   1. יוצרים סגנון עם צבע וגודל ייחודיים ושומרים אותו.
//   2. מצמידים אותו לזרם (styleId) דרך חנות ההגדרות.
//   3. מרנדרים ובודקים שהשורות של אותו זרם באמת קיבלו את הצבע והגודל.

import pp from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const TEST_COLOR = "rgb(200, 30, 30)";
const TEST_SIZE = 19;

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 } });
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message.slice(0, 140)));

await p.goto(URL_, { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "0");
  localStorage.setItem("ravtext.vilnaDaf.fitPageToText", "0");
  localStorage.setItem("ravtext.talmudLayout", "1");
});
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));

// --- איזה זרם קיים במסמך הפותח, ומגדירים אותו כזרם גפ"ת ---
const streamCode = await p.evaluate(() => {
  const pane = window.paneManager?.panes?.find((x) => x.streamCode);
  const code = pane ? pane.streamCode : null;
  if (code) localStorage.setItem("ravtext.talmudLayout.streams", code);
  return code;
});
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 5000));
check("נמצא זרם במסמך", !!streamCode, String(streamCode));

// --- יצירת סגנון והצמדתו לזרם, בדיוק כמו מהטבלה ---
const setup = await p.evaluate(async ({ code, color, size }) => {
  const styles = await import("/src/style_registry.js");
  const cols = await import("/src/original_stream_columns.js");
  const id = "test-style-" + Date.now();
  const list = styles.loadTextStyles() || [];
  const style = { id, name: "בדיקת סגנון", color, fontSize: size, bold: true };
  styles.saveTextStyles([...list, style]);
  // הצמדה לזרם — אותה פעולה שמבצעת הטבלה
  const settings = cols.getStreamSettings();
  settings[code] = settings[code] || {};
  settings[code].styleId = id;
  cols.saveStreamSettings();
  return {
    id,
    resolved: !!styles.resolveTextStyle(id),
    effective: cols.getEffectiveStreamSettings(code).styleId,
  };
}, { code: streamCode, color: TEST_COLOR, size: TEST_SIZE });

check("הסגנון נשמר ונמצא במאגר", setup.resolved, setup.id);
check("הסגנון הוצמד לזרם בהגדרות", setup.effective === setup.id, String(setup.effective));

// --- רינדור ---
await p.evaluate(() => document.getElementById("btn-render")?.click());
let pages = 0;
for (let i = 0; i < 180; i++) {
  pages = await p.evaluate(() => document.querySelectorAll(".pages-container .page").length);
  if (pages > 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 4000));
check("נבנו עמודים", pages > 0, `=${pages}`);

const out = await p.evaluate((code) => {
  const lines = [...document.querySelectorAll(".pages-container .page .v9-line")];
  const streamLines = lines.filter((l) => (l.dataset.v9SourceStream === code)
    || (l.className || "").includes("stream-color"));
  const sample = streamLines.slice(0, 40).map((l) => {
    const cs = getComputedStyle(l);
    return { color: cs.color, fontSize: Math.round(parseFloat(cs.fontSize)) };
  });
  const mainLines = lines.filter((l) => l.classList.contains("v9-role-main")).slice(0, 10).map((l) => {
    const cs = getComputedStyle(l);
    return { color: cs.color, fontSize: Math.round(parseFloat(cs.fontSize)) };
  });
  return { total: lines.length, streamCount: streamLines.length, sample, mainLines };
}, streamCode);

console.log(`שורות בעמוד: ${out.total} · מתוכן של הזרם: ${out.streamCount}`);
console.log(`דוגמה מהזרם: ${JSON.stringify(out.sample.slice(0, 3))}`);
console.log(`דוגמה מהראשי:  ${JSON.stringify(out.mainLines.slice(0, 2))}`);

const colored = out.sample.filter((x) => x.color === TEST_COLOR).length;
const sized = out.sample.filter((x) => x.fontSize === TEST_SIZE).length;
check("הצבע מהסגנון הוחל על שורות הזרם", colored > 0, `${colored}/${out.sample.length}`);
check("גודל האות מהסגנון הוחל על שורות הזרם", sized > 0, `${sized}/${out.sample.length}`);
check("הראשי לא הושפע (הסגנון חל רק על הזרם)",
  out.mainLines.every((x) => x.color !== TEST_COLOR), JSON.stringify(out.mainLines[0]));
const devNoise = /Failed to load resource|not valid JSON|ERR_/i;
check("אין שגיאות JS אמיתיות", errors.filter((e) => !devNoise.test(e)).length === 0,
  errors.slice(0, 2).join(" | "));

await b.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
