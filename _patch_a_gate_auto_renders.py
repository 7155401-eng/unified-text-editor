# -*- coding: utf-8 -*-
"""Task A: every render that the user did not ask for goes through the gate.

Audit finding (measured in the browser, not guessed): with auto-render switched
off, a cold start still produced a full render. The stack was

    scheduleEngineRender  <- rerenderPages  <- talmud_controls.commit
    <- HTMLInputElement change  <- stream_picker.setSelected

stream_picker fills the two default gemara streams 1.5s after load and fires a
synthetic "change" event on the hidden input. talmud_controls hears that change,
cannot tell it apart from the user turning a knob, and renders.

So the gate cannot live only at the 24 literal rerenderPages() call sites. It
needs three helpers:

  rerenderPages()          - the user pressed something. Always draws.
  autoRerenderPages()      - nobody pressed anything (startup, guard, observer).
                             Draws only when auto-render is on.
  settingRerenderPages()   - a setting changed. If a real finger/keyboard caused
                             it, draw now; if the event was synthesised by our
                             own start-up code, fall back to the auto gate.

"a real finger" is decided by ev.isTrusted on the last user event, which a
synthetic dispatchEvent can never set.

Moshe also asked that auto-render fire "only if there are changes". The pane
change handler therefore hashes the text of every pane and skips the render when
the hash is the same as the one that was last drawn.
"""
import io, sys

sys.stdout.reconfigure(encoding="utf-8")

PATH = "src/main.js"

