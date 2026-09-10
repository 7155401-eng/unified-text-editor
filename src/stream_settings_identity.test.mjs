// stream_settings_identity.test.mjs
// משה 10/09/2026: „אני מנסה לסמן V בתוך התיבה 'מספר בהערה' ולא רואה
// שהשתנה משהו בתיבה”, ו„ב'מספר בראשי' כשהפופאפ של הרינדור נעצר”.
//
// שתי העדויות ביחד: התיבה עבדה כשהרינדור נעצר. כלומר הבנייה מחדש של
// הפאנל היא זו שהרסה. היא החליפה את אובייקט ההגדרות באובייקט חדש,
// והתיבות הישנות המשיכו לכתוב לאובייקט נטוש.
//
// הרצה: node src/stream_settings_identity.test.mjs

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = globalThis.window || {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  localStorage: globalThis.localStorage,
};

const mod = await import("./original_stream_columns.js");
const { ensureOriginalStreamSettings, getStreamSettings, getEffectiveStreamSettings } = mod;

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}
function test(name, fn) {
  console.log(name);
  try { fn(); } catch (e) { fail++; console.error(`  ✗ זריקת שגיאה: ${e.message}`); }
}

test("אובייקט ההגדרות שומר על זהותו בין קריאה לקריאה", () => {
  const first = ensureOriginalStreamSettings("01");
  const second = ensureOriginalStreamSettings("01");
  assert(first === second, "אותו אובייקט בדיוק");
});

test("סימון שנכתב לאובייקט ישן מגיע לחנות גם אחרי בנייה מחדש", () => {
  // זה הרגע של משה: הוא מחזיק תיבה שנבנתה קודם...
  const heldByCheckbox = ensureOriginalStreamSettings("02");
  // ...ובינתיים הפאנל נבנה מחדש (רינדור רץ ברקע)
  ensureOriginalStreamSettings("02");
  ensureOriginalStreamSettings("02");
  // ...ורק אז הוא מסמן V
  heldByCheckbox.noteNumEnabled = false;
  const live = getStreamSettings()["02"];
  assert(live.noteNumEnabled === false, "הסימון הגיע לחנות",
    `got=${live.noteNumEnabled}`);
});

test("„מספר בראשי” — אותו מבחן בדיוק", () => {
  const heldByCheckbox = ensureOriginalStreamSettings("03");
  ensureOriginalStreamSettings("03");
  heldByCheckbox.mainRefEnabled = true;
  assert(getStreamSettings()["03"].mainRefEnabled === true, "הסימון הגיע לחנות");
  assert(getEffectiveStreamSettings("03").mainRefEnabled === true,
    "וגם ההגדרה בפועל רואה אותו");
});

test("בנייה מחדש אינה מוחקת ערך שכבר נשמר", () => {
  const s = ensureOriginalStreamSettings("04");
  s.noteNumPrefix = "(";
  ensureOriginalStreamSettings("04");
  ensureOriginalStreamSettings("04");
  assert(getStreamSettings()["04"].noteNumPrefix === "(", "הערך שרד שתי בניות");
});

test("זרם חדש מקבל את ברירות המחדל", () => {
  const s = ensureOriginalStreamSettings("07");
  assert(s && typeof s === "object", "קיים אובייקט");
  // „מספר בהערה” דלוק כברירת מחדל דרך היעדר ערך: הקוד בודק
  // `cur.noteNumEnabled !== false`, כלומר חסר = דלוק. זו התנהגות תקינה.
  assert(s.noteNumEnabled !== false, "„מספר בהערה” דלוק כברירת מחדל");
  assert(Object.keys(s).length > 3, "יש ברירות מחדל", `keys=${Object.keys(s).length}`);
});

test("שני זרמים אינם דורסים זה את זה", () => {
  const a = ensureOriginalStreamSettings("08");
  const b = ensureOriginalStreamSettings("09");
  a.noteNumBold = true;
  b.noteNumBold = false;
  assert(getStreamSettings()["08"].noteNumBold === true, "08 נשמר");
  assert(getStreamSettings()["09"].noteNumBold === false, "09 נשמר");
  assert(a !== b, "שני אובייקטים נפרדים");
});

console.log(`\nסה"כ: ${pass} עברו, ${fail} נכשלו`);
process.exit(fail > 0 ? 1 : 0);
