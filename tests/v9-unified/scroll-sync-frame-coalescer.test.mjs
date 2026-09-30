import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FrameCoalescer } from '../../src/frame_coalescer.js';

function fakeFrameEnv() {
  let nextId = 1;
  const frames = new Map();
  return {
    frames,
    requestAnimationFrame(cb) {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    runNext() {
      const first = frames.entries().next();
      if (first.done) return false;
      const [id, cb] = first.value;
      frames.delete(id);
      cb();
      return true;
    },
  };
}

test('FrameCoalescer runs at most once per animation frame and can schedule again', () => {
  const env = fakeFrameEnv();
  const c = new FrameCoalescer(env);
  let calls = 0;

  assert.equal(c.schedule(() => { calls += 1; }), true);
  assert.equal(c.schedule(() => { calls += 100; }), false);
  assert.equal(c.schedule(() => { calls += 1000; }), false);
  assert.equal(env.frames.size, 1);
  assert.equal(c.pending, true);

  assert.equal(env.runNext(), true);
  assert.equal(calls, 1);
  assert.equal(c.pending, false);

  assert.equal(c.schedule(() => { calls += 1; }), true);
  assert.equal(env.runNext(), true);
  assert.equal(calls, 2);
});

test('FrameCoalescer cancel removes pending frame without running work', () => {
  const env = fakeFrameEnv();
  const c = new FrameCoalescer(env);
  let calls = 0;

  c.schedule(() => { calls += 1; });
  assert.equal(c.cancel(), true);
  assert.equal(c.pending, false);
  assert.equal(env.frames.size, 0);
  assert.equal(env.runNext(), false);
  assert.equal(calls, 0);
  assert.equal(c.cancel(), false);
});

test('pane scroll sync is frame-coalesced and destruction cancels pending work', async () => {
  const source = await readFile(new URL('../../src/pane_manager.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ FrameCoalescer \} from "\.\/frame_coalescer\.js"/);
  assert.match(source, /this\._scrollSyncFrame = new FrameCoalescer\(\)/);
  assert.match(source, /this\._scrollSyncFrame\.schedule\(\(\) => this\._runScrollSync\(\)\)/);
  assert.match(source, /this\._scrollSyncFrame\.cancel\(\)/);

  const onScroll = source.slice(
    source.indexOf('  _onScroll() {'),
    source.indexOf('  _runScrollSync() {')
  );
  assert.match(onScroll, /if \(this\._syncSelfScroll\)[\s\S]*?return;/,
    'programmatic scroll must be swallowed before scheduling geometry work');
  assert.doesNotMatch(onScroll, /visibleMarkerAnchor\(/,
    'expensive semantic marker scan must run only in the coalesced callback');

  const runSync = source.slice(
    source.indexOf('  _runScrollSync() {'),
    source.indexOf('  _applyCollapsedState() {')
  );
  assert.match(runSync, /if \(mgr\.syncBusy\)[\s\S]*?_scrollSyncFrame\.schedule\(/,
    'busy sync lock must defer rather than drop the latest user scroll');
  assert.match(runSync, /try \{[\s\S]*?visibleMarkerAnchor\([\s\S]*?\} finally \{/,
    'sync lock release must be protected by finally around geometry work');
});
