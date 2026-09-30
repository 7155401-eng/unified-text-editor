import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_SEC,
  WEEK_SEC,
  FIFTEEN_MIN_SEC,
  getToolQuotaPolicy,
  isPolicyUnmetered,
  usesLegacyPreflightQuota,
  policyPublicView,
} from '../worker/tool_quota_policy.js';

test('desktop parity: transcription and Word extractor are free-unmetered',()=>{
  assert.equal(isPolicyUnmetered('word-extractor'), true);
  assert.equal(isPolicyUnmetered('torah-transcription'), true);
  assert.equal(usesLegacyPreflightQuota('torah-transcription'), false);
});

test('desktop parity: comparator target is one weekly 15-minute session',()=>{
  const p=getToolQuotaPolicy('comparator-tool');
  assert.equal(p.mode,'session');
  assert.equal(p.limit,1);
  assert.equal(p.windowSeconds,WEEK_SEC);
  assert.equal(p.sessionIdleSeconds,FIFTEEN_MIN_SEC);
  assert.equal(p.chargeOn,'action');
  assert.equal(p.legacyPreflight,true);
});

test('desktop parity: nikud merger and Sefaria target one successful use per week',()=>{
  for(const name of ['nikud-merger','sefaria-downloader','sefaria-live']){
    const p=getToolQuotaPolicy(name);
    assert.equal(p.mode,'count',name);
    assert.equal(p.limit,1,name);
    assert.equal(p.windowSeconds,WEEK_SEC,name);
    assert.equal(p.chargeOn,'success',name);
  }
});

test('desktop parity: Torah nikud is 500 chars per day and caricature is 24h cooldown',()=>{
  const nikud=getToolQuotaPolicy('torah-nikud');
  assert.equal(nikud.mode,'units');
  assert.equal(nikud.limit,500);
  assert.equal(nikud.unit,'chars');
  assert.equal(nikud.windowSeconds,DAY_SEC);

  const caricature=getToolQuotaPolicy('haredi-caricature');
  assert.equal(caricature.mode,'cooldown');
  assert.equal(caricature.cooldownSeconds,DAY_SEC);
});

test('public policy view never exposes migration/source internals',()=>{
  const view=policyPublicView('torah-nikud');
  assert.deepEqual(Object.keys(view).sort(),[
    'chargeOn','cooldownSeconds','limit','migrated','mode',
    'sessionIdleSeconds','toolName','unit','windowSeconds'
  ].sort());
  assert.equal(view.migrated,false);
  assert.equal('source' in view,false);
});
