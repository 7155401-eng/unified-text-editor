import test from 'node:test';
import assert from 'node:assert/strict';
import { v9TailMetricCacheKey } from '../../src/engine/v9_main_inline_layout.js';

const base = Object.freeze({
  fromWord: 3,
  toWord: 7,
  start: 18,
  visibleEnd: 42,
  consumedEnd: 43,
  target: 154,
  maxHeight: 20.15,
  openingOnly: false,
});

test('tail metric cache reuses an identical source slice on equivalent row geometry', () => {
  const first = v9TailMetricCacheKey({ ...base });
  const second = v9TailMetricCacheKey({ ...base });

  assert.equal(second, first);
  assert.doesNotMatch(first, /line/i);
});

test('tail metric cache separates every input that can change measured validity or pressure', () => {
  const original = v9TailMetricCacheKey({ ...base });
  const variants = [
    { fromWord: 2 },
    { toWord: 8 },
    { start: 17 },
    { visibleEnd: 41 },
    { consumedEnd: 44 },
    { target: 155 },
    { maxHeight: 21 },
    { openingOnly: true },
  ];

  for (const patch of variants) {
    const key = v9TailMetricCacheKey({ ...base, ...patch });
    assert.notEqual(key, original, 'cache key ignored ' + Object.keys(patch)[0]);
  }
});

test('tail metric cache key is deterministic for fractional physical geometry', () => {
  const a = v9TailMetricCacheKey({
    ...base,
    target: 153.984375,
    maxHeight: 20.15625,
  });
  const b = v9TailMetricCacheKey({
    ...base,
    target: 153.984375,
    maxHeight: 20.15625,
  });

  assert.equal(a, b);
});
