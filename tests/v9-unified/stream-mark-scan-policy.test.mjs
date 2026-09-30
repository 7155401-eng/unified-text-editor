import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasPotentialStreamMarker } from '../../src/stream_mark_scan_policy.js';

test('stream pane fast-path recognizes only its own symbol when nested notes are off', () => {
  assert.equal(hasPotentialStreamMarker('ordinary text', '@01'), false);
  assert.equal(hasPotentialStreamMarker('before @01 after', '@01'), true);
  assert.equal(hasPotentialStreamMarker('before @02 after', '@01'), false);
});

test('nested mode expands a stream pane to any numeric @NN marker', () => {
  assert.equal(hasPotentialStreamMarker('before @02 after', '@01', { nestedOn: true }), true);
  assert.equal(hasPotentialStreamMarker('before @123 after', '@01', { nestedOn: true }), true);
  // Mirrors the existing full-scan regex /@(\d{1,3})/g, which recognizes
  // the first three digits even when more digits follow.
  assert.equal(hasPotentialStreamMarker('before @1234 after', '@01', { nestedOn: true }), true);
  assert.equal(hasPotentialStreamMarker('ordinary text', '@01', { nestedOn: true }), false);
});

test('main panes without a custom symbol always detect numeric stream markers', () => {
  assert.equal(hasPotentialStreamMarker('x @02 y', null), true);
  assert.equal(hasPotentialStreamMarker('x @2 y', ''), true);
  assert.equal(hasPotentialStreamMarker('x @999 y', null), true);
  assert.equal(hasPotentialStreamMarker('x @1000 y', null), true);
});

test('StreamMark gate computes nested mode before large-document fast-path and passes it through', async () => {
  const source = await readFile(new URL('../../src/stream_mark.js', import.meta.url), 'utf8');

  const nestedPos = source.indexOf('let nestedOn = false;');
  const gatePos = source.indexOf('newState.doc.content.size > AUTO_MARK_FULL_SCAN_LIMIT');
  assert.ok(nestedPos >= 0, 'nested-mode computation missing');
  assert.ok(gatePos >= 0, 'large-document scan gate missing');
  assert.ok(nestedPos < gatePos, 'nested mode must be known before the large-document gate runs');

  assert.match(
    source,
    /transactionsTouchPotentialMarker\([\s\S]*?userSymbol,[\s\S]*?markType,[\s\S]*?nestedOn[\s\S]*?\)/
  );
  assert.match(
    source,
    /hasPotentialStreamMarker\(newText, userSymbol, \{ nestedOn \}\)/
  );
  assert.match(
    source,
    /hasPotentialStreamMarker\(oldText, userSymbol, \{ nestedOn \}\)/
  );
});
