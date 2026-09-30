import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PANE_KIND_MAIN,
  PANE_KIND_STREAM,
  PANE_KIND_INTRO,
  normalizePaneKind,
  isMainPaneKind,
  isIntroPaneKind,
} from '../../src/pane_kinds.js';

test('B7 pane kinds preserve legacy main panes and distinguish intro panes', () => {
  assert.equal(normalizePaneKind(undefined, null), PANE_KIND_MAIN);
  assert.equal(normalizePaneKind('', null), PANE_KIND_MAIN);
  assert.equal(normalizePaneKind('intro', null), PANE_KIND_INTRO);
  assert.equal(normalizePaneKind('main', '01'), PANE_KIND_STREAM);
  assert.equal(normalizePaneKind('intro', '01'), PANE_KIND_STREAM);
  assert.equal(isMainPaneKind(undefined, null), true);
  assert.equal(isMainPaneKind('intro', null), false);
  assert.equal(isIntroPaneKind('intro', null), true);
  assert.equal(isIntroPaneKind(undefined, null), false);
});
