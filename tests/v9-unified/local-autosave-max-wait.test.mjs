import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function installFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeoutFake(fn, delay = 0) {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn });
    return id;
  }

  function clearTimeoutFake(id) {
    timers.delete(id);
  }

  function advance(ms) {
    const target = now + ms;
    while (true) {
      let chosenId = null;
      let chosen = null;
      for (const [id, timer] of timers) {
        if (timer.at > target) continue;
        if (!chosen || timer.at < chosen.at || (timer.at === chosen.at && id < chosenId)) {
          chosenId = id;
          chosen = timer;
        }
      }
      if (!chosen) break;
      timers.delete(chosenId);
      now = chosen.at;
      chosen.fn();
    }
    now = target;
  }

  function clearAll() {
    timers.clear();
  }

  return { setTimeoutFake, clearTimeoutFake, advance, clearAll, pending: () => timers.size };
}

test('continuous typing cannot postpone local persistence beyond five seconds', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="panes"></div></body>', {
    url: 'https://example.test/',
  });
  const clock = installFakeClock();

  const previous = new Map();
  const replacements = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (fn) => clock.setTimeoutFake(() => fn(0), 16),
    cancelAnimationFrame: clock.clearTimeoutFake,
    setTimeout: clock.setTimeoutFake,
    clearTimeout: clock.clearTimeoutFake,
  };

  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  let manager = null;
  try {
    const { PaneManager } = await import('../../src/pane_manager.js');
    manager = new PaneManager(dom.window.document.getElementById('panes'));
    const originalWrite = manager._writeStorageNow.bind(manager);
    let writes = 0;
    manager._writeStorageNow = () => {
      writes++;
      return originalWrite();
    };

    // Keep editing every 300 ms. The normal 350 ms debounce is therefore
    // continually replaced and can never fire on its own.
    manager._save();
    for (let i = 0; i < 16; i++) {
      clock.advance(300);
      manager._save();
    }
    assert.equal(writes, 0);

    // t=4800ms. The first edit's non-sliding 5s deadline must still win.
    clock.advance(199);
    assert.equal(writes, 0);
    clock.advance(1);
    assert.equal(writes, 1);
    assert.ok(dom.window.localStorage.getItem('ravtext.panes.state.v1'));

    // A new edit starts a fresh window. If typing now pauses, the ordinary
    // debounce still saves promptly instead of waiting for another 5 seconds.
    manager._save();
    clock.advance(349);
    assert.equal(writes, 1);
    clock.advance(1);
    assert.equal(writes, 2);
  } finally {
    // PaneManager and imported editor helpers may have scheduled zero-delay /
    // animation-frame work through the fake clock. Do not restore/remove the
    // JSDOM globals while those callbacks are still pending: Node's test runner
    // correctly treats that as leaked async activity after the test.
    try { manager?._clearSaveTimers?.(); } catch (_) {}
    try {
      for (const pane of manager?.panes || []) pane?.destroy?.();
    } catch (_) {}
    clock.clearAll();

    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
