import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BoundedDebouncer } from '../../src/bounded_debouncer.js';

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimer(fn, delay = 0) {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn });
    return id;
  }

  function clearTimer(id) {
    timers.delete(id);
  }

  function advance(ms) {
    const target = now + ms;
    while (true) {
      let selectedId = null;
      let selected = null;
      for (const [id, timer] of timers) {
        if (timer.at > target) continue;
        if (!selected || timer.at < selected.at || (timer.at === selected.at && id < selectedId)) {
          selectedId = id;
          selected = timer;
        }
      }
      if (!selected) break;
      timers.delete(selectedId);
      now = selected.at;
      selected.fn();
    }
    now = target;
  }

  return { setTimer, clearTimer, advance, pending: () => timers.size };
}

test('continuous scheduling cannot slide past the max-wait deadline', () => {
  const clock = fakeClock();
  const fired = [];
  const d = new BoundedDebouncer(() => fired.push('save'), {
    delayMs: 350,
    maxWaitMs: 5000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  d.schedule();
  for (let i = 0; i < 16; i++) {
    clock.advance(300);
    d.schedule();
  }
  assert.equal(fired.length, 0);
  assert.equal(d.pending, true);

  // t=4800. Repeated edits replaced every 350ms timer but not the original
  // 5000ms deadline.
  clock.advance(199);
  assert.equal(fired.length, 0);
  clock.advance(1);
  assert.deepEqual(fired, ['save']);
  assert.equal(d.pending, false);
  assert.equal(clock.pending(), 0);
});

test('ordinary pause still fires the short debounce and cancels the deadline', () => {
  const clock = fakeClock();
  let calls = 0;
  const d = new BoundedDebouncer(() => { calls++; }, {
    delayMs: 350,
    maxWaitMs: 5000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  d.schedule();
  clock.advance(349);
  assert.equal(calls, 0);
  clock.advance(1);
  assert.equal(calls, 1);
  assert.equal(clock.pending(), 0);

  clock.advance(5000);
  assert.equal(calls, 1, 'stale max-wait callback fired after debounce save');
});

test('flush fires once, cancel fires never, and later edits get a fresh deadline', () => {
  const clock = fakeClock();
  let calls = 0;
  const d = new BoundedDebouncer(() => { calls++; }, {
    delayMs: 350,
    maxWaitMs: 5000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  d.schedule();
  assert.equal(d.flush(), true);
  assert.equal(calls, 1);
  assert.equal(d.flush(), false);

  d.schedule();
  d.cancel();
  clock.advance(6000);
  assert.equal(calls, 1);

  d.schedule();
  clock.advance(4999);
  assert.equal(calls, 1);
  clock.advance(1);
  assert.equal(calls, 2);
});

test('PaneManager delegates local persistence timing to the bounded scheduler', async () => {
  const source = await readFile(new URL('../../src/pane_manager.js', import.meta.url), 'utf8');

  assert.match(source, /LOCAL_SAVE_DEBOUNCE_MS\s*=\s*350/);
  assert.match(source, /LOCAL_SAVE_MAX_WAIT_MS\s*=\s*5000/);
  assert.match(source, /new BoundedDebouncer\([\s\S]*?delayMs:\s*LOCAL_SAVE_DEBOUNCE_MS[\s\S]*?maxWaitMs:\s*LOCAL_SAVE_MAX_WAIT_MS/);
  assert.match(source, /_save\(\{ immediate = false \} = \{\}\)[\s\S]*?_localSaveScheduler\.schedule\(\)/);
  assert.match(source, /flushSave\(\)[\s\S]*?_localSaveScheduler\.cancel\(\)/);
  assert.match(source, /clearStorage\(\)[\s\S]*?_localSaveScheduler\.cancel\(\)/);
  assert.doesNotMatch(source, /this\._saveTimer\s*=/);
});
