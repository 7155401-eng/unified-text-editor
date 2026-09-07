# -*- coding: utf-8 -*-
"""Note 2 + 3: "mark as stream" really moves the selection, and the add-note popup is wired in.

Before: clicking a stream button only painted the selected text with a coloured
badge (toggleStream). Measured on the live page: main text 20 chars before and
20 after, stream 01 5060 chars before and 5060 after - nothing moved anywhere,
which is exactly why the owner said "it does nothing".

After: when there is a real selection in the main pane, the selected text is
taken out of the main text and becomes a note in the chosen stream, and the
linking marker @NN is left behind in its place. The decision of WHERE the note
belongs stays on the server (add_note_to_stream). With no selection - or when
the caret sits inside a stream pane - the old marking behaviour is kept, so
nothing that worked before was taken away.
"""
import io, sys

sys.stdout.reconfigure(encoding="utf-8")

PATH = "src/main.js"

IMPORT_OLD = 'import "./stream_button_labels.js";\n'
IMPORT_NEW = (
    'import "./stream_button_labels.js";\n'
    'import { addNoteToStream, paneForCode } from "./stream_note_insert.js";\n'
    'import "./add_note_dialog.js";\n'
)

HANDLER_OLD = (
    'document.querySelectorAll(".btn-stream").forEach((btn) => {\n'
    '  btn.addEventListener("mousedown", (e) => e.preventDefault());\n'
    '  btn.addEventListener("click", () => {\n'
    '    activeChain()?.toggleStream(btn.dataset.stream).run();\n'
    '  });\n'
    '});\n'
)

HANDLER_NEW = (
    '// משה 07/09/2026 (הערה 2): "סמן בחירה כזרם" באמת מעביר את הקטע.\n'
    '//\n'
    '// עד היום הכפתור רק צבע את הטקסט הנבחר בצבע של הזרם. הטקסט נשאר בדיוק\n'
    '// במקומו, ולחלונית של הזרם לא נכנס כלום — ולכן זה נראה כאילו הלחיצה לא\n'
    '// עושה כלום. נמדד בדף החי לפני התיקון: הטקסט הראשי 20 תווים לפני ו-20\n'
    '// אחרי, וזרם 01 5060 תווים לפני ו-5060 אחרי.\n'
    '//\n'
    '// מעכשיו: אם יש קטע מסומן בחלונית הראשית — הקטע יוצא משם, נכנס כהערה\n'
    '// לחלונית של הזרם שנבחר, ובמקומו נשאר הסימן שמקשר ביניהם. אם אין קטע\n'
    '// מסומן, או שהסמן עומד בתוך חלונית של זרם, נשארת ההתנהגות הישנה של\n'
    '// צביעת הבחירה — לא לקחנו שום דבר שכבר עבד.\n'
    'function streamNameFor(code) {\n'
    '  const pane = paneForCode(code);\n'
    '  const label = String(pane?.label || "").trim();\n'
    '  return label || defaultLabelForCode(String(code).padStart(2, "0"));\n'
    '}\n'
    '\n'
    'async function markSelectionAsStream(code) {\n'
    '  const main = paneManager.getMainPane();\n'
    '  const active = paneManager.activePane;\n'
    '  const sel = main?.editor?.state?.selection;\n'
    '  const movable = !!main?.editor && (!active || active === main) && !!sel && !sel.empty;\n'
    '\n'
    '  if (!movable) {\n'
    '    activeChain()?.toggleStream(code).run();\n'
    '    return false;\n'
    '  }\n'
    '\n'
    '  const status = document.getElementById("status");\n'
    '  const text = main.editor.state.doc.textBetween(sel.from, sel.to, "\\n", "\\n");\n'
    '  const name = streamNameFor(code);\n'
    '\n'
    '  try {\n'
    '    const res = await addNoteToStream({ code, noteText: text, from: sel.from, to: sel.to });\n'
    '    if (status) {\n'
    '      status.textContent = res.inSync\n'
    '        ? `הקטע עבר ל${name} והפך להערה מספר ${res.ordinal} מתוך ${res.noteCount}. בטקסט הראשי נשאר הסימן @${res.code}.`\n'
    '        : `הקטע עבר ל${name} ונוסף בסוף (הערה ${res.ordinal} מתוך ${res.noteCount}), כי בזרם הזה יש יותר סימנים בטקסט הראשי מאשר הערות בחלונית.`;\n'
    '    }\n'
    '    return true;\n'
    '  } catch (err) {\n'
    '    console.warn("[mark-as-stream] failed", err);\n'
    '    if (status) status.textContent = `לא הצלחנו להעביר את הקטע ל${name}: ${err?.message || "שגיאה לא ידועה"}. הטקסט נשאר במקומו.`;\n'
    '    return false;\n'
    '  }\n'
    '}\n'
    '\n'
    'document.querySelectorAll(".btn-stream").forEach((btn) => {\n'
    '  btn.addEventListener("mousedown", (e) => e.preventDefault());\n'
    '  btn.addEventListener("click", () => {\n'
    '    markSelectionAsStream(btn.dataset.stream);\n'
    '  });\n'
    '});\n'
    '\n'
    '// חשיפה לבדיקות: מאפשר להריץ את אותה פעולה בדיוק בלי לחיצה עם עכבר.\n'
    'window.__ravtextMarkSelectionAsStream = markSelectionAsStream;\n'
)

CUSTOM_OLD = (
    '    activeChain()?.toggleStream(String(n).padStart(2, "0")).run();\n'
)
CUSTOM_NEW = (
    '    markSelectionAsStream(String(n).padStart(2, "0"));\n'
)


def patch(path, pairs):
    src = io.open(path, encoding="utf-8", newline="").read()
    crlf = "\r\n" in src
    if crlf:
        pairs = [(o.replace("\n", "\r\n"), n.replace("\n", "\r\n")) for o, n in pairs]
        print("file uses CRLF line endings - anchors converted")
    for old, new in pairs:
        n = src.count(old)
        assert n == 1, "anchor found {} times, expected 1:\n{}".format(n, old[:120])
        src = src.replace(old, new)
    io.open(path, "w", encoding="utf-8", newline="").write(src)
    print("patched", path)


patch(PATH, [(IMPORT_OLD, IMPORT_NEW), (HANDLER_OLD, HANDLER_NEW), (CUSTOM_OLD, CUSTOM_NEW)])
