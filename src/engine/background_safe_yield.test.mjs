// background_safe_yield.test.mjs
// משה 09/09/2026: „כשהחלון לא עליון הרינדור נעצר, תקן את זה.”
//
// הרצה: node src/engine/background_safe_yield.test.mjs

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

// מדמים דפדפן שבו המנגנונים הקשורים לציור **לעולם אינם יורים** —
// בדיוק מה שקורה כשהחלון יורד לרקע.
let rafCalls = 0, ricCalls = 0;
globalThis.requestAnimationFrame = () => { rafCalls += 1; /* לעולם לא קורא */ };
globalThis.requestIdleCallback = () => { ricCalls += 1; /* לעולם לא קורא */ };

let visibility = "hidden";
globalThis.document = { get visibilityState() { return visibility; } };

const { yieldToBrowser, afterPaint } = await import("./background_safe_yield.js");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} לא חזר תוך ${ms}ms`)), ms)),
  ]);
}

console.log("חלון ברקע — הנשימה חייבת להמשיך");
try {
  visibility = "hidden";
  await withTimeout(yieldToBrowser(), 1500, "yieldToBrowser");
  assert(true, "yieldToBrowser חזר למרות שהציור מוקפא");
} catch (e) {
  assert(false, "yieldToBrowser חזר למרות שהציור מוקפא", e.message);
}

try {
  visibility = "hidden";
  await withTimeout(new Promise((r) => afterPaint(r)), 1500, "afterPaint");
  assert(true, "afterPaint רץ למרות שהציור מוקפא");
} catch (e) {
  assert(false, "afterPaint רץ למרות שהציור מוקפא", e.message);
}

console.log("ברקע לא נוגעים כלל במנגנוני הציור");
assert(rafCalls === 0, "requestAnimationFrame לא נקרא ברקע", `calls=${rafCalls}`);
assert(ricCalls === 0, "requestIdleCallback לא נקרא ברקע", `calls=${ricCalls}`);

console.log("חלון עליון — חוזרים למנגנונים המקוריים");
visibility = "visible";
rafCalls = 0; ricCalls = 0;
yieldToBrowser();
afterPaint(() => {});
await new Promise((r) => setTimeout(r, 30));
assert(ricCalls === 1, "בחלון עליון משתמשים ב-requestIdleCallback", `calls=${ricCalls}`);
assert(rafCalls === 1, "בחלון עליון משתמשים ב-requestAnimationFrame", `calls=${rafCalls}`);

console.log("עומס — מאה נשימות ברצף ברקע");
visibility = "hidden";
try {
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) await withTimeout(yieldToBrowser(), 2000, `נשימה ${i}`);
  const ms = Date.now() - t0;
  assert(true, `מאה נשימות הושלמו ב-${ms}ms`);
  assert(ms < 2000, "ובלי חניקה של שנייה לכל נשימה", `${ms}ms`);
} catch (e) {
  assert(false, "מאה נשימות ברצף", e.message);
}

console.log("קלט פסול אינו מפיל כלום");
afterPaint(null);
afterPaint(undefined);
assert(true, "afterPaint עם ערך ריק לא זרק שגיאה");

console.log(`\nסה"כ: ${pass} עברו, ${fail} נכשלו`);
process.exit(fail > 0 ? 1 : 0);
