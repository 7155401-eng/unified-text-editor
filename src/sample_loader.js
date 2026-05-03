import { parseAuto } from "./engine/parser.js";
import { paneManagerFromEngineDoc } from "./engine_bridge.js";
import hebrewText from "../samples/sample-hebrew.txt?raw";
import shulchanText from "../samples/sample-shulchan.txt?raw";
import talmudText from "../samples/sample-talmud.txt?raw";

const SAMPLES = {
  hebrew: hebrewText,
  shulchan: shulchanText,
  talmud: talmudText,
};

function emptyDoc() {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

export function loadSampleByName(paneManager, name = "hebrew") {
  const raw = SAMPLES[name] || SAMPLES.hebrew;
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
