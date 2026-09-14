// verify_main_font.mjs — האם פונט שנקבע בסגנון "טקסט ראשי" מגיע לפלט?
//
// משה: "בחרתי בהגדרות כלליות שהסגנון יהיה גמרא ראשי, והגדרתי שם פונט
// וילנא — בפועל עדיין פרנקרול".
// שתי אפשרויות: (א) הסגנון לא מגיע למנוע; (ב) הוא מגיע אבל הפונט אינו
// מותקן והדפדפן נופל לפונט חלופי. הבדיקה מפרידה ביניהן: היא בודקת גם
// מה נכתב על השורה וגם מה הדפדפן באמת מרנדר.

import pp from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
// פונט שקיים תמיד — כדי שהבדיקה תבחין בין "לא הגיע" ל"לא מותקן"
const REAL_FONT = "Courier New";
const FAKE_FONT = "Vilna Shas Test Font";

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 } });
const p = await b.newPage();
await p.goto(URL_, { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "0");
  localStorage.setItem("ravtext.talmudLayout", "1");
});
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));

const setup = await p.evaluate(async ({ real }) => {
  const styles = await import("/src/style_registry.js");
  const docs = await import("/src/document_style_settings.js");
  const id = "main-font-test";
  styles.saveTextStyles([...(styles.loadTextStyles() || []).filter((x) => x.id !== id),
    { id, name: "גמרא ראשי בדיקה", fontFamily: real, fontSize: 14 }]);
  docs.saveDocumentStyleSettings({ ...docs.loadDocumentStyleSettings(), mainStyleId: id });
  return {
    saved: docs.loadDocumentStyleSettings().mainStyleId,
    resolvedFont: styles.resolveTextStyle(id)?.fontFamily || null,
    mainStyleFont: docs.getMainTextStyle()?.fontFamily || null,
  };
}, { real: REAL_FONT });
console.log("הגדרה:", JSON.stringify(setup));
check("הסגנון נשמר כ'טקסט ראשי'", setup.saved === "main-font-test", String(setup.saved));
check("הפונט נשמר בתוך הסגנון", setup.resolvedFont === REAL_FONT, String(setup.resolvedFont));
check("getMainTextStyle מחזיר את הפונט", setup.mainStyleFont === REAL_FONT, String(setup.mainStyleFont));

await p.evaluate(() => document.getElementById("btn-render")?.click());
let pages = 0;
for (let i = 0; i < 180; i++) {
  pages = await p.evaluate(() => document.querySelectorAll(".pages-container .page").length);
  if (pages > 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 4000));
check("נבנו עמודים", pages > 0, `=${pages}`);

const out = await p.evaluate(() => {
  const lines = [...document.querySelectorAll(".pages-container .page .v9-line.v9-role-main")].slice(0, 6);
  return lines.map((l) => ({
    inline: l.style.fontFamily || "",
    computed: getComputedStyle(l).fontFamily,
  }));
});
console.log("שורות ראשי:", JSON.stringify(out.slice(0, 2)));
const hasInline = out.some((x) => x.inline.includes(REAL_FONT));
const hasComputed = out.some((x) => x.computed.includes(REAL_FONT));
check("הפונט מהסגנון נכתב על שורות הראשי", hasInline, out[0]?.inline || "(ריק)");
check("הדפדפן מרנדר בפונט הזה", hasComputed, out[0]?.computed || "(ריק)");

await b.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
