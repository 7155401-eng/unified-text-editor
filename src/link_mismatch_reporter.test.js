// link_mismatch_reporter.test.js
// בדיקות יחידה למחשב אי־התאמות.
// הרצה: node src/link_mismatch_reporter.test.js

import { computeLinkMismatches } from "./link_mismatch_reporter.js";
import { setStreamLinks, _resetStreamLinksCache } from "./stream_links.js";

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

/* ------------------------------------------------------------------ */
/* משה 09/09/2026: „הערות להערות עדיין מחזיר שגיאה למרות שברמת הרעיון   */
/* הוגדרו הערות להערות.” הצילום הראה: 1156 הערות, 0 קישורים.           */
/* הסיבה: הסימנים של זרם מקונן יושבים בחלונית האב, והמאמת חיפש אותם    */
/* רק בראשי. כל הבדיקות כאן נופלות בגירסה הקודמת.                       */
/* ------------------------------------------------------------------ */

// חלונית זרם שגם מחזיקה הערות משלה וגם מארחת סימנים של זרם אחר.
function hostingStreamPane(streamCode, paneText, hostedCodes) {
  return {
    streamCode,
    label: `זרם ${streamCode}`,
    symbol: `@${streamCode}`,
    editor: {
      state: {
        doc: {
          textContent: paneText,
          descendants(cb) {
            for (const code of hostedCodes) {
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

test("הערות להערות — הסימנים בחלונית האב נספרים (הבאג של משה)", () => {
  _resetStreamLinksCache();
  setStreamLinks({ "05": ["01"] });
  const pm = makeManager([
    mainPane(["01"]),
    hostingStreamPane("01", "הערה של האב", ["05", "05"]),
    streamPane("05", "מקוננת אחת @05 מקוננת שתיים"),
  ]);
  const issues = computeLinkMismatches(pm);
  const five = issues.find((i) => i.streamCode === "05");
  assert(!five, "אין אי־התאמה בזרם המקונן", JSON.stringify(issues));
  _resetStreamLinksCache();
  setStreamLinks({});
});

test("הערות להערות — בגירסה שאינה מקוננת אותו מצב כן שגיאה", () => {
  _resetStreamLinksCache();
  setStreamLinks({});
  const pm = makeManager([
    mainPane(["01"]),
    hostingStreamPane("01", "הערה של האב", ["05", "05"]),
    streamPane("05", "מקוננת אחת @05 מקוננת שתיים"),
  ]);
  const issues = computeLinkMismatches(pm);
  const five = issues.find((i) => i.streamCode === "05");
  assert(!!five, "בלי קישור — כן מדווח");
  assert(five && five.markerCount === 0 && five.noteCount === 2, "0 מול 2");
});

test("הראשי תמיד נספר גם לזרם מקונן", () => {
  _resetStreamLinksCache();
  setStreamLinks({ "05": ["01"] });
  const pm = makeManager([
    mainPane(["05"]),
    hostingStreamPane("01", "הערה של האב", ["05"]),
    streamPane("05", "אחת @05 שתיים"),
  ]);
  const issues = computeLinkMismatches(pm);
  const five = issues.find((i) => i.streamCode === "05");
  assert(!five, "סימן בראשי + סימן באב = שתי הערות", JSON.stringify(issues));
  _resetStreamLinksCache();
  setStreamLinks({});
});

test("קישור לזרם שאין לו חלונית — נופל חזרה לראשי בלבד", () => {
  _resetStreamLinksCache();
  setStreamLinks({ "05": ["09"] });
  const pm = makeManager([
    mainPane(["05", "05"]),
    streamPane("05", "אחת @05 שתיים"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 0, "נספר מהראשי", JSON.stringify(issues));
  _resetStreamLinksCache();
  setStreamLinks({});
});

test("ההודעה אומרת איפה — שם האב החי, לא „בראשי” סתום", () => {
  _resetStreamLinksCache();
  setStreamLinks({ "05": ["01"] });
  const pm = makeManager([
    mainPane([]),
    hostingStreamPane("01", "הערה של האב", []),
    streamPane("05", "אחת @05 שתיים"),
  ]);
  const issues = computeLinkMismatches(pm);
  const five = issues.find((i) => i.streamCode === "05");
  assert(!!five, "יש אי־התאמה");
  assert(five && five.hostIsMain === false, "מסומן כלא-ראשי-בלבד");
  assert(five && Array.isArray(five.hostNames) && five.hostNames.length === 2,
    "שני מקומות", JSON.stringify(five && five.hostNames));
  assert(five && five.hostNames[1] === "זרם 01", "שם האב מופיע");
  _resetStreamLinksCache();
  setStreamLinks({});
});

test("זרם רגיל נשאר „בראשי בלבד”", () => {
  _resetStreamLinksCache();
  setStreamLinks({});
  const pm = makeManager([
    mainPane(["01"]),
    streamPane("01", "אחת @01 שתיים"),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 1 && issues[0].hostIsMain === true, "ראשי בלבד");
  assert(issues[0].hostNames.length === 1, "מקום אחד");
});

test("קישור עצמי — לא נספר פעמיים", () => {
  _resetStreamLinksCache();
  setStreamLinks({ "01": ["01"] });
  const pm = makeManager([
    mainPane(["01"]),
    hostingStreamPane("01", "אחת @01 שתיים", ["01"]),
  ]);
  const issues = computeLinkMismatches(pm);
  assert(issues.length === 1 && issues[0].markerCount === 1,
    "רק הסימן שבראשי", JSON.stringify(issues));
  _resetStreamLinksCache();
  setStreamLinks({});
});

test("יתום נספר גם כשהוא יושב בתוך חלונית זרם", () => {
  _resetStreamLinksCache();
  setStreamLinks({});
  const pm = makeManager([
    mainPane([]),
    hostingStreamPane("01", "הערה", ["07", "07"]),
  ]);
  const issues = computeLinkMismatches(pm);
  const orphan = issues.find((i) => i.streamCode === "07");
  assert(!!orphan && orphan.orphanedMarkers === true, "יתום נמצא");
  assert(orphan && orphan.markerCount === 2, "2 סימנים");
});

console.log(`\nסה"כ: ${pass} עברו, ${fail} נכשלו`);
process.exit(fail > 0 ? 1 : 0);
