from pathlib import Path
p=Path('src/engine/v9_main_inline_layout.js');s=p.read_text()
old="""          // A final row that still shares vertical space with a dropped opening
          // must stay adjacent to that opening. Centering the body by itself
          // shifts the visible opening+body composite toward the opening side.
          alignment: isLast && openingWindow ? 'right' : (isLast || forcedBreak ? 'center' : 'right')"""
new="""          // The opening already reserves its width and gap in geometry. A
          // final body row inherits the paragraph's ordinary centering inside
          // that free slot; it is not an independent opening+body composite.
          alignment: isLast || forcedBreak ? 'center' : 'right'"""
assert s.count(old)==1;s=s.replace(old,new)
start=s.index('\n      // Multi-row dropped opening:');end=s.index('\n    }\n    // A following original paragraph',start)
s=s[:start]+"""
      // All other rows retain the opening-aware slot and alignment from emit().
      // Counting the fixed opening again on the final row centers a bounding
      // envelope but pins the actual text to the host's left edge. Only a
      // genuinely one-row paragraph owns the composite centering above.
"""+s[end:];p.write_text(s)

from pathlib import Path
p=Path('tests/v9-unified/spacing-regressions.test.mjs');s=p.read_text()
s=s.replace("test('second and final opening-window row does not center its body as if the opening did not exist'", "test('second and final opening-window row centers within the space reserved beside the opening'")
old=""" assert.equal(last.render.alignment,'right','last body centered independently from dropped opening');
 const opening=host.render.opening;
 const visualLeft=last.x;
 const visualRight=opening.x+opening.width;
 assert(Math.abs((visualLeft+visualRight)/2-50)<.01,
  `opening+last-row visual center=${(visualLeft+visualRight)/2}, expected 50`);"""
new=""" assert.equal(last.render.alignment,'center','last body was pushed to an edge');
 const opening=host.render.opening;
 assert.equal(last.x,0,'last row left its real host');
 assert.equal(last.width,opening.x-opening.gap,'opening reservation was ignored');
 const bodyLeft=last.x+(last.width-last.naturalWidth)/2;
 const bodyRight=bodyLeft+last.naturalWidth;
 assert(Math.abs(bodyLeft-(opening.x-opening.gap-bodyRight))<.01,
  'last row is not centered in the available space beside the opening');
 assert.notEqual(last.openingCompositeCentered,true,'opening counted a second time on the last row');"""
assert s.count(old)==1;s=s.replace(old,new)
s=s.replace("test('final row inside a dropped-opening window centers the complete visual envelope'", "test('final row inside a dropped-opening window keeps normal last-line semantics'")
old=""" assert(last.openingCompositeCentered===true,'final row was not composite-centered');
 const openingRight=host.render.opening.x+host.render.opening.width;
 const visibleCenter=(last.x+openingRight)/2;
 assert(Math.abs(visibleCenter-50)<.001,
  `composite center=${visibleCenter}, bodyX=${last.x}, openingRight=${openingRight}`);
 assert(last.x+last.naturalWidth<=host.render.opening.x-host.render.opening.gap+.001,
  'composite centering overlapped the opening');"""
new=""" assert.equal(last.render.alignment,'center','final body row has special edge alignment');
 assert.notEqual(last.openingCompositeCentered,true,'the opening is not owned by this row');
 const freeRight=host.render.opening.x-host.render.opening.gap;
 assert.equal(last.x,0);
 assert(Math.abs(last.width-freeRight)<.001,'last row did not retain its full opening-aware slot');
 const bodyLeft=last.x+(last.width-last.naturalWidth)/2;
 assert(Math.abs((bodyLeft+last.naturalWidth/2)-freeRight/2)<.001,
  'last body row is not centered inside the free slot');
 assert(bodyLeft+last.naturalWidth<=freeRight+.001,'last body overlaps the opening');"""
