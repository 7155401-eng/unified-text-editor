# Add ONE hook call to the stream-pane header builder so a separate module can
# hang the "notes-on-notes links" control there. Nothing existing is removed or
# renamed. pane_manager.js uses CRLF, so the file is read and written with the
# line endings left exactly as they are.
import io

PATH = "src/pane_manager.js"

raw = io.open(PATH, encoding="utf-8", newline="").read()
EOL = "\r\n" if "\r\n" in raw else "\n"
assert raw.count("\n") == raw.count(EOL), "mixed line endings - refusing to patch"

def block(lines):
    return EOL.join(lines) + EOL

OLD = block([
    "      header.appendChild(close);",
    "    }",
])
NEW = block([
    "      header.appendChild(close);",
    "    }",
    "",
    "    // Notes-on-notes: give an optional module one chance to hang its own",
    "    // control in this header. Called exactly once, right after the header",
    "    // is built, so nothing here runs repeatedly and no mutation loop can",
    "    // start. If no module registered a hook, nothing happens at all.",
    "    if (this.streamCode && typeof window !== \"undefined\"",
    "        && typeof window.__ravtextStreamLinksHeaderHook === \"function\") {",
    "      try { window.__ravtextStreamLinksHeaderHook(this, header); } catch (_) {}",
    "    }",
])

n = raw.count(OLD)
assert n == 1, "anchor pane_manager:close-button found %d times (expected 1)" % n
raw = raw.replace(OLD, NEW, 1)
io.open(PATH, "w", encoding="utf-8", newline="").write(raw)
print("patched", PATH, "eol=", repr(EOL))
