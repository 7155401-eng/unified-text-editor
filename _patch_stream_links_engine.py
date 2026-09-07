# Patch both copies of the nesting logic so a stream's notes are only pulled
# into another stream's note when the user linked them. Exact-string edits,
# each anchor asserted to appear exactly once.
import io

def load(path):
    return io.open(path, encoding="utf-8").read()

def save(path, text):
    io.open(path, "w", encoding="utf-8", newline="").write(text)

def sub(text, old, new, tag):
    n = text.count(old)
    assert n == 1, "anchor %s found %d times (expected 1)" % (tag, n)
    return text.replace(old, new, 1)

IMPORT_OLD = 'import { isNestedNotesEnabled } from "./nested_notes_gate.js";\n'
IMPORT_NEW = ('import { isNestedNotesEnabled } from "./nested_notes_gate.js";\n'
              'import { canNestInside, streamLinksSignature } from "./stream_links.js";\n')

EXPAND_OLD = """    if (!code || code === ownCode) {
      // self-reference or unknown — keep literal
      continue;
    }
"""
EXPAND_NEW = """    if (!code || code === ownCode || !canNestInside(code, ownCode)) {
      // self-reference, unknown symbol, or a stream the user did not link to
      // the stream that owns this note — keep the marker as literal text.
      // Default configuration = no links = "attached to the main only".
      continue;
    }
"""

PHASE_B_OLD = """          const ycode = paneSymToCode[m[0]];
          if (!ycode || ycode === code) continue;
          if (!consumersByStream[ycode]) consumersByStream[ycode] = [];
"""
PHASE_B_NEW = """          const ycode = paneSymToCode[m[0]];
          if (!ycode || ycode === code) continue;
          // Only a stream the user linked to `code` may hang off this note.
          if (!canNestInside(ycode, code)) continue;
          if (!consumersByStream[ycode]) consumersByStream[ycode] = [];
"""

SIG_OLD = """  const globalStreamOverridesSig = (typeof window !== "undefined" && window.localStorage)
    ? window.localStorage.getItem("ravtext.globalStreamOverrides.v1") || ""
    : "";
"""
SIG_NEW = """  const globalStreamOverridesSig = (typeof window !== "undefined" && window.localStorage)
    ? window.localStorage.getItem("ravtext.globalStreamOverrides.v1") || ""
    : "";
  // Changing which streams may nest inside which changes the packed content,
  // so it has to invalidate the cached result too.
  const streamLinksSig = streamLinksSignature();
"""

# ---- engine_bridge.js -------------------------------------------------
P = "src/engine_bridge.js"
t = load(P)
t = sub(t, IMPORT_OLD, IMPORT_NEW, "bridge:import")
t = sub(t, EXPAND_OLD, EXPAND_NEW, "bridge:expandNestedInNote")
t = sub(t, PHASE_B_OLD, PHASE_B_NEW, "bridge:phaseB")
t = sub(t, SIG_OLD, SIG_NEW, "bridge:sig-decl")
t = sub(t,
        '  return sigParts + "##" + nestedFlag + "##" + demoFlag + "##" + globalStreamOverridesSig;\n',
        '  return sigParts + "##" + nestedFlag + "##" + demoFlag + "##" + globalStreamOverridesSig + "##" + streamLinksSig;\n',
        "bridge:sig-return")
t = sub(t,
        """          const ycode = paneSymToCode[m[0]];
          if (ycode && ycode !== code) {
            localMarkers.push({ atInPara: m.index, sym: m[0] });
          }
""",
        """          const ycode = paneSymToCode[m[0]];
          // A marker of a stream that is NOT linked to this one was never
          // pulled as a child, so it must stay visible as literal text.
          if (ycode && ycode !== code && canNestInside(ycode, code)) {
            localMarkers.push({ atInPara: m.index, sym: m[0] });
          }
""",
        "bridge:phaseD")
save(P, t)
print("patched", P)

# ---- talmud_overflow_repagination.js ---------------------------------
P = "src/talmud_overflow_repagination.js"
t = load(P)
t = sub(t, IMPORT_OLD, IMPORT_NEW, "talmud:import")
t = sub(t, EXPAND_OLD, EXPAND_NEW, "talmud:expandNestedInNote")
t = sub(t, PHASE_B_OLD, PHASE_B_NEW, "talmud:phaseB")
t = sub(t, SIG_OLD, SIG_NEW, "talmud:sig-decl")
t = sub(t,
        '  return sigParts + "##" + nestedFlag + "##" + globalStreamOverridesSig;\n',
        '  return sigParts + "##" + nestedFlag + "##" + globalStreamOverridesSig + "##" + streamLinksSig;\n',
        "talmud:sig-return")
t = sub(t,
        """          const ycode = paneSymToCode[m[0]];
          stripped += c.text.substring(prev, m.index);
          prev = m.index + m[0].length;
          if (!ycode || ycode === code) {
            stripped += m[0]; // keep self-stream / unknown markers literal
          } else {
            didStrip = true; // cross-stream — drop from display
          }
""",
        """          const ycode = paneSymToCode[m[0]];
          stripped += c.text.substring(prev, m.index);
          prev = m.index + m[0].length;
          if (!ycode || ycode === code || !canNestInside(ycode, code)) {
            // self-stream, unknown, or a stream that is not linked to this
            // one — it was never pulled as a child, so it stays literal.
            stripped += m[0];
          } else {
            didStrip = true; // cross-stream and linked — drop from display
          }
""",
        "talmud:phaseD")
save(P, t)
print("patched", P)
