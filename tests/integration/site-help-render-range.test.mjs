import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL("../../" + p, import.meta.url), "utf8");

test("site title and help center are wired", () => {
  const html = read("index.html");
  const main = read("src/main.js");
  const i18n = read("src/i18n.js");
  assert.match(html, /<title>מחולל הפלא של רב טקסט<\/title>/);
  assert.match(html, /id="btn-help-center"/);
  assert.match(main, /wireHelpCenter\(\)/);
  assert.match(i18n, /appTitle: "מחולל הפלא של רב טקסט"/);
});

test("render progress exposes an opt-in page range that is off by default", () => {
  const ui = read("src/render_progress_ui.js");
  assert.match(ui, /data-rtp-range="enabled"/);
  assert.match(ui, /rangeEnabled: false/);
  assert.match(ui, /export function getActiveRenderPageRange/);
  assert.match(ui, /רנדר רק טווח עמודים/);
});

test("V9 range wiring preserves pagination while skipping paint outside the chosen pages", () => {
  const v9 = read("src/vilna_v9.js");
  const apply = read("src/vilna_v9_apply.js");
  const bridge = read("src/engine_bridge.js");
  assert.match(v9, /pageRangeProvider/);
  assert.match(v9, /ravtext-range-skipped/);
  assert.match(v9, /syncV9PageRange/);
  assert.match(apply, /pageRangeProvider: \(\) => progress\.getRange\(\)/);
  assert.match(apply, /ravtext:render-page-range-change/);
  assert.match(bridge, /applyRenderPageRangeMask\(pagesContainer, v9Result\?\.pageRange\)/);
});

test("print and PDF exclude pages outside the selected range", () => {
  const toolbar = read("src/engine_toolbar.js");
  const pdf = read("src/pdf_export.js");
  assert.match(toolbar, /:not\(\.ravtext-range-outside\)/);
  assert.match(pdf, /:not\(\.ravtext-range-outside\)/);
});


test("user inquiries queue mail through the Shchiche relay without embedding a reusable secret", () => {
  const inbox = read("worker/inbox.js");
  const worker = read("worker/index.js");
  const migration = read("migrations/0011_mail_notifications.sql");
  assert.match(inbox, /MAIL_RELAY_DELIVER_URL = 'https:\/\/shchiche\.com\/wp-json\/ravtext-mail\/v1\/deliver'/);
  assert.match(inbox, /crypto\.getRandomValues/);
  assert.match(inbox, /relay_expires_at/);
  assert.match(inbox, /queueAndDeliverUserMail/);
  assert.match(inbox, /kind: 'contact'/);
  assert.match(inbox, /kind: 'bug_report'/);
  assert.match(worker, /url\.pathname === '\/api\/mail-relay\/pull'/);
  assert.match(worker, /deliverPendingMailNotifications/);
  assert.match(migration, /UNIQUE\(kind, source_id\)/);
  assert.doesNotMatch(inbox, /Authorization:\s*Bearer|RAVTEXT_MAIL_BRIDGE_TOKEN|MAIL_BRIDGE_SECRET/);
});
