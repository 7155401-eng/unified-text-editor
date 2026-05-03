// stream_split.test.js
import { splitTextByMarkers, buildMainHTML, buildStreamHTML, mergeBackToText } from "./stream_split.js";

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}
function test(name, fn) { console.log(name); try { fn(); } catch (e) { fail++; console.error(`  ✗ ${e.message}`); } }

test("פיצול בסיסי — שני זרמים", () => {
  const text = "פתיחה @01 הערה ראשונה @02 הערה שנייה";
  const { mainText, streams, intro } = splitTextByMarkers(text);
  assert(intro === "פתיחה ", "הקדמה נכונה");
  assert(mainText.includes("@01") && mainText.includes("@02"), "ראשי שומר סימנים");
  assert(streams["01"][0] === "הערה ראשונה", "זרם 01");
  assert(streams["02"][0] === "הערה שנייה", "זרם 02");
});

test("מספר הערות לאותו זרם", () => {
  const text = "@01 ראשונה @01 שנייה @01 שלישית";
  const { streams } = splitTextByMarkers(text);
  assert(streams["01"].length === 3, "שלוש הערות בזרם 01");
  assert(streams["01"][0] === "ראשונה", "הראשונה נכונה");
  assert(streams["01"][2] === "שלישית", "השלישית נכונה");
});

test("ללא סימנים — טקסט נשאר כולו ראשי", () => {
  const text = "טקסט פשוט בלי סימני זרם";
  const { mainText, streams } = splitTextByMarkers(text);
  assert(mainText === text, "הראשי זהה למקור");
  assert(Object.keys(streams).length === 0, "אין זרמים");
});

test("buildMainHTML צובע סימנים", () => {
  const html = buildMainHTML("פתיחה @01 משהו @02 אחר");
  assert(html.includes("stream-marker"), "מכיל stream-marker");
  assert(html.includes('data-stream="01"'), "data-stream נכון");
  assert(html.includes('data-stream="02"'), "שני זרמים");
  // התוכן בין הסימנים לא מופיע בראשי
  assert(!html.includes("משהו"), "תוכן הזרם הוסר מהראשי");
});

test("buildStreamHTML מציג הערות עם מספור", () => {
  const html = buildStreamHTML("03", ["הערה א", "הערה ב"]);
  assert(html.includes("[1]") && html.includes("[2]"), "מספור רץ");
  assert(html.includes("הערה א"), "תוכן ראשון");
  assert(html.includes("הערה ב"), "תוכן שני");
});

test("mergeBackToText איחוד הפוך", () => {
  const text = "פתיחה @01 הערה ראשונה @02 הערה שנייה @01 שוב לזרם 01";
  const { mainText, streams } = splitTextByMarkers(text);
  const reconstructed = mergeBackToText(mainText, streams);
  // לא חייב להיות זהה תו לתו (רווחים יכולים להשתנות) אבל התוכן שלם
  assert(reconstructed.includes("הערה ראשונה"), "הערה ראשונה הוחזרה");
  assert(reconstructed.includes("הערה שנייה"), "הערה שנייה הוחזרה");
  assert(reconstructed.includes("שוב לזרם 01"), "הערה שלישית הוחזרה");
});

test("עברית עם ניקוד נשמרת בפיצול", () => {
  const text = "בְּרֵאשִׁית @01 בָּרָא אֱלֹהִים @02 הַשָּׁמַיִם";
  const { streams } = splitTextByMarkers(text);
  assert(/[ְ-ׇ]/.test(streams["01"][0]), "ניקוד בזרם 01");
  assert(/[ְ-ׇ]/.test(streams["02"][0]), "ניקוד בזרם 02");
});

console.log(`\n  pass: ${pass}  fail: ${fail}`);
if (fail > 0) process.exit(1);
