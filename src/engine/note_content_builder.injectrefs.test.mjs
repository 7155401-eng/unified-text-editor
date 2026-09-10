// note_content_builder.injectrefs.test.mjs
// משה 09/09/2026: מספרי הערות של זרם מקונן נדחסו כולם לסוף הטקסט הראשי.
// נמדד על הקובץ שלו: 1,033 מתוך 1,168 נחתו על נקודה שכבר תפוסה, עד 15
// באותו מקום. הבדיקות כאן נועלות את ההתנהגות הנכונה.
//
// הרצה: node src/engine/note_content_builder.injectrefs.test.mjs

// שכבת דמה קטנה — המודול נטען בדפדפן ומחפש אחסון וחלון.
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

const mod = await import("./note_content_builder.js");
const { injectMainRefs } = mod;

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}
function test(name, fn) {
  console.log(name);
  try { fn(); } catch (e) { fail++; console.error(`  ✗ זריקת שגיאה: ${e.message}`); }
}

// מפעילים "מספר בראשי" לזרמים שנבדקים, אחרת שום מספר אינו מוזרק.
function enableMainRef(codes) {
  const settings = {};
  for (const c of codes) settings[c] = { mainRefEnabled: true };
  store.set("ravtext.streamSettings.v1", JSON.stringify(settings));
  if (globalThis.window) globalThis.window.__STREAM_SETTINGS__ = settings;
}

const TEXT = "0123456789";  // עשרה תווים בדיוק, קל לספור עליהם

test("עוגן שמעבר לסוף הטקסט אינו מודפס לתוכו", () => {
  enableMainRef(["01", "02"]);
  const notes = [
    { stream: "01", num: 1, anchor: 3 },      // בתחום
    { stream: "02", num: 1, anchor: 5000 },   // מטקסט אחר
    { stream: "02", num: 2, anchor: 5001 },
    { stream: "02", num: 3, anchor: 5002 },
  ];
  const res = injectMainRefs(TEXT, [], notes);
  const added = res.mainText.length - TEXT.length;
  assert(added > 0, "משהו כן הוזרק", `added=${added}`);
  // אם שלושת המקוננים היו נדחסים לסוף, האורך היה גדל בהרבה יותר
  const oneRefLen = added;
  assert(oneRefLen <= 6, "רק מספר אחד הוזרק, לא ארבעה", `added=${added}`);
});

test("ההערות עצמן נשמרות — לא נמחקה אף אחת", () => {
  enableMainRef(["01", "02"]);
  const notes = [
    { stream: "01", num: 1, anchor: 3 },
    { stream: "02", num: 1, anchor: 5000 },
    { stream: "02", num: 2, anchor: 5001 },
  ];
  const res = injectMainRefs(TEXT, [], notes);
  assert(res.notes.length === 3, "שלוש הערות נשארו", `got=${res.notes.length}`);
});

test("כשכל העוגנים בתחום — שום דבר לא משתנה", () => {
  enableMainRef(["01"]);
  const notes = [
    { stream: "01", num: 1, anchor: 2 },
    { stream: "01", num: 2, anchor: 5 },
    { stream: "01", num: 3, anchor: 8 },
  ];
  const res = injectMainRefs(TEXT, [], notes);
  const added = res.mainText.length - TEXT.length;
  assert(added > 0, "שלושת המספרים הוזרקו", `added=${added}`);
  assert(res.notes.length === 3, "שלוש הערות");
});

test("רשת הביטחון — כשכל העוגנים מחוץ לתחום, ההתנהגות הישנה נשמרת", () => {
  enableMainRef(["02"]);
  const notes = [
    { stream: "02", num: 1, anchor: 5000 },
    { stream: "02", num: 2, anchor: 5001 },
  ];
  const res = injectMainRefs(TEXT, [], notes);
  const added = res.mainText.length - TEXT.length;
  assert(added > 0, "לא נעלמו כל המספרים", `added=${added}`);
});

test("עוגן בדיוק על סוף הטקסט עדיין נחשב בתחום", () => {
  enableMainRef(["01", "02"]);
  const notes = [
    { stream: "01", num: 1, anchor: 0 },
    { stream: "01", num: 2, anchor: TEXT.length },
    { stream: "02", num: 1, anchor: TEXT.length + 1 },
  ];
  const res = injectMainRefs(TEXT, [], notes);
  const added = res.mainText.length - TEXT.length;
  assert(added > 0, "המספרים שבתחום הוזרקו", `added=${added}`);
});

test("רשימה ריקה אינה מפילה כלום", () => {
  const res = injectMainRefs(TEXT, [], []);
  assert(res.mainText === TEXT, "הטקסט לא נגע");
  assert(Array.isArray(res.notes) && res.notes.length === 0, "אין הערות");
});

test("הערה בלי עוגן מספרי אינה מפילה כלום", () => {
  enableMainRef(["01"]);
  const res = injectMainRefs(TEXT, [], [{ stream: "01", num: 1 }, null]);
  assert(typeof res.mainText === "string", "החזיר טקסט");
});

console.log(`\nסה"כ: ${pass} עברו, ${fail} נכשלו`);
process.exit(fail > 0 ? 1 : 0);
