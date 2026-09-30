import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/inbox_forms.js', import.meta.url), 'utf8');

test('audited PR #290: dynamic inbox modal close button keeps accessible name and tooltip', () => {
  assert.match(source, /closeBtn\.setAttribute\(['"]aria-label['"], ['"]סגור חלון['"]\)/u);
  assert.match(source, /closeBtn\.title\s*=\s*['"]סגור['"]/u);
});