EDITS = [
    # ---------------------------------------------------------------- helpers
    (
        "function shouldLiveRenderNow() {\n"
        "  return isLiveRenderEnabled() && paneManagerDocSize() <= LIVE_RENDER_MAX_DOC_SIZE;\n"
        "}\n",

        "function shouldLiveRenderNow() {\n"
        "  return isLiveRenderEnabled() && paneManagerDocSize() <= LIVE_RENDER_MAX_DOC_SIZE;\n"
        "}\n"
        "\n"
        "// AUTO_RENDER_GATE_20260907\n"
        "// משה 07/09/2026: רינדור שהמשתמש לא ביקש רץ רק אם \"רינדור אוטומטי\" דלוק.\n"
        "// איך יודעים אם המשתמש ביקש? רק אירוע שנוצר מאצבע או ממקלדת אמיתית מקבל\n"
        "// isTrusted=true. אירוע שהקוד שלנו יצר בעצמו (dispatchEvent) לעולם לא יקבל\n"
        "// אותו, ולכן אי אפשר לזייף בקשה של משתמש.\n"
        "let _lastTrustedUserEventAt = 0;\n"
        "const USER_GESTURE_WINDOW_MS = 4000;\n"
        "if (typeof window !== \"undefined\") {\n"
        "  const markUser = (ev) => { if (ev && ev.isTrusted) _lastTrustedUserEventAt = Date.now(); };\n"
        "  for (const type of [\"pointerdown\", \"mousedown\", \"keydown\", \"click\", \"change\", \"input\", \"touchstart\", \"wheel\"]) {\n"
        "    window.addEventListener(type, markUser, { capture: true, passive: true });\n"
        "  }\n"
        "}\n"
        "function userAskedForThis() {\n"
        "  return Date.now() - _lastTrustedUserEventAt <= USER_GESTURE_WINDOW_MS;\n"
        "}\n"
        "\n"
        "// רינדור אוטומטי: טעינה, שומר, טיימר, משקיף. עובר רק דרך השער.\n"
        "function autoRerenderPages() {\n"
        "  if (!shouldLiveRenderNow()) return false;\n"
        "  rerenderPages();\n"
        "  return true;\n"
        "}\n"
        "\n"
        "// שינוי הגדרה: אם אצבע אמיתית שינתה אותה — מציירים מיד, כי זה בדיוק מה\n"
        "// שהמשתמש מצפה לראות. אם קוד האתחול שלנו \"שינה\" אותה — זה רינדור\n"
        "// אוטומטי בתחפושת, ולכן הוא עובר דרך אותו שער.\n"
        "function settingRerenderPages() {\n"
        "  if (userAskedForThis()) {\n"
        "    rerenderPages();\n"
        "    return true;\n"
        "  }\n"
        "  return autoRerenderPages();\n"
        "}\n"
        "\n"
        "// \"רק אם באמת היה שינוי\" — חתימה קצרה של הטקסט בכל החלוניות.\n"
        "// FNV-1a, ריצה אחת על מסמך שממילא מוגבל ל-60,000 תווים בנתיב האוטומטי.\n"
        "let _lastRenderedSignature = null;\n"
        "function paneContentSignature() {\n"
        "  try {\n"
        "    let h = 0x811c9dc5;\n"
        "    for (const p of paneManager.panes) {\n"
        "      const text = p.editor?.state?.doc?.textContent || \"\";\n"
        "      const head = (p.streamCode || \"-\") + \"\\u0000\" + text.length + \"\\u0000\";\n"
        "      for (let i = 0; i < head.length; i++) { h ^= head.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }\n"
        "      for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }\n"
        "    }\n"
        "    return h >>> 0;\n"
        "  } catch (_) {\n"
        "    return null;\n"
        "  }\n"
        "}\n",
    ),

    # -------------------------------------------- (b) final layout guard hook
    (
        "    try {\n"
        "      if (typeof rerenderPages === \"function\") rerenderPages();\n"
        "      else if (typeof window.__ravtextRerender === \"function\") window.__ravtextRerender();\n",

        "    try {\n"
        "      // AUTO_RENDER_GATE_20260907: שומר-הפריסה הוא משקיף, לא בקשה של משתמש.\n"
        "      if (typeof autoRerenderPages === \"function\") autoRerenderPages();\n"
        "      else if (typeof window.__ravtextAutoRerender === \"function\") window.__ravtextAutoRerender();\n",
    ),

    # ------------------------------------------------- (a-if-real) typography
    (
        "  if (rerender) rerenderPages();\n",
        "  if (rerender) settingRerenderPages();\n",
    ),

    # ------------------------------------------- (a-if-real) other-as-mishna
    (
        "    // Trigger a re-render so the change takes effect immediately.\n"
        "    if (typeof rerenderPages === \"function\") rerenderPages();\n",

        "    // Trigger a re-render so the change takes effect immediately.\n"
        "    // AUTO_RENDER_GATE_20260907: רק אם המשתמש באמת סימן את התיבה.\n"
        "    if (typeof settingRerenderPages === \"function\") settingRerenderPages();\n",
    ),

    # ------------------------------------------------ (a-if-real) page setup
    (
        "  applyPageSettings(pagesContainer);\n"
        "  rerenderPages();\n"
        "});\n",

        "  applyPageSettings(pagesContainer);\n"
        "  settingRerenderPages();\n"
        "});\n",
    ),

    # ---------------------------------- (b) document change: gate + \"changed?\"
    (
        "  refreshStreamSettingsPanel();\n"
        "  if (shouldLiveRenderNow()) rerenderPages();\n"
        "  updateNestedNotesHint();\n",

        "  refreshStreamSettingsPanel();\n"
        "  // AUTO_RENDER_GATE_20260907: רק אם השער פתוח וגם הטקסט באמת השתנה.\n"
        "  if (shouldLiveRenderNow()) {\n"
        "    const sig = paneContentSignature();\n"
        "    if (sig === null || sig !== _lastRenderedSignature) {\n"
        "      _lastRenderedSignature = sig;\n"
        "      rerenderPages();\n"
        "    }\n"
        "  }\n"
        "  updateNestedNotesHint();\n",
    ),

    # ------------------ (b) settings modules that our own startup can trigger
    (
        "wireTalmudLayoutControls(rerenderPages);\n"
        "wireMishnaWrapToggle(rerenderPages);\n"
        "wireOpeningWordControls(rerenderPages);\n",

        "// AUTO_RENDER_GATE_20260907: אלה שלושת המקומות שבהם הרינדור התחיל לבד.\n"
        "// stream_picker ממלא שני זרמים ברירת-מחדל 1.5 שניות אחרי הטעינה ומשגר\n"
        "// אירוע \"change\" מלאכותי; talmud_controls שמע אותו וריצה רינדור מלא.\n"
        "wireTalmudLayoutControls(settingRerenderPages);\n"
        "wireMishnaWrapToggle(settingRerenderPages);\n"
        "wireOpeningWordControls(settingRerenderPages);\n",
    ),

    # -------------------------------- expose the gated entry point to modules
    (
        "if (typeof window !== \"undefined\") {\n"
        "  window.__ravtextRerender = rerenderPages;\n"
        "}\n",

        "if (typeof window !== \"undefined\") {\n"
        "  window.__ravtextRerender = rerenderPages;\n"
        "  // AUTO_RENDER_GATE_20260907: נקודת כניסה לרינדור שאיש לא ביקש —\n"
        "  // מודולים שרצים על טיימר או על טעינה קוראים לזה, לא ל-__ravtextRerender.\n"
        "  window.__ravtextAutoRerender = autoRerenderPages;\n"
        "  window.__ravtextRenderGateStatus = () => ({\n"
        "    liveRenderEnabled: isLiveRenderEnabled(),\n"
        "    shouldRenderNow: shouldLiveRenderNow(),\n"
        "    userAskedRecently: userAskedForThis(),\n"
        "  });\n"
        "}\n",
    ),
]


def main():
    src = io.open(PATH, encoding="utf-8", newline="").read()
    # The repo keeps this file in CRLF. Anchors are written with plain \n above,
    # so translate them to whatever the file really uses - byte for byte.
    eol = "\r\n" if "\r\n" in src else "\n"
    print("line ending:", repr(eol))
    for i, (old, new) in enumerate(EDITS, 1):
        old = old.replace("\n", eol)
        new = new.replace("\n", eol)
        n = src.count(old)
        assert n == 1, "anchor #{} appears {} times, expected exactly 1:\n{!r}".format(i, n, old[:90])
        src = src.replace(old, new, 1)
        print("  edit {} ok".format(i))
    io.open(PATH, "w", encoding="utf-8", newline="").write(src)
    print("patched", PATH)


main()
