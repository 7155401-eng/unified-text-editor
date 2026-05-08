// link_mismatch_reporter.test.js
// בדיקות יחידה למחשב אי־התאמות.
// הרצה: node src/link_mismatch_reporter.test.js

import { computeLinkMismatches } from "./link_mismatch_reporter.js";

let pass = 0, fail = 0;
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}
function test(name, fn) {
  console.log(name);
  try { fn(); } catch (e) { fail++; console.error(`  ✗ זריקת שגיאה: ${e.message}`); }
}

function mainPane(markerCodes) {
  return {
    streamCode: null,
    label: "ראשי",
    editor: {
      state: {
        doc: {
          descendants(cb) {
            for (const code of markerCodes) {
              cb({
                isText: true,
                nodeSize: 3,
                text: `@${code}`,
                marks: [{ type: { name: "streamMark" }, attrs: { streamCode: code, uid: Math.random(), symbol: `@${code}`, num: 1 } }],
              }, 0);
            }
          },
        },
      },
    },
  };
}

function streamPane(streamCode, paneText) {
  return {
    streamCode,
    label: `זרם ${streamCode}`,
    symbol: `@${streamCode}`,
    editor: {
      state: { doc: { textContent: paneText } },
    },
  };
}

function makeManager(panes) { return { panes }; }

test("התאמה מלאה — אין שגיאות", () => {
  const pm = makeManager([
    mainPane(["01", "01", "02"]),
    streamPane("01", "ראשונה @01 שנייה"),
    streamPane("02", "הערה אחת"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 0, "אין אי־התאמות", JSON.stringify(issues));
});

test("חסרות הערות — קישורים בראשי, מעט הערות", () => {
  const pm = makeManager([
    mainPane(["01", "01", "01"]),
    streamPane("01", "רק הערה אחת"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 1, "אי־התאמה אחת");
  assert(issues[0].streamCode === "01", "זרם נכון");
  assert(issues[0].markerCount === 3, "3 קישורים");
  assert(issues[0].noteCount === 1, "1 הערה");
});

test("עודף הערות — יותר הערות מקישורים", () => {
  const pm = makeManager([
    mainPane(["01"]),
    streamPane("01", "ראשונה @01 שנייה @01 שלישית"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 1, "אי־התאמה אחת");
  assert(issues[0].markerCount === 1, "1 קישור");
  assert(issues[0].noteCount === 3, "3 הערות");
});

test("קישור יתום — אין חלונית לזרם", () => {
  const pm = makeManager([
    mainPane(["01", "07"]),
    streamPane("01", "הערה אחת"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 1, "אי־התאמה אחת");
  assert(issues[0].streamCode === "07", "זרם 07 יתום");
  assert(issues[0].orphanedMarkers === true, "מסומן כיתום");
  assert(issues[0].markerCount === 1 && issues[0].noteCount === 0, "1/0");
});

test("חלונית ריקה — 0 הערות, 0 קישורים = תקין", () => {
  const pm = makeManager([
    mainPane([]),
    streamPane("01", ""),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 0, "ריק = תקין");
});

test("חלונית עם רק רווחים — נחשב כ‑0 הערות", () => {
  const pm = makeManager([
    mainPane(["01"]),
    streamPane("01", "    "),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 1, "אי־התאמה");
  assert(issues[0].markerCount === 1 && issues[0].noteCount === 0, "1/0");
});

test("חלונית פותחת בסמל — הריק הראשון נופל", () => {
  const pm = makeManager([
    mainPane(["01", "01"]),
    streamPane("01", "@01 ראשונה @01 שנייה"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 0, "התאמה — שני סמלים, שתי הערות (בלי הריק המקדים)");
});

test("שני זרמים מעורבים — אחד תקין אחד לא", () => {
  const pm = makeManager([
    mainPane(["01", "01", "02", "02", "02"]),
    streamPane("01", "ראשונה @01 שנייה"),
    streamPane("02", "רק שתיים @02 בלבד"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 1, "אי־התאמה אחת");
  assert(issues[0].streamCode === "02", "רק זרם 02");
  assert(issues[0].markerCount === 3 && issues[0].noteCount === 2, "3/2");
});

console.log(`\nסה"כ: ${pass} עברו, ${fail} נכשלו`);
process.exit(fail > 0 ? 1 : 0);
