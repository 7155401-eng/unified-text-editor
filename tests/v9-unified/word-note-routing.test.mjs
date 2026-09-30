import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveWordNoteRouting } from '../../src/word_extractor/word_note_routing.js';

const routes = { '01':'@01', '02':'@02' };

test('starts mode rejects a routing marker found later in note text',()=>{
  assert.deepEqual(
    resolveWordNoteRouting('prefix text @01 actual note', routes, null, {
      markerMatchMode:'starts', skipEmptyNotes:true,
    }),
    { symbol:null, text:'prefix text @01 actual note', marker:null }
  );
});

test('contains mode accepts the same later marker and strips only that marker',()=>{
  assert.deepEqual(
    resolveWordNoteRouting('prefix text @01: actual note', routes, null, {
      markerMatchMode:'contains', skipEmptyNotes:true,
    }),
    { symbol:'@01', text:'prefix text actual note', marker:'01' }
  );
});

test('starts mode accepts leading marker with whitespace and colon',()=>{
  assert.deepEqual(
    resolveWordNoteRouting('   @02 :  note body', routes, null, {
      markerMatchMode:'starts', skipEmptyNotes:true,
    }),
    { symbol:'@02', text:'note body', marker:'02' }
  );
});

test('empty routed notes are omitted together with their body reference',()=>{
  assert.deepEqual(
    resolveWordNoteRouting('@01:   ', routes, null, {
      markerMatchMode:'starts', skipEmptyNotes:true,
    }),
    { symbol:null, text:'', marker:null }
  );
});

test('unmarked route is used only when no @NN exists at all',()=>{
  assert.deepEqual(
    resolveWordNoteRouting('ordinary unmarked note', routes, '@03', {
      markerMatchMode:'contains', skipEmptyNotes:true,
    }),
    { symbol:'@03', text:'ordinary unmarked note', marker:null }
  );
  assert.deepEqual(
    resolveWordNoteRouting('unknown @99 note', routes, '@03', {
      markerMatchMode:'contains', skipEmptyNotes:true,
    }),
    { symbol:null, text:'unknown @99 note', marker:null }
  );
});

test('both Word body paths are wired to the shared router and UI forwards markerMatchMode',async()=>{
  const engine=await readFile(new URL('../../src/word_extractor/word_extractor_engine.js',import.meta.url),'utf8');
  const mammoth=await readFile(new URL('../../src/word_extractor/word_extractor_mammoth.js',import.meta.url),'utf8');
  const dialog=await readFile(new URL('../../src/word_extractor/word_extractor_dialog.js',import.meta.url),'utf8');

  assert.match(engine,/resolveWordNoteRouting\(txt, m2s, nsym/);
  assert.match(mammoth,/resolveWordNoteRouting\(noteText, m2s, nsym/);
  assert.match(mammoth,/markerMatchMode\s*=\s*options\.markerMatchMode/);
  assert.match(dialog,/styleMap:\s*dynamicMap,\s*skipEmptyNotes,\s*markerMatchMode/);
});
