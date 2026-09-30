// Build-time verifier for live-render default-off behavior.
// The policy and UI live directly in application source. This script MUST NOT
// rewrite source files. If a direct-source guarantee disappears, fail the build
// instead of silently patching an older implementation back into place.

import fs from "node:fs";

const CHECKS = [
  {
    path: "src/main.js",
    markers: [
      "LIVE_RENDER_DEFAULT_OFF_IN_SOURCE",
      "const LIVE_RENDER_CHOICE_KEY = LIVE_RENDER_KEY + \".userChoice\";",
      "if (localStorage.getItem(LIVE_RENDER_CHOICE_KEY) !== \"1\") return false;",
      "return localStorage.getItem(LIVE_RENDER_KEY) === \"1\";",
      "function setupLiveRenderToggle()",
      "input.id = \"live-render-toggle\";",
      "input.checked = isLiveRenderEnabled();",
      "localStorage.setItem(LIVE_RENDER_CHOICE_KEY, \"1\");",
      "localStorage.setItem(LIVE_RENDER_KEY, input.checked ? \"1\" : \"0\");",
    ],
  },
  {
    path: "src/render_pause_controls.js",
    markers: [
      "LIVE_RENDER_DEFAULT_OFF_IN_SOURCE",
      "const LIVE_CHOICE_KEY = LIVE_KEY + \".userChoice\";",
      "if (localStorage.getItem(LIVE_CHOICE_KEY) !== \"1\") return false;",
      "return localStorage.getItem(LIVE_KEY) === \"1\";",
      "if (options.userChoice) localStorage.setItem(LIVE_CHOICE_KEY, \"1\");",
    ],
  },
];

for (const check of CHECKS) {
  const source = fs.readFileSync(check.path, "utf8");
  const missing = check.markers.filter((marker) => !source.includes(marker));
  if (missing.length) {
    throw new Error(
      `[live-render-default-off] ${check.path} lost direct-source guarantees: ${missing.join(" | ")}`
    );
  }
}

console.log("[live-render-default-off] direct-source policy + UI verified; no source rewriting performed");
