# -*- coding: utf-8 -*-
"""Task B: an aborted render must never leave the screen blank.

Root cause, read straight out of the code and confirmed with a stack trace
captured in the browser:

    renderPages()  (src/engine/renderer.js:793)   ->   container.innerHTML = ""

The previous, perfectly good render is destroyed at the START of drawing the new
one. Everything after that point in _runRender is a chance to bail out:

    engine_bridge.js:1281 / 1286 / 1289   if (!isRenderCurrent(myToken)) return;
    engine_bridge.js catch(err)           innerHTML = "<div class=error-hint>"
    engine_bridge.js content.length === 0 innerHTML = "<div class=empty-hint>"

Every one of those leaves an empty container. cancelEngineRender() even prints a
status line promising that the previous view was kept - the code never kept it.
And since commit 6ef95d3 makes a new request invalidate the running render
immediately, those bail-outs now fire far more often.

Fix: engine_bridge remembers the last drawing that actually had pages, and puts
it back on any path that would otherwise leave the container without a single
real page. Only a render that finishes replaces what is on screen.

The patch adds no Hebrew text of its own - the existing status messages are left
exactly as they are.
"""
import io, sys

sys.stdout.reconfigure(encoding="utf-8")

PATH = "src/engine_bridge.js"

HELPERS = (
    "// KEEP_LAST_RENDER_20260907\n"
    "// A render that is cancelled, superseded or that throws must not take the\n"
    "// previous picture down with it. renderPages() empties the container before\n"
    "// it draws, so from that moment until the new pages exist the screen is bare.\n"
    "// We keep one copy of the last drawing that really had pages and put it back\n"
    "// on every bail-out path. Only a finished render replaces what the user sees.\n"
    "let _lastGoodRenderHtml = null;\n"
    "let _lastGoodRenderScrollTop = 0;\n"
    "let _lastGoodRenderPages = 0;\n"
    "\n"
    "function realPageCount(container) {\n"
    "  if (!container || typeof container.querySelectorAll !== \"function\") return 0;\n"
    "  return container.querySelectorAll(\".page:not(.page-placeholder)\").length;\n"
    "}\n"
    "\n"
    "function resolvePagesContainer(container) {\n"
    "  if (container) return container;\n"
    "  if (typeof document === \"undefined\") return null;\n"
    "  return document.getElementById(\"pages-container\") || document.querySelector(\".pages-container\");\n"
    "}\n"
    "\n"
    "function rememberLastGoodRender(container) {\n"
    "  const el = resolvePagesContainer(container);\n"
    "  const n = realPageCount(el);\n"
    "  if (n <= 0) return false;\n"
    "  _lastGoodRenderHtml = el.innerHTML;\n"
    "  _lastGoodRenderScrollTop = el.scrollTop || 0;\n"
    "  _lastGoodRenderPages = n;\n"
    "  return true;\n"
    "}\n"
    "\n"
    "// Returns true when it actually put the previous drawing back, so callers can\n"
    "// skip the \"nothing here\" placeholder they were about to paint.\n"
    "function restoreLastGoodRender(container, reason) {\n"
    "  const el = resolvePagesContainer(container);\n"
    "  if (!el) return false;\n"
    "  if (_lastGoodRenderHtml == null || _lastGoodRenderPages <= 0) return false;\n"
    "  if (realPageCount(el) > 0) return false;\n"
    "  el.innerHTML = _lastGoodRenderHtml;\n"
    "  el.scrollTop = _lastGoodRenderScrollTop;\n"
    "  if (typeof window !== \"undefined\") {\n"
    "    window.dispatchEvent(new CustomEvent(\"ravtext:engine-render-kept\", {\n"
    "      detail: { reason: reason || \"aborted\", pages: _lastGoodRenderPages },\n"
    "    }));\n"
    "  }\n"
    "  return true;\n"
    "}\n"
    "\n"
    "if (typeof window !== \"undefined\") {\n"
    "  window.__ravtextLastGoodRenderInfo = () => ({\n"
    "    hasSnapshot: _lastGoodRenderHtml != null,\n"
    "    snapshotPages: _lastGoodRenderPages,\n"
    "  });\n"
    "}\n"
    "\n"
)

