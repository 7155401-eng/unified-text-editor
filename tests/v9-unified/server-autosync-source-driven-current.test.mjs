import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  };
}

function fakeStorage() {
  const data = new Map();
  return {
    get length(){ return data.size; },
    key(i){ return [...data.keys()][i] ?? null; },
    getItem(k){ return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k,v){ data.set(String(k), String(v)); },
    removeItem(k){ data.delete(String(k)); },
  };
}

function fakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    setTimeout(fn, delay) {
      const id = nextId++;
      active.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) { active.delete(id); },
    delays() { return [...active.values()].map(x=>x.delay).sort((a,b)=>a-b); },
    runOneByDelay(delay) {
      const hit = [...active.entries()].find(([,x])=>x.delay===delay);
      assert.ok(hit, 'missing timer '+delay);
      const [id, entry] = hit;
      active.delete(id);
      entry.fn();
    },
  };
}

async function settle(rounds=6) {
  for(let i=0;i<rounds;i++) await Promise.resolve();
}

test('current-main autosync is source-driven, bounded, serialized and recovery-safe', async () => {
  const paneSource = fs.readFileSync(new URL('../../src/pane_manager.js', import.meta.url), 'utf8');
  assert.match(paneSource, /this\._emit\("persist"\)/,
    'PaneManager must emit semantic persist from the central save path');
  assert.match(paneSource, /ravtext:local-document-saved/,
    'successful browser-local snapshots must be announced');

  const timers = fakeTimers();
  const storage = fakeStorage();
  const listeners = new Map();
  const callbacks = new Map();

  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent() {},
  };

  let content = { version:1, panes:[{ id:'main', content:{ text:'A' } }] };
  const paneManager = {
    on(type, fn){ callbacks.set(type, fn); },
    serializeForPersistence(){ return structuredClone(content); },
    flushSave(){},
  };

  const fetchCalls = [];
  let releaseB = null;
  let releaseC = null;
  let rejectD = null;
  const fetchStub = (url, init={}) => {
    const parsed = JSON.parse(init.body || '{}');
    fetchCalls.push({ url:String(url), init, parsed });
    const n = fetchCalls.length;
    if (n === 2) return new Promise(resolve => { releaseB = () => resolve({ok:true,status:200}); });
    if (n === 3) return new Promise(resolve => { releaseC = () => resolve({ok:true,status:200}); });
    if (n === 4) return new Promise((_resolve,reject) => { rejectD = () => reject(new Error('offline')); });
    return Promise.resolve({ok:true,status:200});
  };

  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage),
    replaceGlobal('navigator', { sendBeacon:()=>true }),
    replaceGlobal('document', { getElementById:()=>null }),
    replaceGlobal('fetch', fetchStub),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
    replaceGlobal('Blob', class Blob { constructor(parts=[]){ this.size=parts.join('').length; } }),
  ];

  try {
    const mod = await import('../../src/server_persistence.js');
    mod.attachAutoSync(paneManager);

    assert.equal(typeof callbacks.get('persist'), 'function',
      'autosync must subscribe to PaneManager persist');
    assert.equal((listeners.get('ravtext:engine-rendered') || []).length, 0,
      'modern PaneManager must not depend on rendering');
    assert.equal((listeners.get('ravtext:local-document-saved') || []).length, 1);

    // Local A is immediately recovery-authoritative.
    const sigA = JSON.stringify(content);
    storage.setItem('ravtext.panes.state.v1', sigA);
    listeners.get('ravtext:local-document-saved')[0]({detail:{chars:sigA.length}});
    assert.equal(JSON.parse(storage.getItem('ravtext.doc.serverStale.v1')).status, 'local-ahead');

    // Repeated source changes move only the 2s debounce; the 10s deadline stays.
    callbacks.get('persist')();
    callbacks.get('persist')();
    callbacks.get('persist')();
    assert.deepEqual(timers.delays(), [2000,10000]);

    timers.runOneByDelay(10000);
    await settle();
    assert.equal(fetchCalls.length,1);
    assert.equal(fetchCalls[0].parsed.content.panes[0].content.text,'A');
    assert.equal(storage.getItem('ravtext.doc.serverStale.v1'), null,
      'exact server confirmation should clear local-ahead');

    // B starts a slow network save.
    content = { version:1, panes:[{ id:'main', content:{ text:'B' } }] };
    callbacks.get('persist')();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(fetchCalls.length,2);
    assert.ok(releaseB);

    // C is snapshotted while B is still in flight; it must not overlap B.
    content = { version:1, panes:[{ id:'main', content:{ text:'C' } }] };
    const sigC = JSON.stringify(content);
    storage.setItem('ravtext.panes.state.v1', sigC);
    storage.setItem('ravtext.doc.serverStale.v1', JSON.stringify({
      status:'pagehide-pending', chars:sigC.length, at:Date.now(),
    }));
    callbacks.get('persist')();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(fetchCalls.length,2,'C must wait behind B');

    releaseB();
    await settle(10);
    assert.equal(fetchCalls.length,3);
    assert.equal(fetchCalls[2].parsed.content.panes[0].content.text,'C',
      'queued save must retain immutable C snapshot');
    assert.ok(storage.getItem('ravtext.doc.serverStale.v1'),
      'older B confirmation must not clear C recovery marker');

    releaseC();
    await settle(10);
    assert.equal(storage.getItem('ravtext.doc.serverStale.v1'), null,
      'exact C confirmation should clear recovery marker');

    // Preserve #886: thrown network errors mark stale and do not poison the queue.
    content = { version:1, panes:[{ id:'main', content:{ text:'D' } }] };
    const sigD=JSON.stringify(content);
    storage.setItem('ravtext.panes.state.v1', sigD);
    callbacks.get('persist')();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(fetchCalls.length,4);
    rejectD();
    await settle(10);
    assert.equal(JSON.parse(storage.getItem('ravtext.doc.serverStale.v1')).status,'network-error');

    content = { version:1, panes:[{ id:'main', content:{ text:'E' } }] };
    const sigE=JSON.stringify(content);
    storage.setItem('ravtext.panes.state.v1', sigE);
    callbacks.get('persist')();
    timers.runOneByDelay(2000);
    await settle(10);
    assert.equal(fetchCalls.length,5,'save queue was poisoned after network exception');
    assert.equal(fetchCalls[4].parsed.content.panes[0].content.text,'E');
    assert.equal(storage.getItem('ravtext.doc.serverStale.v1'),null);
  } finally {
    for(const restore of restores.reverse()) restore();
  }
});
