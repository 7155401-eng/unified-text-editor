import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../../src/vilna_v9.js',import.meta.url),'utf8');

test('final V9 painter uses planner line.y as the only vertical authority',()=>{
  assert.match(source,/lineEl\.style\.top = line\.y \+ 'px';/);
  assert.doesNotMatch(
    source,
    /lineEl\.style\.top\s*=\s*\(Number\.isFinite\(line\.renderY\)/,
    'final painter still honors post-plan renderY'
  );
});

test('legacy pitch fixer remains disconnected from the painter',()=>{
  assert.match(source,/void enforceUniformLinePitch;/);
  assert.doesNotMatch(
    source,
    /enforceUniformLinePitch\([^)]*\);\s*\n(?!\s*void)/,
    'legacy post-plan pitch fixer is active again'
  );
});
