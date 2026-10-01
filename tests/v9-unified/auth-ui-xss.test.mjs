import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/auth_ui.js', import.meta.url), 'utf8');

test('auth profile email never returns to an HTML interpolation sink', () => {
  // The historical vulnerable shape was:
  //   <div class="profile-menu-email">${auth.email}</div>
  // Keep the email in a textContent assignment instead.
  assert.doesNotMatch(
    source,
    /profile-menu-email[^\n]*>\s*\$\{\s*auth\.email\s*\}/,
  );
  assert.match(
    source,
    /querySelector\(["']\.profile-menu-email["']\)\.textContent\s*=\s*auth\.email\s*;/,
  );
});

test('auth avatar initial is painted as text and constrained to one safe character', () => {
  assert.match(
    source,
    /initial\.textContent\s*=\s*initialFromEmail\(auth\.email\)\s*;/,
  );
  assert.match(
    source,
    /return\s+\/\[A-Z\\u0590-\\u05ff0-9\]\/\.test\(ch\)\s*\?\s*ch\s*:\s*["']\?["']/,
  );
  assert.doesNotMatch(
    source,
    /btn\.innerHTML\s*=\s*[^;]*auth\.email/,
  );
});

test('remaining auth header HTML only receives derived fixed-domain values', () => {
  // statusFor() can return only guest/paid/free and gradientForEmail() returns
  // a palette-selected CSS gradient. The raw email itself is assigned later
  // through textContent.
  assert.match(source, /return\s+auth\.paid\s*\?\s*["']paid["']\s*:\s*["']free["']/);
  assert.match(source, /background:\$\{gradientForEmail\(auth\.email\)\}/);
  assert.match(source, /<span>\$\{initialFromEmail\(auth\.email\)\}<\/span>/);
  assert.doesNotMatch(source, /<[^>]+>\$\{\s*auth\.email\s*\}<\/[^>]+>/);
});
