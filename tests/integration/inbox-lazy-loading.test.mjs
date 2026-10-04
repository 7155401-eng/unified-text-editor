import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../../" + path, import.meta.url), "utf8");
}

test("startup keeps inbox modal implementation behind a lazy boundary", async () => {
  const [main, lazyWire, inbox, usage] = await Promise.all([
    source("src/main.js"),
    source("src/inbox_forms_lazy_wire.js"),
    source("src/inbox_forms.js"),
    source("src/usage_tracker.js"),
  ]);

  assert.doesNotMatch(main, /from\s+["']\.\/inbox_forms\.js["']/);
  assert.match(main, /from\s+["']\.\/usage_tracker\.js["']/);
  assert.match(main, /from\s+["']\.\/inbox_forms_lazy_wire\.js["']/);
  assert.match(main, /wireInboxButtonsLazy\(\)/);

  assert.match(lazyWire, /import\(["']\.\/inbox_forms\.js["']\)/);
  for (const exportName of [
    "openTroubleshootingModal",
    "openBugReportModal",
    "openContactModal",
    "openDevUpdatesModal",
  ]) {
    assert.ok(lazyWire.includes(exportName), "missing lazy inbox action: " + exportName);
  }

  assert.match(inbox, /export\s*\{\s*trackUsage\s*\}\s*from\s*["']\.\/usage_tracker\.js["']/);
  assert.match(usage, /\/api\/usage\/track/);
  assert.match(usage, /keepalive:\s*true/);
});

test("lazy inbox wiring is idempotent and retries a failed module load", async () => {
  const lazyWire = await source("src/inbox_forms_lazy_wire.js");
  assert.match(lazyWire, /dataset\.inboxLazyWired\s*===\s*["']1["']/);
  assert.match(lazyWire, /inboxFormsPromise\s*=\s*null;\s*throw err;/);
});
