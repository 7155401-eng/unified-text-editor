import test from 'node:test';
import assert from 'node:assert/strict';
import {isTalmudOtherAsMishnaEnabled,setTalmudOtherAsMishnaEnabled} from '../../src/talmud_controls.js';

function storage(initial={}) {
  const map=new Map(Object.entries(initial));
  return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),snapshot:()=>Object.fromEntries(map)};
}
function withStorage(initial,fn){
  const old=globalThis.localStorage,mem=storage(initial);globalThis.localStorage=mem;
  try{return fn(mem);}finally{if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;}
}

test('global Mishnah-wrap ON cannot enable the Talmud-specific switch',()=>withStorage({'ravtext.mishnaWrap':'1','ravtext.talmud.otherAsMishna':'0'},()=>{
  assert.equal(isTalmudOtherAsMishnaEnabled(),false);
}));
test('missing Talmud-specific key is OFF even when the global preference is ON',()=>withStorage({'ravtext.mishnaWrap':'1'},()=>{
  assert.equal(isTalmudOtherAsMishnaEnabled(),false);
}));
test('dedicated Talmud switch controls its own persisted state only',()=>withStorage({'ravtext.mishnaWrap':'1'},mem=>{
  setTalmudOtherAsMishnaEnabled(true);assert.equal(isTalmudOtherAsMishnaEnabled(),true);assert.equal(mem.snapshot()['ravtext.mishnaWrap'],'1');
  setTalmudOtherAsMishnaEnabled(false);assert.equal(isTalmudOtherAsMishnaEnabled(),false);assert.equal(mem.snapshot()['ravtext.mishnaWrap'],'1');
}));
test('dedicated ON works even when unrelated global Mishnah-wrap is OFF',()=>withStorage({'ravtext.mishnaWrap':'0','ravtext.talmud.otherAsMishna':'1'},()=>{
  assert.equal(isTalmudOtherAsMishnaEnabled(),true);
}));
