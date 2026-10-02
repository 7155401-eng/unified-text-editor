import test from 'node:test';
import assert from 'node:assert/strict';
import {opticalNiqqudProfileForCluster} from '../../src/engine/runs_dom.js';

for(const cluster of ['ךְ','ךִ','ךֵ','ךֶ','ךַ','ךָ','ךֻ','ךׇ','קְ','קִ','קֵ','קֶ','קַ','קָ','קֻ','קׇ'])
 test(`uniform optical target remains enabled: ${cluster}`,()=>{
   const p=opticalNiqqudProfileForCluster(cluster);assert(p);assert(['ך','ק'].includes(p.base));assert(p.raiseEm>0);
 });
for(const cluster of ['ךֹ','קֹ','ךָּ','קָּ','כָ','ןָ','ףָ','ץָ','שָּׁ',''])
 test(`non-target cluster remains native: ${cluster||'<empty>'}`,()=>assert.equal(opticalNiqqudProfileForCluster(cluster),null));
