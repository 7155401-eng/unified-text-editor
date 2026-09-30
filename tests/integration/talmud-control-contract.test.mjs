import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const controls = fs.readFileSync(new URL("../../src/talmud_controls.js", import.meta.url), "utf8");

test("legacy unbound talmud sides input is absent", () => {
  assert(!html.includes('id="talmud-sides-input"'), "dead talmud-sides-input returned");
});

test("working mirrored Talmud layout toggle remains present and wired bidirectionally", () => {
  assert(html.includes('id="talmud-layout-toggle"'), "primary Talmud toggle missing");
  assert(html.includes('id="talmud-layout-toggle-sides"'), "mirror Talmud toggle missing");
  assert(controls.includes('document.getElementById("talmud-layout-toggle-sides")'),
    "mirror toggle is no longer wired");
  assert(controls.includes('toggle.dispatchEvent(new Event("change", { bubbles: true }))'),
    "mirror → primary synchronization missing");
  assert(controls.includes('mirrorToggle.checked = toggle.checked'),
    "primary → mirror synchronization missing");
});
