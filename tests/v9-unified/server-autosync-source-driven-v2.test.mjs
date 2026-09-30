import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAutoSync } from '../../src/server_persistence.js';

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
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
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
    clearTimeout(id) {
      active.delete(id);
    },
    delays() {
      return [...active.values()].map(x => x.delay).sort((a,b)=>a-b);
    },
    runOneByDelay(delay) {
      const hit=[...active.entries()].find(([,x])=>x.delay===delay);
      assert.ok(hit, 'missing active timer for '+delay);
      const [id,entry]=hit;
      active.delete(id);
      entry.fn();
    },
  };
}

async function settle(times=4) {
  for(let i=0;i<times;i++) await Promise.resolve();
}

test('source-driven server autosync has max-wait, immutable snapshots, and serialized PUTs', async () => {
  const timers=fakeTimers();
  const storage=fakeStorage();
  const listeners=new Map();
  const windowStub={
    __RAVTEXT_AUTH__:{loggedIn:true},
    addEventListener(type,fn){
      if(!listeners.has(type))listeners.set(type,[]);
      listeners.get(type).push(fn);
    },
    dispatchEvent(){},
  };

  const callbacks=new Map();
  let content={version:1,panes:[{id:'main',content:{text:'A'}}]};
  const paneManager={
    on(type,fn){callbacks.set(type,fn);},
    serializeForPersistence(){return structuredClone(content);},
    flushSave(){},
  };

  const fetchCalls=[];
  let releaseB=null,releaseC=null;
  const fetchStub=(url,init={})=>{
    const parsed=JSON.parse(init.body||'{}');
    fetchCalls.push({url:String(url),init,parsed});
    if(fetchCalls.length===2){
      return new Promise(resolve=>{releaseB=()=>resolve({ok:true,status:200});});
    }
    if(fetchCalls.length===3){
      return new Promise(resolve=>{releaseC=()=>resolve({ok:true,status:200});});
    }
    return Promise.resolve({ok:true,status:200});
  };

  const restores=[
    replaceGlobal('window',windowStub),
    replaceGlobal('localStorage',storage),
    replaceGlobal('navigator',{sendBeacon:()=>true}),
    replaceGlobal('document',{getElementById:()=>null}),
    replaceGlobal('fetch',fetchStub),
    replaceGlobal('setTimeout',timers.setTimeout),
    replaceGlobal('clearTimeout',timers.clearTimeout),
  ];

  try {
    attachAutoSync(paneManager);

    assert.equal(typeof callbacks.get('persist'),'function',
      'autosync must subscribe directly to PaneManager persist');
    assert.equal((listeners.get('ravtext:engine-rendered')||[]).length,0,
      'modern PaneManager must not depend on render completion');
    assert.equal((listeners.get('ravtext:local-document-saved')||[]).length,1,
      'local snapshot recovery listener missing');

    const paneSource=await import('node:fs/promises').then(({readFile})=>
      readFile(new URL('../../src/pane_manager.js',import.meta.url),'utf8'));
    assert.match(paneSource,/this\._emit\("persist"\)/,
      'PaneManager save path must emit semantic persist');
    assert.match(paneSource,/ravtext:local-document-saved/,
      'successful local storage write must announce snapshot');

    // Local snapshot A is newer than last confirmed server signature.
    storage.setItem('ravtext.panes.state.v1',JSON.stringify(content));
    listeners.get('ravtext:local-document-saved')[0]({detail:{chars:10}});
    assert.equal(JSON.parse(storage.getItem('ravtext.doc.serverStale.v1')).status,'local-ahead');

    // Continuous edits: trailing debounce moves, max-wait does not.
    callbacks.get('persist')();
    callbacks.get('persist')();
    callbacks.get('persist')();
    assert.deepEqual(timers.delays(),[2000,10000]);

    timers.runOneByDelay(10000);
    await settle();
    assert.equal(fetchCalls.length,1);
    assert.equal(fetchCalls[0].url,'/api/documents/current');
    assert.equal(fetchCalls[0].parsed.content.panes[0].content.text,'A');
    assert.equal(storage.getItem('ravtext.doc.serverStale.v1'),null,
      'confirmed current local snapshot should clear recovery state');

    // B starts a slow PUT.
    content={version:1,panes:[{id:'main',content:{text:'B'}}]};
    storage.setItem('ravtext.panes.state.v1',JSON.stringify(content));
    listeners.get('ravtext:local-document-saved')[0]({detail:{chars:10}});
    callbacks.get('persist')();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(fetchCalls.length,2);
    assert.ok(releaseB);

    // C is captured while B is in flight. It must queue, not overlap.
    content={version:1,panes:[{id:'main',content:{text:'C'}}]};
    storage.setItem('ravtext.panes.state.v1',JSON.stringify(content));
    listeners.get('ravtext:local-document-saved')[0]({detail:{chars:10}});
    callbacks.get('persist')();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(fetchCalls.length,2,'C PUT overlapped slow B');

    releaseB();
    await settle(6);
    assert.equal(fetchCalls.length,3,'C did not start after B completed');
    assert.equal(fetchCalls[2].parsed.content.panes[0].content.text,'C',
      'queued immutable snapshot was not C');
    assert.ok(storage.getItem('ravtext.doc.serverStale.v1'),
      'older B success cleared newer C recovery marker');
    assert.ok(releaseC);

    releaseC();
    await settle(6);
    assert.equal(storage.getItem('ravtext.doc.serverStale.v1'),null,
      'confirmed latest C snapshot did not clear recovery marker');
  } finally {
    for(const restore of restores.reverse()) restore();
  }
});
