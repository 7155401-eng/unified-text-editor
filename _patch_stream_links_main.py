# Wire the stream-links chooser into the app, next to the existing
# nested-notes wiring. Additive only; CRLF preserved.
import io

PATH = "src/main.js"
raw = io.open(PATH, encoding="utf-8", newline="").read()
EOL = "\r\n" if "\r\n" in raw else "\n"
assert raw.count("\n") == raw.count(EOL), "mixed line endings - refusing to patch"

def block(lines):
    return EOL.join(lines) + EOL

OLD = block([
    'import("./nested_notes_bubble.js").then((m) => {',
    '  if (typeof m.installNestedNotesBubble === "function") m.installNestedNotesBubble(paneManager);',
    '}).catch((_) => {});',
])
NEW = OLD + block([
    "",
    "// Notes-on-notes links: a small chooser in every stream pane header that says",
    "// which other streams this stream's notes may hang from. Default is the main",
    "// text only, so nothing changes until the user picks something.",
    'import("./stream_links_ui.js").then((m) => {',
    '  if (typeof m.installStreamLinksUI === "function") m.installStreamLinksUI(paneManager);',
    "}).catch((_) => {});",
])

n = raw.count(OLD)
assert n == 1, "anchor main:nested-bubble found %d times (expected 1)" % n
raw = raw.replace(OLD, NEW, 1)
io.open(PATH, "w", encoding="utf-8", newline="").write(raw)
print("patched", PATH, "eol=", repr(EOL))