assert s.count(old)==1;s=s.replace(old,new);p.write_text(s)
p=Path('tests/v9-unified/browser-spacing-regressions.js');s=p.read_text()
start=s.index("  await test('opening-window final row centers actual opening+body ink as one visual segment'")
end=s.index("  await test('legacy audit: heavy mixed pagination",start)
replacement="""  // User-reported regression: counting a dropped opening again on row two
  // centered a bounding envelope, but pinned the actual final text to the left.
  // The opening reserves space; the final body inherits ordinary centering.
  for(const family of ['serif','sans-serif','monospace'])
  for(const dropLines of [2,3,4])
  for(const hostX of [0,19])
  await test(`opening-window final body is centered: ${family}, drop=${dropLines}, x=${hostX}`,()=>{
    const context=createV9TextLayoutContext({
      mainFontSize:10,mainFontFamily:family,lineHeightRatio:1,
      openingWordSettings:{enabled:true,target:'word',count:1,font:family,size:200,weight:'bold',
        position:'dropped',dropLines,spaceAfter:0.2,scope:'all',
        skipHeadings:false,skipSingleLine:false,skipShortLine:false,skipFewerThanLines:false,minLines:1}
    });
    const page=makePage();
    try{
      let plan=null,source='';
      for(let words=4;words<=24;words++){
        const text='פתיח '+Array(words).fill('אב').join(' ');
        const entry=context.prepareEntry({id:'ink-center',index:1,text,runs:[],mainRefs:[],continues:false});
        const candidate=layoutV9MainParagraphs([entry],[{x:hostX,width:100,y_start:0,y_end:150}],context,150);
        if(candidate.lines.length===2 && candidate.lines[1].isLast && candidate.lines[1].openingWindow){plan=candidate;source=text;break;}
      }
      assert(plan,'fixture did not produce a two-row paragraph ending inside the opening window');
      const before=JSON.stringify(plan);
      page.style.width='150px';page.style.height='150px';page.style.padding='0';
      for(const line of plan.lines)renderV9PlannedMainLine(line,page,0);
      assert(JSON.stringify(plan)===before,'renderer rewrote planned geometry');
      assert(sourceText(page)===source,'source characters were changed');
      assert(page.querySelectorAll('.v9-opening-glyph').length===1,'opening lost or duplicated');

      const last=plan.lines.at(-1),openingPlan=plan.lines[0].render.opening;
      const rows=[...page.querySelectorAll('.v9-final-main-line')];
      const opening=page.querySelector('.v9-opening-glyph');
      const body=rows.at(-1)?.querySelector('.v9-planned-line-text');
      assert(opening&&body,'rendered fixture is incomplete');
      assert(last.render.alignment==='center','final row is not centered');
      assert(!last.openingCompositeCentered,'opening was counted twice');
      assert(last.render.wordSpacing===0,'final row was stretched');
      assert(Math.abs(last.width-(openingPlan.x-openingPlan.gap-hostX))<.01,
        'planner did not reserve the opening and its gap in the final row');

      const pageRect=page.getBoundingClientRect();
      const openingRect=opening.getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(body);
      const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
      assert(rects.length,'final body has no measurable ink');
      const left=Math.min(...rects.map(r=>r.left));
      const right=Math.max(...rects.map(r=>r.right));
      const freeLeft=pageRect.left+page.clientLeft+hostX;
      const freeRight=openingRect.left-openingPlan.gap;
      const expectedCenter=(freeLeft+freeRight)/2;
      const actualCenter=(left+right)/2;
      assert(Math.abs(actualCenter-expectedCenter)<=.6,
        `final body not centered: actual=${actualCenter}, expected=${expectedCenter}`);
      assert(left>=freeLeft-.6 && right<=freeRight+.6,'final text overlaps the opening or leaves the host');
      return {actualCenter,expectedCenter,freeWidth:freeRight-freeLeft};
    }finally{context.dispose();page.remove();}
  });

"""
s=s[:start]+replacement+s[end:];p.write_text(s)

