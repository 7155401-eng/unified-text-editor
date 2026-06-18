// The live-render behavior is now fixed directly in the source files that are loaded by the app.
// This script is intentionally kept as a build-time verifier so legacy package scripts stay safe.

import fs from "node:fs";

const REQUIRED = [
  {
    path: "src/render_pause_controls.js",
    markers: [
      "const LIVE_USER_CHOICE_KEY = LIVE_KEY + \".userChoice\";",
      "function applyDefaultOffGuard()",
      "function ensureLiveRenderToggleButton()",
      "live-render-toggle-button",
      "⚠ עלול להאט או לתקוע במסמכים גדולים",
    ],
  },
];

for (const file of REQUIRED) {
  const source = fs.readFileSync(file.path, "utf8");
  const missing = file.markers.filter((marker) => !source.includes(marker));
  if (missing.length) {
    throw new Error(`[live-render-default-off] ${file.path} is missing required direct-source markers: ${missing.join(", ")}`);
  }
}

console.log("[live-render-default-off] direct source fix verified");
