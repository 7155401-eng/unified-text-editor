import { parseAuto } from "./engine/parser.js";
import { paneManagerFromEngineDoc } from "./engine_bridge.js";
import { installDefaultTextGuard } from "./default_text_guard.js";
import "./compact_stream_menu.js";
import adminDefaultHtml from "../samples/admin-default.html?raw";

function emptyDoc() {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

async function loadSampleText(name) {
  if (name === "talmud") {
    return (await import("../samples/sample-talmud.txt?raw")).default;
  }
  // "hebrew" and "shulchan" historically resolve to the same starter text.
  // Keep that behavior, but do not pull the 75KB raw sample into the entry
  // bundle. Dynamic modules are cached by the browser/module loader.
  return (await import("../samples/sample-shulchan.txt?raw")).default;
}

export async function loadSampleByName(paneManager, name = "hebrew") {
  const raw = await loadSampleText(name);
  paneManager.load({
    version: 1,
    activeId: "sample-main",
    panes: [
      {
        id: "sample-main",
        streamCode: null,
        symbol: "",
        label: "ראשי",
        content: emptyDoc(),
      },
    ],
  });

  const doc = parseAuto(raw);
  return paneManagerFromEngineDoc(paneManager, doc);
}

export async function loadStaticStarterSample(paneManager) {
  const raw = await loadSampleText("shulchan");
  paneManager.load({
    version: 1,
    activeId: "sample-main",
    panes: [
      {
        id: "sample-main",
        streamCode: null,
        symbol: "",
        label: "ראשי",
        content: emptyDoc(),
      },
    ],
  });

  const doc = parseAuto(raw);
  return paneManagerFromEngineDoc(paneManager, doc);
}

installDefaultTextGuard({
  loadDefault: loadStaticStarterSample,
});

export function loadEditableDefaultSample(paneManager) {
  paneManager.load({
    version: 1,
    activeId: "sample-main",
    panes: [
      {
        id: "sample-main",
        streamCode: null,
        symbol: "",
        label: "ראשי",
        content: emptyDoc(),
      },
    ],
  });

  const main = paneManager.getMainPane();
  if (main?.editor) {
    main.editor.commands.setContent(adminDefaultHtml);
  }
  return main;
}
