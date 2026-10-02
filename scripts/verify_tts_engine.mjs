// בדיקות למנוע ההקראה. בלי רשת, בלי מפתח אמיתי, בלי דפדפן.
// מריצים: node scripts/verify_tts_engine.mjs

import {
  readElevenLabsKey,
  stripForSpeech,
  chunkTextForSpeech,
  estimateSpeechSeconds,
  buildElevenLabsRequest,
  describeTtsFailure,
  TTS_CONFIG_KEY,
  ELEVEN_DEFAULT_VOICE,
  MAX_CHARS_PER_CHUNK,
} from "../src/tts/tts_engine.js";

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}\n      צפוי: ${JSON.stringify(expected)}\n      קיבלנו: ${JSON.stringify(actual)}`); }
}
function checkThat(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
}

const fakeStorage = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null) });

console.log("\n[1] המפתח נקרא מאותו מקום שבו כלי התמלול כבר שומר אותו");
check("מפתח קיים",
  readElevenLabsKey(fakeStorage({ [TTS_CONFIG_KEY]: JSON.stringify({ elevenlabs_api_key: "sk-abc" }) })),
  "sk-abc");
check("רווחים מסביב נחתכים",
  readElevenLabsKey(fakeStorage({ [TTS_CONFIG_KEY]: JSON.stringify({ elevenlabs_api_key: "  sk-x  " }) })),
  "sk-x");
check("אין הגדרות בכלל", readElevenLabsKey(fakeStorage({})), "");
check("הגדרות פגומות לא מפילות", readElevenLabsKey(fakeStorage({ [TTS_CONFIG_KEY]: "{{{" })), "");
check("אין אחסון בכלל", readElevenLabsKey(null), "");

console.log("\n[2] ניקוי לקריאה — הקול לא מקריא קודים");
check("סימן זרם יורד", stripForSpeech("ויאמר @01 משה"), "ויאמר משה");
check("סימן זרם עם מספר בסוגריים", stripForSpeech("ויאמר @01 [7] משה"), "ויאמר משה");
check("מספר הערה בודד", stripForSpeech("ויאמר[3] משה"), "ויאמר משה");
check("הערה מסולסלת יורדת", stripForSpeech("ויאמר {כאן הערה} משה"), "ויאמר משה");
check("ואפשר להשאיר אותה", stripForSpeech("ויאמר {כאן הערה} משה", { keepCurlyNotes: true }), "ויאמר {כאן הערה} משה");
check("סוגריי הדמו יורדות", stripForSpeech("ויאמר ⟦דמו⟧ משה"), "ויאמר דמו משה");
check("רווח לפני פסיק נצמד", stripForSpeech("ויאמר @01 , משה"), "ויאמר, משה");
check("שורות ריקות בין פסקאות נשמרות", stripForSpeech("פסקה א\n\nפסקה ב"), "פסקה א\n\nפסקה ב");
check("שלוש שורות ריקות מצטמצמות לשתיים", stripForSpeech("א\n\n\n\nב"), "א\n\nב");
check("טקסט ריק", stripForSpeech(""), "");
check("null אינו מפיל", stripForSpeech(null), "");

console.log("\n[3] חיתוך למנות — לעולם לא באמצע מילה");
check("טקסט קצר נשאר אחד", chunkTextForSpeech("שלום עולם", 100), ["שלום עולם"]);
check("טקסט ריק", chunkTextForSpeech("   ", 100), []);

const sentences = "משפט ראשון. משפט שני. משפט שלישי. משפט רביעי.";
const bySentence = chunkTextForSpeech(sentences, 30);
checkThat("נחתך בסוף משפט", bySentence.every((c) => /[.!?׃:]$/u.test(c.trim())), JSON.stringify(bySentence));
check("שום תו לא אבד", bySentence.join(" ").replace(/\s+/gu, " "), sentences);

const noSentence = "אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר";
const byWord = chunkTextForSpeech(noSentence, 20);
checkThat("בלי סוף משפט — נחתך ברווח", byWord.every((c) => !c.startsWith(" ") && !c.endsWith(" ")), JSON.stringify(byWord));
check("ושום מילה לא נשברה", byWord.join(" "), noSentence);

const giant = "א".repeat(50);
const byForce = chunkTextForSpeech(giant, 20);
checkThat("מילה ענקית אחת נחתכת בגבול, כי אין ברירה", byForce.length === 3, JSON.stringify(byForce.map((c) => c.length)));
check("וגם אז שום תו לא אבד", byForce.join(""), giant);

const long = "משפט. ".repeat(900);
const many = chunkTextForSpeech(long);
checkThat("טקסט ארוך מתחלק", many.length > 1, `${many.length} מנות`);
checkThat("ואף מנה אינה מעל המגבלה",
  many.every((c) => c.length <= MAX_CHARS_PER_CHUNK), JSON.stringify(many.map((c) => c.length).slice(0, 5)));

console.log("\n[4] הערכת זמן");
check("ריק", estimateSpeechSeconds(""), 0);
check("130 תווים ≈ 10 שניות", estimateSpeechSeconds("א".repeat(130)), 10);
check("רווחים כפולים אינם נספרים פעמיים", estimateSpeechSeconds("אב    גד"), estimateSpeechSeconds("אב גד"));

console.log("\n[5] בניית הבקשה — בלי לשלוח כלום");
const req = buildElevenLabsRequest({ text: "שלום", apiKey: "sk-test" });
checkThat("הכתובת מכילה את מזהה הקול", req.url.endsWith(ELEVEN_DEFAULT_VOICE), req.url);
check("שיטה", req.method, "POST");
check("המפתח בכותרת הנכונה", req.headers["xi-api-key"], "sk-test");
check("מבקשים קובץ שמע", req.headers.Accept, "audio/mpeg");
check("הטקסט בגוף", JSON.parse(req.body).text, "שלום");
checkThat("נבחר מודל רב-לשוני", JSON.parse(req.body).model_id.includes("multilingual"));

console.log("\n[6] הבקשה נעצרת לפני שליחה כשחסר משהו");
const expectThrow = (name, fn, needle) => {
  try { fn(); fail += 1; console.log(`  ✗ ${name} — לא נזרקה שגיאה`); }
  catch (e) {
    const ok = String(e.message).includes(needle);
    if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
    else { fail += 1; console.log(`  ✗ ${name} — ההודעה: ${e.message}`); }
  }
};
expectThrow("בלי טקסט", () => buildElevenLabsRequest({ text: "", apiKey: "k" }), "אין טקסט");
expectThrow("רק רווחים", () => buildElevenLabsRequest({ text: "   ", apiKey: "k" }), "אין טקסט");
expectThrow("בלי מפתח", () => buildElevenLabsRequest({ text: "שלום" }), "חסר מפתח");

console.log("\n[7] אבטחה — המפתח אינו דולף להודעות");
let leaked = null;
try { buildElevenLabsRequest({ text: "", apiKey: "sk-SECRET-123" }); } catch (e) { leaked = e.message; }
checkThat("הודעת השגיאה אינה מכילה את המפתח", !String(leaked).includes("SECRET"), String(leaked));
checkThat("גם הודעות התקלה של הספק אינן מכילות אותו",
  !describeTtsFailure(401).includes("SECRET") && !describeTtsFailure(500, "sk-SECRET-123").includes("SECRET"),
  describeTtsFailure(500, "sk-SECRET-123"));

console.log("\n[8] הודעות שגיאה בעברית, אומרות מה לעשות");
for (const [status, needle] of [[401, "המפתח"], [403, "המפתח"], [422, "קול"], [429, "להמתין"], [503, "לנסות שוב"]]) {
  const msg = describeTtsFailure(status);
  checkThat(`שגיאה ${status} מוסברת`, msg.includes(needle) && !/[a-zA-Z]{4,}/u.test(msg.replace(/ElevenLabs/gu, "")), msg);
}

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