Path('tests/v9-unified/opening-final-line-centering.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';

const context = (dropLines = 2) => ({
  fontSize: 10, lineHeight: 10,
  describeOpening: () => ({ position: 'dropped', start: 0, end: 4, marks: {fontSize: 20}, dropLines, gapPx: 2 }),
  measure: part => {
    const text = String(part.text || '').trim();
    if (text === 'OPEN') return {width: 20, height: 10, topInset: 0};
    const words = text ? text.split(/\s+/u).length : 0;
    return {width: words ? words * 10 + (words - 1) * 2 : 0, height: 10, topInset: 0};
  },
});
function plan(text, {x = 0, width = 100, dropLines = 2, continuesAfter = false, strips} = {}) {
  const entry = {id: 'one-source-paragraph', text, runs: [{start: 5, end: 7, marks: {bold: true}}], mainRefs: [], continuesAfter};
  const before = JSON.stringify(entry);
  const result = layoutV9MainParagraphs([entry], strips || [{x, width, y_start: 0, y_end: 200}], context(dropLines), 200);
  assert.equal(result.overflowText, '');
  assert.equal(result.lines.map(l => l.sourceText).join(''), text, 'source changed');
  assert.equal(JSON.stringify(entry), before, 'source entry mutated');
  assert.equal(result.lines.filter(l => l.render.opening).length, 1, 'opening lost or duplicated');
  for (const line of result.lines) assert.equal(line.source.paragraphId, entry.id, 'artificial paragraph created');
  return result;
}

for (const x of [0, 27]) for (const dropLines of [2, 3, 4]) for (const newline of ['', '\n']) {
  test(`last body row stays centered in opening-aware free space: x=${x}, drop=${dropLines}, hardBreak=${!!newline}`, () => {
    const result = plan('OPEN aa aa aa aa aa aa aa' + newline, {x, dropLines});
    assert.equal(result.lines.length, 2);
    const [first, last] = result.lines;
    assert.equal(last.isLast, true);
    assert.equal(last.openingWindow, true);
    assert.equal(last.render.alignment, 'center', 'final row inherited a special edge-alignment rule');
    assert.equal(last.x, x);
    assert.equal(last.width, 78, 'body slot must exclude the 20px opening plus its 2px gap');
    assert.equal(last.naturalWidth, 10);
    assert.equal(last.render.wordSpacing, 0, 'final row must not be stretched');
    assert.notEqual(last.openingCompositeCentered, true, 'opening painted on a previous row was counted again');
    const left = last.x + (last.width - last.naturalWidth) / 2;
    const right = left + last.naturalWidth;
    assert.equal(left - x, first.render.opening.x - first.render.opening.gap - right,
      'the free space on both sides of the last body must be equal');
    assert.equal(first.render.opening.x, x + 80, 'centering moved the opening away from its original row');
  });
}

test('a genuinely one-row paragraph still centers opening + gap + body together', () => {
  const result = plan('OPEN aa');
  assert.equal(result.lines.length, 1);
  const line = result.lines[0];
  assert.equal(line.openingCompositeCentered, true);
  assert.equal(line.x, 34);
  assert.equal(line.width, 10);
  assert.equal(line.render.opening.x, 46);
  assert.equal((line.x + line.render.opening.x + line.render.opening.width) / 2, 50);
});

test('last opening-window row uses the widened free slot, not stale narrow geometry', () => {
  const result = plan('OPEN aa aa aa aa aa aa aa', {dropLines: 3, strips: [
    {x: 50, width: 50, y_start: 0, y_end: 15},
    {x: 0, width: 100, y_start: 15, y_end: 200},
  ]});
  assert.equal(result.lines.length, 3);
  const last = result.lines.at(-1);
  assert.equal(last.y, 20);
  assert.equal(last.openingWindow, true);
  assert.equal(last.render.alignment, 'center');
  assert.equal(last.x, 0);
  assert.equal(last.width, 78);
  assert.equal(result.lines[0].render.opening.x, 80);
});

test('final row below the opening centers across the complete host', () => {
  const result = plan('OPEN ' + Array(15).fill('aa').join(' '));
  const last = result.lines.at(-1);
  assert.equal(last.openingWindow, false);
  assert.equal(last.render.alignment, 'center');
  assert.equal(last.width, 100);
});

test('an artificial page continuation is not promoted into a centered paragraph ending', () => {
  const result = plan('OPEN aa aa aa aa aa aa aa', {continuesAfter: true});
  const last = result.lines.at(-1);
  assert.equal(last.isLast, false);
  assert.equal(last.render.alignment, 'right');
  assert.notEqual(last.openingCompositeCentered, true);
});
''')
