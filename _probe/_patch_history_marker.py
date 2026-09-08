# -*- coding: utf-8 -*-
"""Replace the fragile lazy import of @tiptap/pm/history with the plain
transaction marker, which needs no dependency at all.

Why: @tiptap/pm is only a PEER dependency here, and vite had not pre-bundled
@tiptap/pm/history, so the dynamic import failed at runtime and closeHistory was
silently never applied (measured: historyHelperReady=false, undo overshot).

prosemirror-history reads the marker with tr.getMeta(closeHistoryKey), and
Transaction.getMeta() looks the key up by its STRING form. prosemirror-state's
createKey() gives the first (and only) PluginKey named "closeHistory" the
string "closeHistory$". So setting that meta by name is exactly what
closeHistory(tr) does - with no import, and with no way to break the app if the
package is ever missing (an unrecognised meta key is simply ignored).
"""
import io, sys

SCOPE = r"C:\Users\User\rt_work\findreplace\src\find_replace_scope.js"
FR = r"C:\Users\User\rt_work\findreplace\src\find_replace.js"
NL = chr(13) + chr(10)

def once(s, anchor, what):
    n = s.count(anchor)
    if n != 1:
        sys.exit("ABORT: anchor %s appears %d times (want 1)" % (what, n))

# ------------------------------------------------------- find_replace_scope.js
s = io.open(SCOPE, encoding="utf-8").read()
before = len(s)

OLD_BLOCK = (
    "let closeHistoryFn = null;\n"
    "let historyPrimed = false;\n"
    "\n"
    "export function primeHistoryHelper() {\n"
    "  if (historyPrimed) return Promise.resolve(!!closeHistoryFn);\n"
    "  historyPrimed = true;\n"
    '  return import("@tiptap/pm/history")\n'
    '    .then((m) => { if (typeof m?.closeHistory === "function") closeHistoryFn = m.closeHistory; return !!closeHistoryFn; })\n'
    "    .catch(() => { closeHistoryFn = null; return false; });\n"
    "}\n"
    "\n"
    "export function historyHelperReady() { return !!closeHistoryFn; }\n"
)
once(s, OLD_BLOCK, "history helper block")
NEW_BLOCK = (
    "// prosemirror-history closes the current undo group when it sees this marker\n"
    "// on a transaction. We set it by name instead of importing closeHistory():\n"
    "// Transaction.getMeta() looks a plugin key up by its string form, and\n"
    "// prosemirror-state's createKey() always names the first (and only) key\n"
    '// called "closeHistory" as "closeHistory$". Doing it this way needs no extra\n'
    "// package, and an unrecognised meta key is simply ignored, so it can never\n"
    "// break anything.\n"
    'const CLOSE_HISTORY_MARK = "closeHistory$";\n'
    "\n"
    "// True when the marker really lands on a transaction. Cheap self-check, so a\n"
    "// caller can tell the difference between working and silently doing nothing.\n"
    "export function historyHelperReady(editor) {\n"
    "  try {\n"
    "    const tr = editor.state.tr;\n"
    "    tr.setMeta(CLOSE_HISTORY_MARK, true);\n"
    "    return tr.getMeta(CLOSE_HISTORY_MARK) === true;\n"
    "  } catch (e) {\n"
    "    return false;\n"
    "  }\n"
    "}\n"
)
s = s.replace(OLD_BLOCK, NEW_BLOCK)

# the comment above the old block no longer describes it
OLD_C = (
    "// prosemirror's history helper. Loaded lazily and optionally: if it is not\n"
    "// there for any reason, replace-all still works \u2014 a single transaction is\n"
    "// already a single history entry in practice; closeHistory only guarantees it\n"
    "// is never glued onto the edit the user made a moment earlier.\n"
)
once(s, OLD_C, "history comment")
s = s.replace(OLD_C, "")

OLD_CALL = "  if (closeHistoryFn) closeHistoryFn(tr);\n"
once(s, OLD_CALL, "closeHistoryFn call")
s = s.replace(OLD_CALL,
    "  // Start a fresh undo group, so this replace-all is never glued onto the\n"
    "  // edit the user made a moment earlier - one undo takes back the\n"
    "  // replacement and nothing more.\n"
    "  tr.setMeta(CLOSE_HISTORY_MARK, true);\n")

io.open(SCOPE, "w", encoding="utf-8", newline=NL).write(s)
print("find_replace_scope.js: %d -> %d chars" % (before, len(s)))

# ------------------------------------------------------------ find_replace.js
f = io.open(FR, encoding="utf-8").read()
fbefore = len(f)
A = "  primeHistoryHelper,\n"
once(f, A, "import entry")
f = f.replace(A, "")
B = "export function setupFindReplace() {\n  primeHistoryHelper();\n"
once(f, B, "setup call")
f = f.replace(B, "export function setupFindReplace() {\n")
io.open(FR, "w", encoding="utf-8", newline=NL).write(f)
print("find_replace.js: %d -> %d chars" % (fbefore, len(f)))
