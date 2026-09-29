import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEditorMark } from '../../src/engine/editor_mark_normalization.js';

test('serialized Word textStyle mark survives editor bridge normalization',()=>{
  const mark={toJSON(){return {type:'textStyle',attrs:{fontFamily:'Word Imported Font',fontSize:'11pt',color:'rgb(12, 34, 56)'}};}};
  assert.deepEqual(normalizeEditorMark(mark),{
    name:'textStyle',
    attrs:{fontFamily:'Word Imported Font',fontSize:'11pt',color:'rgb(12, 34, 56)'}
  });
});

test('serialized bold mark survives editor bridge normalization',()=>{
  const mark={toJSON(){return {type:'bold',attrs:{}};}};
  assert.equal(normalizeEditorMark(mark).name,'bold');
});

test('live mark attributes override serialized fallback attributes',()=>{
  const mark={
    type:{name:'textStyle'},
    attrs:{fontFamily:'Live Font'},
    toJSON(){return {type:'textStyle',attrs:{fontFamily:'Serialized Font',fontSize:'10pt'}};}
  };
  assert.deepEqual(normalizeEditorMark(mark),{
    name:'textStyle',
    attrs:{fontFamily:'Live Font',fontSize:'10pt'}
  });
});
