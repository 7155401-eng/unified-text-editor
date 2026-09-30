import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGlobalLineBreakCode, globalLineBreakSettingsSignature } from '../../src/engine/global_line_break_code.js';
import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';

const on = code => ({ globalLineBreakCodeEnabled:true, globalLineBreakCode:code });

test('B8 literal code becomes one newline and remaps runs plus anchors through one boundary map', () => {
  const raw='aa<<br>>bb@01cc';
  const markerAt=raw.indexOf('@01');
  const runStart=raw.indexOf('bb');
  const result=applyGlobalLineBreakCode({
    text:raw,
    runs:[{start:runStart,end:runStart+2,marks:{bold:true}}],
    positions:[markerAt],
    settings:on('<<br>>'),
    protectedLiterals:['@01'],
  });
  assert.equal(result.text,'aa\nbb@01cc');
  assert.equal(result.replacements,1);
  assert.equal(result.positions[0],result.text.indexOf('@01'));
  assert.equal(result.text.slice(result.runs[0].start,result.runs[0].end),'bb');
  assert.deepEqual(result.runs[0].marks,{bold:true});
});

test('B8 protects active stream symbols even if the configured break code matches them', () => {
  const result=applyGlobalLineBreakCode({
    text:'alpha@01beta',
    settings:on('@01'),
    protectedLiterals:['@01'],
  });
  assert.equal(result.text,'alpha@01beta');
  assert.equal(result.replacements,0);
});

test('B8 disabled setting is source-preserving and its cache signature changes when enabled', () => {
  const off={globalLineBreakCodeEnabled:false,globalLineBreakCode:'<brk>'};
  const input='alpha<brk>beta';
  assert.equal(applyGlobalLineBreakCode({text:input,settings:off}).text,input);
  assert.notEqual(globalLineBreakSettingsSignature(off),globalLineBreakSettingsSignature(on('<brk>')));
});

test('B8 transformed newline is consumed by V9 as a forced visual line break', () => {
  const transformed=applyGlobalLineBreakCode({
    text:'alpha<lb>beta gamma',
    settings:on('<lb>'),
  }).text;
  const context={
    fontSize:10,
    lineHeight:10,
    describeOpening:()=>null,
    measure:part=>({width:part.text.length*5,height:10,topInset:0}),
  };
  const planned=layoutV9MainParagraphs(
    [{id:'b8',text:transformed,runs:[],mainRefs:[]}],
    [{x:0,width:200,y_start:0,y_end:100}],
    context,
    100
  );
  assert.deepEqual(planned.lines.map(l=>l.render.body.text),['alpha','beta gamma']);
  assert.equal(planned.lines[0].forcedBreak,true);
  assert.equal(planned.lines.map(l=>l.sourceText).join(''),transformed);
});
