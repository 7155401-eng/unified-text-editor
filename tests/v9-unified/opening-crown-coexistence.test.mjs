import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutV9MainParagraphs,rowGeometry} from '../../src/engine/v9_main_inline_layout.js';

// Preservation, not acceptance of the still-open combined-centering request.
// A historical centering proposal shortened an already-wide preceding row.
// Final rows are deliberately excluded from the full-width assertion below.
const sourcePart = p => p ? (p.leadingText || '') + p.text + (p.trailingText || '') : '';
for (const x of [0,27]) for (const boundary of [1.25,9.5,15,19.5])
for (const dropLines of [2,3,4]) for (const count of [7,8,10,12,18]) {
  test(`completed opening preserves wide non-final rows: x=${x}, boundary=${boundary}, drop=${dropLines}, words=${count}`, () => {
    const context = {
      fontSize:10, lineHeight:10,
      describeOpening: entry => entry.id === 'opening'
        ? {position:'dropped',start:0,end:4,marks:{fontSize:20},dropLines,gapPx:2} : null,
      measure: part => {
        const text=String(part.text || '').trim(),n=text ? text.split(/\s+/u).length : 0;
        return {width:text==='OPEN' ? 20 : n ? n*10+(n-1)*2 : 0,height:10,topInset:0};
      },
    };
    const entries = [
      {id:'lead',text:'aa aa aa aa aa aa',runs:[],mainRefs:[]},
      {id:'opening',text:'OPEN '+Array(count).fill('aa').join(' '),
        runs:[{start:5,end:7,marks:{bold:true}}],mainRefs:[]},
    ];
    const strips=[{x:x+50,width:50,y_start:0,y_end:boundary},{x,width:100,y_start:boundary,y_end:200}];
    const before=JSON.stringify({entries,strips});
    const plan=layoutV9MainParagraphs(entries,strips,context,200);
    assert.equal(JSON.stringify({entries,strips}),before,'input mutated');
    assert.equal(plan.overflowText,'');
    for (const entry of entries) {
      const own=plan.lines.filter(l=>l.source.paragraphId===entry.id);
      assert.equal(own.map(l=>l.sourceText).join(''),entry.text);
      for (const line of own) assert.equal(sourcePart(line.render.opening?.part)+sourcePart(line.render.body),line.sourceText);
    }
    const rows=plan.lines.filter(l=>l.source.paragraphId==='opening');
    const host=rows.find(l=>l.render.opening), opening=host?.render.opening;
    assert(opening,'dropped opening was lost or replaced by a raised word');
    assert.equal(rows.filter(l=>l.render.opening).length,1);
    assert(rows.length>1,'fixture must include a non-final row');
    for (const line of rows.filter(l=>!l.isLast && !l.forcedBreak && l.wordTokens.length)) {
      const geometry=rowGeometry(strips,line.y,line.lineHeightPx,200);
      assert(geometry);assert.equal(geometry.width,100,'fixture is not in the full-width region');
      const overlaps=line.y<opening.y+opening.height && line.y+line.lineHeightPx>opening.y;
      const reserved=overlaps ? opening.width+opening.gap : 0;
      assert.equal(line.x,geometry.x,'non-final row displaced');
      assert.equal(line.width+reserved,geometry.width,'centering silently narrowed an earlier full-width row');
      assert(line.naturalWidth<=line.width+1/64,'body no longer fits');
      if(overlaps)assert(line.x+line.width<=opening.x-opening.gap+1/64,'body overlaps its opening');
    }
  });
}
