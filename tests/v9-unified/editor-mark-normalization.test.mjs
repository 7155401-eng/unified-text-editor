import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEditorMark, editorMarksToRunMarks } from '../../src/engine/editor_mark_normalization.js';

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


test('serialized Word marks become the actual run marks consumed by runsFromNode',()=>{
  const marks=[
    {toJSON(){return {type:'textStyle',attrs:{fontFamily:'Word Imported Font',fontSize:'11pt',color:'rgb(12, 34, 56)'}};}},
    {toJSON(){return {type:'bold',attrs:{}};}},
    {toJSON(){return {type:'italic',attrs:{}};}}
  ];
  assert.deepEqual(editorMarksToRunMarks(marks),{
    fontFamily:'Word Imported Font',
    fontSize:'11pt',
    color:'rgb(12, 34, 56)',
    bold:true,
    italic:true
  });
});
