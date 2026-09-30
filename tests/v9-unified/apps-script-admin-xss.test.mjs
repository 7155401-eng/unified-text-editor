import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(
  new URL('../../apps-script-export-sanitized/Index.html', import.meta.url),
  'utf8'
);

const start = html.indexOf('<script>');
const end = html.indexOf('</script>', start);
assert.ok(start >= 0 && end > start, 'admin inline script not found');
const script = html.slice(start + '<script>'.length, end);

test('Apps Script admin inline JavaScript parses successfully', () => {
  assert.doesNotThrow(() => new Function(script));
});

test('Apps Script admin never renders server/customer data through innerHTML', () => {
  assert.doesNotMatch(script, /\.innerHTML\b/u);
  assert.doesNotMatch(script, /<td>['"]?\s*\+\s*(?:c|tc|report|result|err)\b/u);
  assert.doesNotMatch(script, /err\.message\s*\+\s*['"][^'"]*<\/div>/u);
});

test('customer action handlers are bound as functions, not interpolated inline JavaScript', () => {
  assert.doesNotMatch(script, /onclick\\?=["'][^"'\n]*\+\s*c\.customer_id/u);
  assert.match(script, /button\.addEventListener\(['"]click['"],\s*handler\)/u);
  assert.match(script, /addPointsAction\(customerId\)/u);
  assert.match(script, /toggleStatus\(customerId,\s*currentStatus\)/u);
  assert.match(script, /regenerateCode\(customerId\)/u);
});

test('dynamic admin output is assigned as text nodes/textContent', () => {
  assert.match(script, /cell\.textContent\s*=\s*textValue\(value\)/u);
  assert.match(script, /strong\.textContent\s*=\s*textValue\(result\s*&&\s*result\.access_code\)/u);
  assert.match(script, /renderError\('customers-table',\s*err\)/u);
  assert.match(script, /renderError\('report-result',\s*err\)/u);
  assert.match(script, /renderError\('key-save-result',\s*err\)/u);
});
