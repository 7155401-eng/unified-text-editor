import test from 'node:test';
import assert from 'node:assert/strict';
import {groupV9FooterStreams} from '../../src/engine/v9_footer_grouping.js';
const streams=(...ids)=>ids.map(id=>({id,items:[`source-${id}`]}));
for(const fixed of [['01','02'],['02','01'],['01']])for(const active of [['03','04'],['04','03'],['03'],['04']]){
 test(`footer-only first level retains fixed ownership: ${fixed}/${active}`,()=>{
  const input=streams(...active),levels=[['03','04']],snapshot=JSON.stringify({input,levels,fixed});
  const groups=groupV9FooterStreams(input,{},levels,true,fixed);
  assert.equal(groups.length,1);assert.equal(groups[0].level,0);
  assert.equal(groups[0].mishnaFlow,true);assert.equal(groups[0].source,'levels');
  assert.deepEqual(groups[0].streams,input);assert.equal(JSON.stringify({input,levels,fixed}),snapshot);
 });
}
for(const fixed of [[],null,undefined,{},[''],[null]])test(`without usable fixed ownership preserve reserved first level: ${JSON.stringify(fixed)}`,()=>{
 const groups=groupV9FooterStreams(streams('03','04'),{},[['03','04']],true,fixed);
 assert.equal(groups.length,2);assert(groups.every(g=>!g.mishnaFlow));
});
for(const on of [false,undefined])test(`stored first level cannot enable a disabled global mode: ${on}`,()=>{
 const groups=groupV9FooterStreams(streams('03','04'),{},[['03','04']],on,['01','02']);
 assert.equal(groups.length,2);assert(groups.every(g=>!g.mishnaFlow));
});
for(const first of [['01','02'],['01','03'],['02','04']])test(`a first level mentioning an owned side stays reserved: ${first}`,()=>{
 const groups=groupV9FooterStreams(streams('03','04'),{},[first],true,['01','02']);
 assert.equal(groups.length,2);assert(groups.every(g=>!g.mishnaFlow));
});
test('preserve configured group order and streams outside levels',()=>{
 const groups=groupV9FooterStreams(streams('03','05','04','06','07'),{},[['03','04'],['05','06']],true,['01','02']);
 assert.deepEqual(groups.map(g=>[g.level,g.streams.map(s=>s.id)]),[[0,['03','04']],[1,['05','06']],[-1,['07']]]);
});
test('existing expanded levels keep their original index and interpretation',()=>{
 const groups=groupV9FooterStreams(streams('03','04'),{},[['01','02'],['03','04']],true,['01','02']);
 assert.deepEqual(groups.map(g=>[g.level,g.mishnaFlow,g.source]),[[1,true,'levels']]);
});
test('explicit per-stream pair still works with no stored global levels',()=>{
 const groups=groupV9FooterStreams(streams('03','04'),{'03':{layoutRole:'mishna'},'04':{layoutRole:'mishna'}},[],false,['01','02']);
 assert.deepEqual(groups.map(g=>[g.level,g.source]),[[-1,'layoutRole']]);
});
test('do not activate a non-existent pair or promote it into a side',()=>{
 const groups=groupV9FooterStreams(streams('05'),{},[['03','04']],true,['01','02']);
 assert.deepEqual(groups.map(g=>[g.level,g.mishnaFlow,g.streams[0].id]),[[-1,false,'05']]);
});
test('ignore extra IDs beyond the two fixed side owners just like aggregation',()=>{
 const groups=groupV9FooterStreams(streams('03','04'),{},[['03','04']],true,['01','02','03']);
 assert.equal(groups[0].level,0);assert.equal(groups.length,1);
});
