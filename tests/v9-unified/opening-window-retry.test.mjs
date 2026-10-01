import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutV9MainParagraphs} from '../../src/engine/v9_main_inline_layout.js';

function context(dropLines=3, openingWidth=40) {
  return {
    fontSize:10,lineHeight:10,
    describeOpening:e=>e.id==='opening'?{start:0,end:4,marks:{fontSize:20},position:'dropped',dropLines,gapPx:2}:null,
    measure:part=>{
      const words=part.text.trim().split(/\s+/u).filter(Boolean);
      return {width:part.text==='OPEN'?openingWidth:words.reduce((n,w)=>n+w.length*5,0)+Math.max(0,words.length-1)*2,height:10,topInset:0};
    },
  };
}
function plan({boundary=10,dropLines=3,width=40,text='OPEN aa bb cc dd ee ff gg hh ii jj',pageBottom=100,continuesAfter=false,shift=0}={}) {
  const refs=[{uid:'h',anchor:5,formatted:''},{uid:'v',anchor:text.length,formatted:'[1]'}];
  const entry={id:'opening',text,runs:[{start:5,end:7,marks:{bold:true}}],mainRefs:refs,continuesAfter};
  const strips=[{x:shift+50,width:50,y_start:0,y_end:boundary},{x:shift,width:100,y_start:boundary,y_end:pageBottom}];
  const input=JSON.stringify({entry,strips});
  const result=layoutV9MainParagraphs([entry],strips,context(dropLines,width),pageBottom);
  assert.equal(JSON.stringify({entry,strips}),input,'source/runs/refs or strips were mutated');
  assert.equal(result.lines.map(l=>l.sourceText).join('')+result.overflowText,text,'source lost, duplicated or reordered');
  assert.equal(result.lines.filter(l=>l.render.opening).length,1,'opening lost or duplicated');
  const paintedRefs=result.lines.flatMap(l=>[...(l.render.opening?.part.refs||[]),...l.render.body.refs]);
  const overflowRefs=result.overflowParagraphs.flatMap(e=>e.mainRefs);
  assert.deepEqual([...paintedRefs,...overflowRefs].map(r=>r.uid).sort(),['h','v'],'reference ownership changed');
  return result;
}
for(const boundary of [1.25,9.5,10,10.25,19.5]) for(const dropLines of [2,3,4]) for(const shift of [0,27]) {
  test(`fill newly available opening-window row: boundary=${boundary}, drop=${dropLines}, x=${shift}`,()=>{
    const result=plan({boundary,dropLines,shift});
    const body=result.lines.filter(l=>l.wordTokens.length);
    const expected=Math.min(Math.ceil(boundary/10)*10,dropLines*10);
    assert.equal(body[0].y,expected,'body skipped free rows inside the opening window');
    assert.equal(body[0].x,shift);
    assert.equal(body[0].width,expected<dropLines*10?58:100,'body did not use the actual free width');
    const opening=result.lines[0].render.opening;
    assert.equal(opening.x,shift+60);assert.equal(opening.width,40);
    assert.equal(opening.height,dropLines*10);assert.equal(opening.gap,2);
    for(let i=1;i<body.length;i++)assert.equal(body[i].y,body[i-1].y+body[i-1].lineHeightPx,'new gap after retry');
  });
}

test('a later long source word retries after an earlier body row was already painted',()=>{
  const result=plan({boundary:20,dropLines:4,width:30,text:'OPEN aa LONGWORD bb cc dd ee ff'});
  const body=result.lines.filter(l=>l.wordTokens.length);
  assert.equal(body[0].y,0);assert.equal(body[0].render.body.text,'aa');
  assert.equal(body[1].y,20,'later source word skipped the widened window');
  assert.equal(body[1].wordTokens[0].text,'LONGWORD','unbreakable source word was split');
  assert.equal(body[1].width,68);
});

test('widening rows can retain the whole paragraph on a short page',()=>{
  const result=plan({pageBottom:30,text:'OPEN aa bb cc dd ee ff gg hh'});
  assert.equal(result.overflowText,'','usable rows were left empty while the body went to the next page');
  assert.deepEqual(result.lines.map(l=>l.y),[0,10,20]);
});

test('continuation remains a continuation; final row is not falsely centered',()=>{
  const result=plan({pageBottom:30,text:'OPEN aa bb cc dd ee ff gg hh',continuesAfter:true});
  assert.equal(result.overflowText,'');
  const last=result.lines.at(-1);
  assert.equal(last.isLast,false);assert.equal(last.render.alignment,'right');
});

test('unchanged narrow geometry still falls back below the opening',()=>{
  const result=plan({boundary:60});
  assert.equal(result.lines.find(l=>l.wordTokens.length).y,30);
  assert.deepEqual(result.diagnostics,[{code:'opening-body-below',paragraphId:'opening'}]);
});

test('an insufficient widening does not split or squeeze the first body word',()=>{
  const result=plan({text:'OPEN ABCDEFGHIJKL aa bb'});
  // 60px source word cannot enter the 58px window; it needs full-width space.
  assert.equal(result.lines.find(l=>l.wordTokens.length).y,30);
  assert.equal(result.lines.find(l=>l.wordTokens.length).wordTokens[0].text,'ABCDEFGHIJKL');
});

test('a crossing row stays narrow; retry is on the next complete wide row',()=>{
  const result=plan({boundary:15,dropLines:4});
  assert.equal(result.lines.find(l=>l.wordTokens.length).y,20);
});
