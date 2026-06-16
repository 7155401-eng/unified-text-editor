import { parseAuto } from "./engine/parser.js";
import { paneManagerFromEngineDoc } from "./engine_bridge.js";
import { installDefaultTextGuard } from "./default_text_guard.js";
import hebrewText from "../samples/sample-hebrew.txt?raw";
import shulchanText from "../samples/sample-shulchan.txt?raw";
import talmudText from "../samples/sample-talmud.txt?raw";
import adminDefaultHtml from "../samples/admin-default.html?raw";

function emptyDoc() {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

async function loadSampleText(name) {
  if (name === "shulchan") return shulchanText;
  if (name === "talmud") return talmudText;
  return hebrewText;
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

installDefaultTextGuard({
  loadDefault: (paneManager) => loadSampleByName(paneManager, "shulchan"),
});
