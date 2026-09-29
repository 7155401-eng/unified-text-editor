import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';
import { createV9TextLayoutContext } from '../../src/engine/v9_text_measurement.js';
import { prepareV9SourceParagraph } from '../../src/engine/v9_source_fragments.js';
import { applyV9OpeningWordsFromMetadata } from '../../src/engine/v9_opening_words_from_metadata.js';
import { normalizeV9StretchPolicy } from '../../src/engine/v9_stretch_policy.js';
import { buildPages } from '../../src/vilna_v9.js';

const sentence='שָׁלוֹם עולם קטן גדול משפט נוסף לדוגמה עם מילים רבות לבדיקה חוזרת ולבדיקת שורות.';
const opening={enabled:true,target:'word',count:1,position:'dropped',size:150,font:'inherit',dropLines:2,spaceAfter:.3};
const cfg={pageWidth:380,pageHeight:260,padding:12,mainFontSize:13,mainFontFamily:'serif',sideFontFamily:'serif',maxPages:100,openingWordSettings:opening};

export async function runBrowserEdges(test, { assert, makePage, sourceText, paint, inspectLines }) {
  await test('opening-only paragraph has one terminal reference in real DOM',async()=>{
    const c=createV9TextLayoutContext(cfg),e=c.prepareEntry({id:'single',text:'שלום',runs:[],mainRefs:[{anchor:4,uid:'last',formatted:'1'}]});
    const p=layoutV9MainParagraphs([e],[{x:0,width:149,y_start:0,y_end:200}],c,200),page=makePage();
    p.lines.forEach(l=>paint(l,page,0));inspectLines(page,p.lines);
    assert(page.querySelectorAll('[data-v9-main-ref]').length===1,'terminal reference duplicated');
    assert(sourceText(page)===e.text,'opening-only text changed');page.remove();c.dispose();
  });
  await test('explicit breaks remain distinct under a wide opening window',async()=>{
    const c=createV9TextLayoutContext(cfg),text='שלום עולם\n\nמשפט נוסף\nסיום';
    const p=layoutV9MainParagraphs([c.prepareEntry({id:'breaks',text,runs:[],mainRefs:[]})],[{x:0,width:300,y_start:0,y_end:200}],c,200);
    assert(p.lines.filter(l=>l.forcedBreak).length===3,'explicit/blank breaks lost');
    const page=makePage();p.lines.forEach(l=>paint(l,page,0));inspectLines(page,p.lines);assert(sourceText(page)===text,'break text lost');page.remove();c.dispose();
  });
  await test('scope and continuation rules use original paragraph identity',async()=>{
    const c=createV9TextLayoutContext({...cfg,openingWordSettings:{...opening,scope:'first'}});
    assert(c.describeOpening({text:sentence,index:1,runs:[]}), 'first paragraph missing');
    assert(!c.describeOpening({text:sentence,index:2,runs:[]}), 'second paragraph treated as first');
    assert(!c.describeOpening({text:sentence,index:1,continues:true,runs:[]}), 'continuation got new opening');
    assert(!c.describeOpening({text:sentence,index:1,isHeading:true,runs:[]}), 'heading was not skipped');c.dispose();
  });
  await test('inline point sizes and requested opening size share one pixel basis',async()=>{
    const c=createV9TextLayoutContext(cfg),d=c.describeOpening({text:sentence,runs:[{start:0,end:8,marks:{fontSize:18,fontSizeUnit:'pt',fontFamily:'monospace'}}]});
    assert(d.marks.fontSize===36,'18pt x 150% must be 36px');assert(d.marks.fontFamily==='monospace','opening lost inline font');assert(Math.abs(d.gapPx-10.8)<.001,'opening gap differs from requested em');c.dispose();
  });
  await test('full paginator splits one long source without duplicate opening or lost styles',async()=>{
    const input=[{id:'long',mainText:Array(60).fill(sentence).join('\n'),mainRuns:[{start:30,end:600,marks:{color:'rgb(255, 0, 0)',bold:true}}],notes:[]},{id:'short-next',mainText:'משפט קצר אחרון.',notes:[]}];
    const page=makePage(),result=await buildPages(page,input,cfg);assert(result.complete,'long source incomplete');assert(result.pages.length>2,'did not exercise pagination');
    const rows=[...page.querySelectorAll('[data-v9-layout-final]')];
    for(const p of input){const rs=rows.filter(r=>r.dataset.v9ParagraphId===p.id);assert(rs.map(sourceText).join('')===prepareV9SourceParagraph(p).mainText,'long source changed');let at=0;for(const r of rs){assert(+r.dataset.v9SourceOffset===at,'non-contiguous source');at=+r.dataset.v9SourceEnd;}assert(rs.filter(r=>r.querySelector('.v9-opening-glyph')).length===1,'opening count wrong');}
    assert(page.querySelectorAll('[style*="255, 0, 0"]').length>2,'inline styles lost across lines');const out={pages:result.pages.length,rows:rows.length};page.remove();return out;
  });
  await test('page limit returns all unconsumed source instead of reporting success',async()=>{
    const input=Array.from({length:6},(_,i)=>({id:`limited-${i}`,mainText:Array(5).fill(sentence).join(' '),notes:[]}));
    const page=makePage(),result=await buildPages(page,input,{...cfg,maxPages:1});assert(result.complete===false,'page limit reported complete');
    const rows=[...page.querySelectorAll('[data-v9-layout-final]')];
    for(const p of input){const consumed=rows.filter(r=>r.dataset.v9ParagraphId===p.id).map(sourceText).join('');const tail=result.remainingParagraphs.filter(q=>(q._v9Source?.id||q.id)===p.id).map(q=>q.mainText).join('');assert(consumed+tail===prepareV9SourceParagraph(p).mainText,'page limit lost source');}page.remove();
  });
  await test('legacy metadata and stretch passes cannot change finalized main lines',async()=>{
    const page=makePage();await buildPages(page,[{id:'immutable',mainText:sentence+' '+sentence,notes:[]}],cfg);
    const before=[...page.querySelectorAll('[data-v9-layout-final]')].map(el=>el.outerHTML).join('');
    applyV9OpeningWordsFromMetadata(page);normalizeV9StretchPolicy(page);
    const after=[...page.querySelectorAll('[data-v9-layout-final]')].map(el=>el.outerHTML).join('');assert(after===before,'late processor changed finalized main');page.remove();
  });
  await test('font generation invalidates measurements rather than reusing stale cache',async()=>{
    const c=createV9TextLayoutContext(cfg),part={text:sentence,runs:[],refs:[],style:c.typography};
    const a=c.measure(part);assert(c.measure(part)===a,'cache not used');const generation=c.generation;
    document.fonts.dispatchEvent(new Event('loadingdone'));assert(c.generation===generation+1,'font generation unchanged');assert(c.measure(part)!==a,'stale font measurement reused');c.dispose();
  });
  await test('cancelled render leaves existing destination intact',async()=>{
    const page=makePage();page.textContent='previous';const result=await buildPages(page,[{mainText:sentence}],{...cfg,isCurrent:()=>false});assert(result.aborted===true,'cancel not reported');assert(page.textContent==='previous','cancel changed visible content');page.remove();
  });
}
