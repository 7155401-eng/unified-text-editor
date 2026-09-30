import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hasPotentialStreamMarker,
  streamMarkerContextRadius,
  streamMarkerScanMode,
} from '../../src/stream_mark_scan_policy.js';

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


test('changed-range context always covers the complete custom symbol', () => {
  assert.equal(streamMarkerContextRadius(null), 8);
  assert.equal(streamMarkerContextRadius('@01'), 8);
  assert.equal(streamMarkerContextRadius('CUSTOM-LONG-MARKER'), 'CUSTOM-LONG-MARKER'.length + 1);
});

test('scan policy uses changed-range fast path only for a simple one-step document edit', () => {
  assert.equal(streamMarkerScanMode({
    forceScan: false,
    docChanged: false,
    transactionMapCounts: [1],
  }), 'none');

  assert.equal(streamMarkerScanMode({
    forceScan: true,
    docChanged: false,
    transactionMapCounts: [],
  }), 'full');

  assert.equal(streamMarkerScanMode({
    forceScan: false,
    docChanged: true,
    transactionMapCounts: [1],
  }), 'changed-range');

  // Complex commands remain conservative: their intermediate mapping
  // coordinates need not be directly comparable to oldState/newState.
  assert.equal(streamMarkerScanMode({
    forceScan: false,
    docChanged: true,
    transactionMapCounts: [2],
  }), 'full');
  assert.equal(streamMarkerScanMode({
    forceScan: false,
    docChanged: true,
    transactionMapCounts: [1, 1],
  }), 'full');
});

test('StreamMark ordinary typing fast path is document-size independent and storage is read only after scan eligibility', async () => {
  const source = await readFile(new URL('../../src/stream_mark.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /AUTO_MARK_FULL_SCAN_LIMIT/);
  assert.doesNotMatch(source, /newState\.doc\.content\.size\s*>/);

  const modePos = source.indexOf('const scanMode = streamMarkerScanMode');
  const nonePos = source.indexOf('if (scanMode === "none") return null;');
  const nestedPos = source.indexOf('let nestedOn = false;');
  const gatePos = source.indexOf('scanMode === "changed-range"');

  assert.ok(modePos >= 0, 'scan-mode computation missing');
  assert.ok(nonePos > modePos, 'no-scan fast return missing');
  assert.ok(nestedPos > nonePos, 'nested storage read must happen only after scan eligibility');
  assert.ok(gatePos > nestedPos, 'changed-range gate missing');

  assert.match(
    source,
    /transactionMapCounts:\s*transactions\.map\(t => t\.mapping\.maps\.length\)/
  );
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
  assert.match(source, /const contextRadius = streamMarkerContextRadius\(userSymbol\)/);
  assert.match(source, /newStart - contextRadius/);
  assert.match(source, /oldStart - contextRadius/);
});
