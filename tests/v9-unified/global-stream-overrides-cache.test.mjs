import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k,v])=>[String(k),String(v)]));
  return {
    getItem(k){ return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k,v){ data.set(String(k),String(v)); },
    removeItem(k){ data.delete(String(k)); },
    setRaw(k,v){ if(v==null)data.delete(String(k)); else data.set(String(k),String(v)); },
    getRaw(k){ return data.has(String(k)) ? data.get(String(k)) : null; },
  };
}

test('global override snapshot reparses only when persisted raw value changes', async()=>{
  const prevStorage=globalThis.localStorage, prevWindow=globalThis.window;
  const storage=fakeStorage({
    'ravtext.globalStreamOverrides.v1':JSON.stringify({
      cols:{enabled:true,value:2},
      titleShow:{enabled:true,value:false},
    }),
    'ravtext.streamSettings.v1':'{}',
  });
  globalThis.localStorage=storage;
  globalThis.window={localStorage:storage,addEventListener(){},removeEventListener(){},dispatchEvent(){},__STREAM_SETTINGS__:{}};

  try {
    const mod=await import('../../src/original_stream_columns.js');
    const nativeParse=JSON.parse;
    let parseCount=0;
    JSON.parse=(...args)=>{parseCount++;return nativeParse(...args);};
    try {
      const first=mod.getGlobalStreamOverridesSnapshot();
      const afterFirst=parseCount;
      assert.equal(first.cols.value,2);
      assert.equal(first.titleShow.value,false);
      assert(Object.isFrozen(first));
      assert(Object.isFrozen(first.cols));

      for(let i=0;i<1000;i++) assert.strictEqual(mod.getGlobalStreamOverridesSnapshot(),first);
      assert.equal(parseCount,afterFirst,'unchanged snapshot reparsed');

      const editable=mod.loadGlobalStreamOverrides();
      editable.cols.value=6;
      editable.cols.enabled=false;
      assert.equal(first.cols.value,2);
      assert.equal(first.cols.enabled,true);
      assert.equal(mod.loadGlobalStreamOverrides().cols.value,2,'UI copy poisoned immutable cache');

      const beforeHotPath=parseCount;
      for(let i=0;i<1000;i++) {
        const effective=mod.getEffectiveStreamSettings('01');
        assert.equal(effective.cols,2);
        assert.equal(effective.titleShow,false);
      }
      assert.equal(parseCount,beforeHotPath,'effective-settings hot path reparsed unchanged overrides');

      storage.setRaw('ravtext.globalStreamOverrides.v1',JSON.stringify({
        cols:{enabled:true,value:4},
        titleShow:{enabled:false,value:true},
      }));
      const changed=mod.getGlobalStreamOverridesSnapshot();
      assert.notStrictEqual(changed,first);
      assert.equal(changed.cols.value,4);
      assert.equal(changed.titleShow.enabled,false);

      const afterChanged=parseCount;
      assert.strictEqual(mod.getGlobalStreamOverridesSnapshot(),changed);
      assert.equal(parseCount,afterChanged,'unchanged direct same-tab write reparsed twice');

      storage.setRaw('ravtext.globalStreamOverrides.v1','{bad json');
      const invalid=mod.getGlobalStreamOverridesSnapshot();
      assert.equal(invalid.cols.enabled,false);
      assert.equal(invalid.cols.value,1);
      const afterInvalid=parseCount;
      assert.strictEqual(mod.getGlobalStreamOverridesSnapshot(),invalid);
      assert.equal(parseCount,afterInvalid,'same invalid raw value reparsed repeatedly');

      const beforeSave=parseCount;
      mod.saveGlobalStreamOverrides({
        cols:{enabled:true,value:5},
        titleShow:{enabled:true,value:false},
      });
      const afterSave=mod.getGlobalStreamOverridesSnapshot();
      assert.equal(afterSave.cols.value,5);
      assert.equal(afterSave.titleShow.value,false);
      assert.equal(parseCount,beforeSave,'save path failed to seed cache');
      assert.match(storage.getRaw('ravtext.globalStreamOverrides.v1'),/"value":5/);
    } finally {
      JSON.parse=nativeParse;
    }
  } finally {
    if(prevStorage===undefined) delete globalThis.localStorage; else globalThis.localStorage=prevStorage;
    if(prevWindow===undefined) delete globalThis.window; else globalThis.window=prevWindow;
  }
});
