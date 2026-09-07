# -*- coding: utf-8 -*-
"""Task B, second erasure path: the pause/stop controls restore an EMPTY snapshot.

render_pause_controls.js photographs the pages container the moment the render
button is clicked - that is, BEFORE the render has drawn anything:

    render.addEventListener("click", () => { ... snapshotPreview(); ... }, true)

Auto-render is now off by default, so a cold start leaves the container empty
(measured: 0 pages on a cold start). The user's first click on the render button
therefore photographs an EMPTY screen. From then on:

    stopRender()                       -> restorePreview()   -> innerHTML = ""
    "ravtext:engine-rendered" while
    the 15s stop-guard is active       -> restorePreview()   -> innerHTML = ""

so pressing stop wipes the finished render, and with auto-render off nothing ever
draws it back. That is exactly "turning rendering off erased the whole render".

Fix: a snapshot is only worth keeping if it has real pages in it, and a restore
may never replace real pages with fewer of them.
"""
import io, sys

sys.stdout.reconfigure(encoding="utf-8")

PATH = "src/render_pause_controls.js"

EDITS = [
    (
        "  function snapshotPreview() {\n"
        "    const el = pages();\n"
        "    if (!el) return;\n"
        "    state.snapshotHtml = el.innerHTML;\n"
        "    state.snapshotScrollTop = el.scrollTop || 0;\n"
        "  }\n"
        "\n"
        "  function restorePreview() {\n"
        "    const el = pages();\n"
        "    if (!el || state.snapshotHtml == null) return;\n"
        "    el.innerHTML = state.snapshotHtml;\n"
        "    el.scrollTop = state.snapshotScrollTop || 0;\n"
        "  }\n",

        "  // KEEP_LAST_RENDER_20260907\n"
        "  // The photograph is taken when the render button is pressed, i.e. before\n"
        "  // the new render exists. On a cold start with auto-render off the screen\n"
        "  // is empty, so the photograph was of nothing - and every later \"stop\"\n"
        "  // pasted that nothing over a finished render. A photograph is only kept\n"
        "  // when it actually holds pages, and it is never pasted over more pages\n"
        "  // than it contains.\n"
        "  function realPages(el) {\n"
        "    if (!el || typeof el.querySelectorAll !== \"function\") return 0;\n"
        "    return el.querySelectorAll(\".page:not(.page-placeholder)\").length;\n"
        "  }\n"
        "\n"
        "  function snapshotPreview() {\n"
        "    const el = pages();\n"
        "    if (!el) return;\n"
        "    const count = realPages(el);\n"
        "    if (count <= 0) return;\n"
        "    state.snapshotHtml = el.innerHTML;\n"
        "    state.snapshotScrollTop = el.scrollTop || 0;\n"
        "    state.snapshotPages = count;\n"
        "  }\n"
        "\n"
        "  function restorePreview() {\n"
        "    const el = pages();\n"
        "    if (!el || state.snapshotHtml == null) return;\n"
        "    if ((state.snapshotPages || 0) <= 0) return;\n"
        "    if (realPages(el) >= (state.snapshotPages || 0)) return;\n"
        "    el.innerHTML = state.snapshotHtml;\n"
        "    el.scrollTop = state.snapshotScrollTop || 0;\n"
        "  }\n",
    ),
    (
        "    snapshotHtml: null,\n"
        "    snapshotScrollTop: 0,\n",

        "    snapshotHtml: null,\n"
        "    snapshotScrollTop: 0,\n"
        "    snapshotPages: 0,\n",
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
