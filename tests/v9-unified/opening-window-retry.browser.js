import {createV9TextLayoutContext,renderV9PlannedMainLine} from '../../src/engine/v9_text_measurement.js';
import {layoutV9MainParagraphs,partForRange} from '../../src/engine/v9_main_inline_layout.js';
import {runSplitCrownChecks,runShortStreamGridChecks} from './split-crown-rich.browser.js';

const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const sourceOf=el=>{const copy=el.cloneNode(true);copy.querySelectorAll('[data-v9-main-ref]').forEach(n=>n.remove());return copy.textContent;};

export function runOpeningWindowRetryChecks() {
  const results=[];
  for(const family of ['serif','sans-serif','monospace'])for(const dropLines of [2,3,4])
  for(const boundaryRows of [.25,.95,1,1.05,1.8,2.2])for(const shift of [0,19]) {
    const name=`${family}/drop=${dropLines}/boundary=${boundaryRows}/x=${shift}`;
    const context=createV9TextLayoutContext({mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,
      openingWordSettings:{enabled:true,target:'word',count:1,font:'inherit',size:200,weight:'bold',
        position:'dropped',dropLines,spaceAfter:.2,scope:'all',skipHeadings:false,
        skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false,minLines:1}});
    const page=document.createElement('div');page.style.cssText='position:relative;margin:0;padding:0;border:0;';document.body.append(page);
    try {
      const text='פתיח אלפא ביתא גמא דלתא אפסילון זיתא תיטא יוטא למדה';
      const entry=context.prepareEntry({id:'opening-retry',text,
        runs:[{start:5,end:9,marks:{bold:true,color:'rgb(31,47,67)'}}],
        mainRefs:[{uid:'hidden',anchor:6,formatted:''},{uid:'visible',anchor:text.length,formatted:'[7]',cssText:'font-size:10px;vertical-align:super'}]});
      const desc=context.describeOpening(entry),opening=partForRange(entry,0,desc.end);
      opening.runs=[...opening.runs,{start:desc.start,end:desc.end,marks:desc.marks}];
      const m=context.measure(opening),firstWord=context.measure(partForRange(entry,desc.end,9,10));
      const narrow=m.width+desc.gapPx+firstWord.width*.4;
      const wide=narrow+Math.max(100,firstWord.width*2);
      const pitch=context.lineHeight,boundary=boundaryRows*pitch;
      const height=Math.max(pitch*dropLines,m.height);
      const strips=[{x:shift+wide-narrow,width:narrow,y_start:0,y_end:boundary},
        {x:shift,width:wide,y_start:boundary,y_end:600}];
      const before=JSON.stringify({entry,strips});
      const plan=layoutV9MainParagraphs([entry],strips,context,600);
      const frozen=JSON.stringify(plan);
      page.style.width=`${shift+wide+20}px`;page.style.height='600px';
      for(const line of plan.lines)renderV9PlannedMainLine(line,page,0);
      const body=plan.lines.filter(l=>l.wordTokens.length),first=body[0];
      const expected=Math.min(Math.ceil(boundary/pitch)*pitch,height);
      assert(first, 'body missing');
      assert(first.y===expected,`body begins at ${first.y}, first usable row is ${expected}`);
      assert(!plan.overflowText,'body unexpectedly overflowed a tall page');
      assert(sourceOf(page)===text,'paint changed source text or whitespace');
      assert(plan.lines.map(l=>l.sourceText).join('')===text,'planner changed source');
      assert(JSON.stringify({entry,strips})===before,'input/anchors mutated');
      assert(JSON.stringify(plan)===frozen,'painter changed the plan');
      const glyph=page.querySelector('.v9-opening-glyph');
      assert(page.querySelectorAll('.v9-opening-glyph').length===1,'opening lost/duplicated');
      assert(page.querySelectorAll('[data-v9-main-ref]').length===1,'hidden marker displayed or visible marker lost');
      assert(plan.lines[0].render.opening.width===m.width,'opening width changed');
      assert(plan.lines[0].render.opening.height===height,'opening window changed');
      assert(plan.lines[0].render.opening.x===shift+wide-m.width,'opening moved off the right edge');
      const hostWidth=first.y<boundary-1/64?narrow:wide;
      assert(Math.abs(first.width-(hostWidth-(first.y<height?m.width+desc.gapPx:0)))<.02,'newly freed width not used');
      const pageRect=page.getBoundingClientRect(),openingRect=glyph.getBoundingClientRect();
      for(let i=0;i<body.length;i++) {
        const line=body[i];
        if(i>0)assert(Math.abs(line.y-body[i-1].y-body[i-1].lineHeightPx)<.02,'empty row added after re-entry');
        assert(line.naturalWidth<=line.width+.02,'unbreakable text squeezed into insufficient width');
        const element=[...page.querySelectorAll('.v9-final-main-line')][plan.lines.indexOf(line)].querySelector('.v9-planned-line-text');
        const range=document.createRange();range.selectNodeContents(element);
        const rect=range.getBoundingClientRect();
        const left=rect.left-pageRect.left,right=rect.right-pageRect.left;
        assert(left>=line.x-.8&&right<=line.x+line.width+.8,'paint exceeded planned horizontal limits');
        if(line.y<height)assert(right<=openingRect.left-pageRect.left-desc.gapPx+.8,'text overlaps the opening');
        if(!line.isLast&&!line.forcedBreak&&!line.tailRebalanced&&(line.render.body.text.match(/ /g)||[]).length>0)
          assert(Math.abs(rect.width-line.width)<.8,'ordinary row no longer fills its allotted width');
      }
      results.push({name,pass:true,firstBodyY:first.y,expected,width:first.width,openingHeight:height,
        rows:plan.lines.length,diagnostics:plan.diagnostics});
    } catch(error) { results.push({name,pass:false,error:String(error)}); }
    finally {context.dispose();page.remove();}
  }

  // Cross-regression: the Unicode-separator justification path must use the
  // newly widened opening-window geometry too. The fixed-width alignment suite
  // covers these separators, while the knee suite historically used ASCII
  // spaces only; this pins their interaction.
  const specialResults=[];
  const specialSeparators=[
    ['nbsp','\u00a0'],
    ['nnbsp','\u202f'],
    ['thin','\u2009'],
    ['tab','\t'],
  ];
  for(const family of ['serif','sans-serif','monospace'])
  for(const boundaryRows of [.95,1.05])
  for(const shift of [0,19])
  for(const [variant,separator] of specialSeparators) {
    const name=`special-knee/${family}/boundary=${boundaryRows}/x=${shift}/${variant}`;
    const context=createV9TextLayoutContext({mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,
      openingWordSettings:{enabled:true,target:'word',count:1,font:'inherit',size:200,weight:'bold',
        position:'dropped',dropLines:3,spaceAfter:.2,scope:'all',skipHeadings:false,
        skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false,minLines:1}});
    const page=document.createElement('div');
    page.style.cssText='position:relative;margin:0;padding:0;border:0;';
    document.body.append(page);
    try {
      const text=['פתיח','אלפא','ביתא','גמא','דלתא','אפסילון','זיתא','תיטא','יוטא','למדה','מם','נון'].join(separator);
      const entry=context.prepareEntry({id:'opening-special-knee',text,runs:[],
        mainRefs:[{uid:'visible',anchor:text.length,formatted:'[9]',cssText:'font-size:10px;vertical-align:super'}]});
      const desc=context.describeOpening(entry);
      assert(desc,'special separator fixture lost opening descriptor');
      const opening=partForRange(entry,0,desc.end);
      opening.runs=[...opening.runs,{start:desc.start,end:desc.end,marks:desc.marks}];
      const openingMetric=context.measure(opening);
      const next=/\S+/u.exec(text.slice(desc.end));
      assert(next,'special separator fixture has no first body word');
      const firstStart=desc.end+next.index,firstEnd=firstStart+next[0].length;
      const firstWord=context.measure(partForRange(entry,firstStart,firstEnd));
      const narrow=openingMetric.width+desc.gapPx+firstWord.width*.45;
      const wide=narrow+Math.max(110,firstWord.width*2);
      const pitch=context.lineHeight,boundary=boundaryRows*pitch;
      const openingHeight=Math.max(pitch*3,openingMetric.height);
      const strips=[
        {x:shift+wide-narrow,width:narrow,y_start:0,y_end:boundary},
        {x:shift,width:wide,y_start:boundary,y_end:600},
      ];
      const before=JSON.stringify({entry,strips});
      const plan=layoutV9MainParagraphs([entry],strips,context,600);
      const frozen=JSON.stringify(plan);
      page.style.width=`${shift+wide+20}px`;
      page.style.height='600px';
      for(const line of plan.lines)renderV9PlannedMainLine(line,page,0);

      const body=plan.lines.filter(l=>l.wordTokens.length);
      const first=body[0];
      const expected=Math.min(Math.ceil(boundary/pitch)*pitch,openingHeight);
      assert(first,`${variant}: body missing`);
      assert(first.y===expected,`${variant}: body begins at ${first.y}, expected first usable row ${expected}`);
      assert(first.y>=boundary-1/64,`${variant}: body did not enter the widened strip`);
      const expectedWidth=wide-(first.y<openingHeight?openingMetric.width+desc.gapPx:0);
      assert(Math.abs(first.width-expectedWidth)<.05,
        `${variant}: stale narrow width survived knee: got ${first.width}, expected ${expectedWidth}`);
      assert(!plan.overflowText,`${variant}: body unexpectedly overflowed tall page`);
      assert(plan.lines.map(l=>l.sourceText).join('')===text,`${variant}: planner changed source`);
      assert(sourceOf(page)===text,`${variant}: paint changed source/Unicode separators`);
      assert(JSON.stringify({entry,strips})===before,`${variant}: input/anchors mutated`);
      assert(JSON.stringify(plan)===frozen,`${variant}: painter changed plan`);
      assert(page.querySelectorAll('.v9-opening-glyph').length===1,`${variant}: opening lost/duplicated`);
      assert(page.querySelectorAll('[data-v9-main-ref]').length===1,`${variant}: visible reference lost/duplicated`);

      const hosts=[...page.querySelectorAll('.v9-final-main-line')];
      const pageRect=page.getBoundingClientRect();
      const openingRect=page.querySelector('.v9-opening-glyph').getBoundingClientRect();
      let justifiedSpecialRows=0;
      for(const line of body) {
        const host=hosts[plan.lines.indexOf(line)];
        const element=host?.querySelector('.v9-planned-line-text');
        assert(element,`${variant}: painted body row missing`);
        const range=document.createRange();
        range.selectNodeContents(element);
        const rect=range.getBoundingClientRect();
        const left=rect.left-pageRect.left,right=rect.right-pageRect.left;
        assert(left>=line.x-.9&&right<=line.x+line.width+.9,
          `${variant}: paint exceeded planned horizontal limits`);
        if(line.y<openingHeight) {
          assert(right<=openingRect.left-pageRect.left-desc.gapPx+.9,
            `${variant}: body overlaps opening after knee`);
        }
        if(!line.isLast&&!line.forcedBreak&&line.render?.body?.text?.includes(separator)&&
           line.naturalWidth<line.width-.5) {
          justifiedSpecialRows++;
          assert(Math.abs(rect.width-line.width)<1.0,
            `${variant}: special-separator row misses widened target: painted=${rect.width}, target=${line.width}`);
        }
      }
      assert(justifiedSpecialRows>0,`${variant}: fixture never exercised special-separator justification`);
      specialResults.push({name,pass:true,firstBodyY:first.y,width:first.width,rows:plan.lines.length});
    } catch(error) {
      specialResults.push({name,pass:false,error:String(error)});
    } finally {
      context.dispose();
      page.remove();
    }
  }

  const crown=runSplitCrownChecks(),grid=runShortStreamGridChecks();
  return {total:results.length+specialResults.length+crown.total+grid.total,
    passed:results.filter(r=>r.pass).length+specialResults.filter(r=>r.pass).length+crown.passed+grid.passed,
    failed:results.filter(r=>!r.pass).length+specialResults.filter(r=>!r.pass).length+crown.failed+grid.failed,
    groups:{openingWindow:results.length,specialSeparatorKnee:specialResults.length,splitCrown:crown.total,shortStreamGrid:grid.total},
    results:[...results,...specialResults,...crown.results,...grid.results]};
}
