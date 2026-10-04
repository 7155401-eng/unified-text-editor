import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createV9MeasurementStyleIdentity,
  v9MeasurementCacheKey,
} from '../../src/engine/v9_text_measurement.js';

test('measurement style identity reuses the same unchanged style object', () => {
  const idFor = createV9MeasurementStyleIdentity();
  const style = { fontFamily: 'serif', fontSize: '13px', lineHeight: '20px', direction: 'rtl' };
  assert.equal(idFor(style), idFor(style));
});

test('measurement style identity interns different objects with identical measured typography', () => {
  const idFor = createV9MeasurementStyleIdentity();
  const a = { fontFamily: 'serif', fontSize: '13px', lineHeight: '20px', direction: 'rtl' };
  const b = { fontFamily: 'serif', fontSize: '13px', lineHeight: '20px', direction: 'rtl' };
  assert.equal(idFor(a), idFor(b));
});

test('measurement style identity invalidates immediately when a measured typography field mutates', () => {
  const idFor = createV9MeasurementStyleIdentity();
  const style = { fontFamily: 'serif', fontSize: '13px', lineHeight: '20px', direction: 'rtl' };
  const before = idFor(style);
  style.fontSize = '14px';
  const after = idFor(style);
  assert.notEqual(after, before);
  style.fontSize = '13px';
  assert.equal(idFor(style), before);
});

test('measurement style identity ignores properties that cannot affect the V9 measured DOM', () => {
  const idFor = createV9MeasurementStyleIdentity();
  const style = { fontFamily: 'serif', fontSize: '13px', lineHeight: '20px', direction: 'rtl' };
  const before = idFor(style);
  style.auditOnlyMetadata = { changed: true };
  assert.equal(idFor(style), before);
});

test('public structural measurement cache key remains backward compatible', () => {
  const part = {
    leadingText: '',
    text: 'abc',
    trailingText: '',
    runs: [],
    refs: [],
    style: { fontSize: '13px' },
  };
  const before = v9MeasurementCacheKey(part);
  part.style.auditOnlyMetadata = 1;
  const after = v9MeasurementCacheKey(part);
  assert.notEqual(after, before);
});