EDITS = [
    # 1. helpers + remember the current drawing before anything can clear it
    (
        "async function _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, skipSmartTune = false) {\n"
        "  try {\n"
        "    if (typeof window !== \"undefined\") window.__ravtextRenderCancelRequested = false;\n",

        HELPERS +
        "async function _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, skipSmartTune = false) {\n"
        "  try {\n"
        "    if (typeof window !== \"undefined\") window.__ravtextRenderCancelRequested = false;\n"
        "    // KEEP_LAST_RENDER_20260907: photograph the screen before we touch it.\n"
        "    rememberLastGoodRender(pagesContainer);\n",
    ),

    # 2. empty document: keep the previous drawing instead of wiping it
    (
        "    if (content.length === 0) {\n",

        "    if (content.length === 0) {\n"
        "      // KEEP_LAST_RENDER_20260907: an empty editor does not erase the last\n"
        "      // render. The placeholder below is only for a screen with nothing on it.\n"
        "      if (restoreLastGoodRender(pagesContainer, \"empty-content\")) {\n"
        "        window.dispatchEvent(new CustomEvent(\"ravtext:engine-rendered\", {\n"
        "          detail: { pages: [], content: [], keptPrevious: true },\n"
        "        }));\n"
        "        return;\n"
        "      }\n",
    ),

    # 3-5. the three bail-outs that sit AFTER renderPages() emptied the container
    (
        "    await firePackerHook(\"beforeBuild\", { container: pagesContainer, pages });\n"
        "    if (!isRenderCurrent(myToken)) return;\n",

        "    await firePackerHook(\"beforeBuild\", { container: pagesContainer, pages });\n"
        "    if (!isRenderCurrent(myToken)) { restoreLastGoodRender(pagesContainer, \"superseded\"); return; }\n",
    ),
    (
        "    await applyMishnaWrapToPages(pagesContainer);\n"
        "    if (!isRenderCurrent(myToken)) return;\n",

        "    await applyMishnaWrapToPages(pagesContainer);\n"
        "    if (!isRenderCurrent(myToken)) { restoreLastGoodRender(pagesContainer, \"superseded\"); return; }\n",
    ),
    (
        "    await applyBalancedColumnsToPages(pagesContainer);\n"
        "    if (!isRenderCurrent(myToken)) return;\n",

        "    await applyBalancedColumnsToPages(pagesContainer);\n"
        "    if (!isRenderCurrent(myToken)) { restoreLastGoodRender(pagesContainer, \"superseded\"); return; }\n",
    ),

    # 6. a render that throws keeps the last good drawing; the message goes to #status
    (
        "\n    pagesContainer.innerHTML = `<div class=\"error-hint\">",

        "\n    // KEEP_LAST_RENDER_20260907: a failed render explains itself in #status,\n"
        "    // it does not delete the drawing the user already had.\n"
        "    const keptPreviousAfterError = restoreLastGoodRender(pagesContainer, \"render-error\");\n"
        "    if (!keptPreviousAfterError) pagesContainer.innerHTML = `<div class=\"error-hint\">",
    ),
    (
        "    if (pdfToolbarApi) pdfToolbarApi.setTotal(0);\n"
        "    window.dispatchEvent(new CustomEvent(\"ravtext:engine-rendered\", {\n"
        "      detail: { pages: [], content: [], error:",

        "    if (pdfToolbarApi && !keptPreviousAfterError) pdfToolbarApi.setTotal(0);\n"
        "    window.dispatchEvent(new CustomEvent(\"ravtext:engine-rendered\", {\n"
        "      detail: { pages: [], content: [], keptPrevious: keptPreviousAfterError, error:",
    ),

    # 7. make cancelEngineRender's promise true
    (
        "export function cancelEngineRender(reason = \"user\") {\n"
        "  if (typeof window !== \"undefined\") window.__ravtextRenderCancelRequested = true;\n",

        "export function cancelEngineRender(reason = \"user\") {\n"
        "  if (typeof window !== \"undefined\") window.__ravtextRenderCancelRequested = true;\n"
        "  // KEEP_LAST_RENDER_20260907: the status line below promises the previous\n"
        "  // view was kept. This is the line that actually keeps it.\n"
        "  restoreLastGoodRender(null, \"cancelled\");\n"
        "  setTimeout(() => restoreLastGoodRender(null, \"cancelled-late\"), 60);\n",
    ),
]


def main():
    src = io.open(PATH, encoding="utf-8", newline="").read()
    eol = "\r\n" if "\r\n" in src else "\n"
    print("line ending:", repr(eol))
    for i, (old, new) in enumerate(EDITS, 1):
        o = old.replace("\n", eol)
        n = new.replace("\n", eol)
        c = src.count(o)
        assert c == 1, "anchor #{} appears {} times, expected 1: {!r}".format(i, c, old[:80])
        src = src.replace(o, n, 1)
        print("  edit {} ok".format(i))
    io.open(PATH, "w", encoding="utf-8", newline="").write(src)
    print("patched", PATH)


main()
