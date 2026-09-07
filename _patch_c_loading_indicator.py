# -*- coding: utf-8 -*-
"""Task C: wire the loading indicator into the state the app already has.

Three small joins, no parallel system:

1. engine_bridge.js announces "a render has begun" with a real event. Until now
   the only sign was the word it wrote into #status, which nothing could listen
   to. The engine already announces every ENDING (ravtext:engine-rendered fires
   on success, on an empty document and from the catch block), so adding the
   start event completes the pair.

2. render_pause_controls.js already paints aria-busy on #btn-render - but only
   when the user CLICKED that button, so aria-busy was wrong for every render
   started any other way. Measured mid-render: aria-busy="false". It now listens
   to the same start event, so the existing state becomes correct instead of
   being duplicated. Its paint() still writes only on change (setAttr/setText).

3. main.js shows the pill while the app boots and takes it down when the初 load
   settles - on success AND on failure.
"""
import io, sys

sys.stdout.reconfigure(encoding="utf-8")


def patch(path, edits):
    src = io.open(path, encoding="utf-8", newline="").read()
    eol = "\r\n" if "\r\n" in src else "\n"
    for i, (old, new) in enumerate(edits, 1):
        o = old.replace("\n", eol)
        n = new.replace("\n", eol)
        c = src.count(o)
        assert c == 1, "{} anchor #{} appears {} times, expected 1: {!r}".format(path, i, c, old[:80])
        src = src.replace(o, n, 1)
        print("  {} edit {} ok".format(path, i))
    io.open(path, "w", encoding="utf-8", newline="").write(src)


# ---------------------------------------------------------------- 1. engine
patch("src/engine_bridge.js", [
    (
        "  _debounceTimer = setTimeout(() => {\n"
        "    _debounceTimer = null;\n"
        "    _renderToken++;\n"
        "    if (typeof window !== \"undefined\") window.__ravtextRenderCancelRequested = false;\n"
        "    const myToken = _renderToken;\n",

        "  _debounceTimer = setTimeout(() => {\n"
        "    _debounceTimer = null;\n"
        "    _renderToken++;\n"
        "    if (typeof window !== \"undefined\") window.__ravtextRenderCancelRequested = false;\n"
        "    // LOADING_INDICATOR_20260907: the engine already announces every ending\n"
        "    // (\"ravtext:engine-rendered\" fires on success, on an empty document and\n"
        "    // from the catch block). This is the matching beginning, so anything that\n"
        "    // wants to show \"working...\" can listen instead of guessing.\n"
        "    if (typeof window !== \"undefined\") {\n"
        "      window.dispatchEvent(new CustomEvent(\"ravtext:engine-render-start\", {\n"
        "        detail: { token: _renderToken },\n"
        "      }));\n"
        "    }\n"
        "    const myToken = _renderToken;\n",
    ),
])

# ------------------------------------------- 2. the existing render-running state
patch("src/render_pause_controls.js", [
    (
        "    window.addEventListener(\"ravtext:engine-rendered\", () => {\n",

        "    // LOADING_INDICATOR_20260907: until now state.running was set only by a\n"
        "    // click on the render button, so aria-busy on #btn-render read \"false\"\n"
        "    // during a render that started any other way (measured). The engine's own\n"
        "    // start event is the truth, so the button follows it.\n"
        "    window.addEventListener(\"ravtext:engine-render-start\", () => {\n"
        "      if (state.running) return;\n"
        "      snapshotPreview();\n"
        "      state.running = true;\n"
        "      paint();\n"
        "    });\n"
        "    window.addEventListener(\"ravtext:engine-render-cancelled\", () => {\n"
        "      if (!state.running) return;\n"
        "      state.running = false;\n"
        "      paint();\n"
        "    });\n"
        "    window.addEventListener(\"ravtext:engine-rendered\", () => {\n",
    ),
])

# ------------------------------------------------------------- 3. start-up
patch("src/main.js", [
    (
        "import { setupStreamPicker } from \"./stream_picker.js\";\n",

        "import { setupStreamPicker } from \"./stream_picker.js\";\n"
        "import { installLoadingIndicator, setStartupLoading } from \"./loading_indicator.js\";\n",
    ),
    (
        "const container = document.querySelector(\"#panes-container\");\n"
        "const paneManager = new PaneManager(container);\n",

        "// LOADING_INDICATOR_20260907: the pill goes up before anything slow starts,\n"
        "// so the very first thing the user sees is a sign of life, not a blank page.\n"
        "installLoadingIndicator();\n"
        "setStartupLoading(true);\n"
        "\n"
        "const container = document.querySelector(\"#panes-container\");\n"
        "const paneManager = new PaneManager(container);\n",
    ),
    (
        "let initialLoadPromise = Promise.resolve();\n",

        "let initialLoadPromise = Promise.resolve();\n"
        "// LOADING_INDICATOR_20260907: down on success AND on failure. A spinner that\n"
        "// can get stuck is worse than no spinner, so this is the single place that\n"
        "// ends the start-up phase, whatever happened.\n"
        "queueMicrotask(() => {\n"
        "  Promise.resolve(initialLoadPromise)\n"
        "    .catch(() => {})\n"
        "    .finally(() => setStartupLoading(false));\n"
        "  setTimeout(() => setStartupLoading(false), 30000);\n"
        "});\n",
    ),
])

print("done")
