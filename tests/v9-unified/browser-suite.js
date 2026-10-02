import { runSpacingRegressions } from './browser-spacing-regressions.js';
import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';
import { createV9TextLayoutContext, renderV9PlannedMainLine, waitForV9LayoutFonts } from '../../src/engine/v9_text_measurement.js';
import { prepareV9SourceParagraph } from '../../src/engine/v9_source_fragments.js';
import { buildPages } from '../../src/vilna_v9.js';
import { getStreamSettings } from '../../src/original_stream_columns.js';
import { runBrowserEdges } from './browser-edge-suite.js';

function assert(value, message) { if (!value) throw new Error(message); }
const neutral='שָׁלוֹם עולם קטן גדול משפט נוסף לדוגמה עם מילים רבות לבדיקה חוזרת ולבדיקת שורות.';
const styles = { fontFamily:'serif',fontSize:'13px',lineHeight:'20.15px',fontWeight:'400',direction:'rtl' };
function makePage() { const el=document.createElement('div');el.className='v9-page page';el.dir='rtl';el.style.cssText='position:relative;width:380px;height:537px;';document.getElementById('test-root').append(el);return el; }
function sourceText(el) { const clone=el.cloneNode(true);clone.querySelectorAll('[data-v9-main-ref]').forEach(e=>e.remove());return clone.textContent; }
function inspectLines(page, plans) {
  const rendered=[...page.querySelectorAll('[data-v9-layout-final]')];
  assert(rendered.length===plans.length,`paint count ${rendered.length} != ${plans.length}`);
  rendered.forEach((el,i)=>{
    const p=plans[i],body=el.querySelector('.v9-planned-line-text'),glyph=el.querySelector('.v9-opening-glyph');
    assert(sourceText(el)===p.sourceText,`source text mismatch at line ${i}`);
    assert(body.scrollWidth<=body.clientWidth+1,`body horizontal overflow ${i}: ${body.scrollWidth}>${body.clientWidth}`);
    const range=document.createRange();range.selectNodeContents(body);const ink=range.getBoundingClientRect(),r=el.getBoundingClientRect();
    assert(ink.height===0||ink.top>=r.top-0.55,`ink above row ${i}: ${ink.top-r.top}`);
    assert(ink.height===0||ink.bottom<=r.top+p.lineHeightPx+0.55,`ink below row ${i}: ${ink.bottom-r.top}>${p.lineHeightPx}`);
    if(glyph){
      const g=glyph.getBoundingClientRect(),gr=document.createRange();gr.selectNodeContents(glyph);const gi=gr.getBoundingClientRect();
      assert(g.width<=p.render.opening.width+0.1,'opening wider than planned');
      assert(gi.bottom<=page.getBoundingClientRect().top+1+p.render.opening.y+p.render.opening.height+0.6,'opening vertical overflow');
      assert(getComputedStyle(glyph).float==='none','unexpected float');
    }
  });
}
export async function runBrowserSuite() {
  const results=[];
  async function test(name, fn) { const start=performance.now(); try { const extra=await fn();results.push({name,status:'pass',ms:Math.round(performance.now()-start),...extra}); } catch(e) { results.push({name,status:'fail',message:e.message,stack:e.stack}); } }
  for(const family of ['serif','sans-serif','monospace'])for(const position of ['dropped','raised']) {
    await test(`actual DOM planned typography ${family} ${position}`,async()=>{
      const cfg={mainFontSize:13,mainFontFamily:family,lineHeightRatio:1.55,openingWordSettings:{enabled:true,target:'word',count:1,position,size:150,font:'inherit',dropLines:2,spaceAfter:.3}};
      await waitForV9LayoutFonts([],cfg);const c=createV9TextLayoutContext(cfg);
      const e=c.prepareEntry({id:'p',index:1,text:neutral+'\n'+neutral,runs:[{start:8,end:18,marks:{color:'rgb(255, 0, 0)',bold:true}},{start:25,end:35,marks:{fontSize:18,fontSizeUnit:'px',italic:true}}],mainRefs:[{anchor:3,uid:'a',formatted:'1',cssText:'font-size:9px;vertical-align:super'},{anchor:22,uid:'b',formatted:'2'}]});
      const p=layoutV9MainParagraphs([e],[{x:103,width:149,y_start:0,y_end:100},{x:0,width:356,y_start:100,y_end:520}],c,520);
      assert(!p.overflowText,'unexpected overflow');const page=makePage(),before=JSON.stringify(p);
      p.lines.forEach(l=>renderV9PlannedMainLine(l,page,12));inspectLines(page,p.lines);
      assert(JSON.stringify(p)===before,'paint mutated plan');assert(page.querySelectorAll('[data-v9-main-ref]').length===2,'refs lost or duplicated');
      const copied=makePage();p.lines.forEach(l=>renderV9PlannedMainLine(l,copied,12));assert(copied.innerHTML===page.innerHTML,'repeat paint differs');
      assert(page.querySelectorAll('[style*="255, 0, 0"]').length>0,'color lost');
      page.remove();copied.remove();c.dispose();return{lines:p.lines.length};
    });
  }
  for(let n=1;n<=8;n++)await test(`DOM dropped ${n} lines, next paragraph has its own opening`,async()=>{
    const cfg={mainFontSize:13,mainFontFamily:'serif',openingWordSettings:{enabled:true,target:'letter',count:1,position:'dropped',size:150,font:'inherit',dropLines:n,spaceAfter:.3}};
    const c=createV9TextLayoutContext(cfg),entries=[neutral,neutral].map((text,i)=>c.prepareEntry({text,id:`p${i}`,index:i+1,runs:[],mainRefs:[]}));
    const p=layoutV9MainParagraphs(entries,[{x:0,width:220,y_start:0,y_end:530}],c,530);
    assert(!p.overflowText,'unexpected overflow');const page=makePage();p.lines.forEach(l=>renderV9PlannedMainLine(l,page,0));inspectLines(page,p.lines);
    const os=p.lines.filter(l=>l.render.opening);assert(os.length===2,'missing opening');assert(os[1].y>=os[0].y+os[0].render.opening.height-.02,'next paragraph enters opening');page.remove();c.dispose();
  });
  await test('complete V9 paginator preserves many styled source paragraphs',async()=>{
    const page=makePage();page.replaceChildren();const input=Array.from({length:12},(_,i)=>({id:`source-${i}`,mainText:neutral+' '+neutral+'\n'+neutral,mainRuns:[{start:5,end:28,marks:{color:'red',bold:true}}],notes:[]}));
    const before=JSON.stringify(input), cfg={pageWidth:380,pageHeight:260,padding:12,mainFontSize:13,mainFontFamily:'serif',sideFontFamily:'serif',mainWidthRatio:.42,maxPages:80,openingWordSettings:{enabled:true,target:'letter',count:1,font:'inherit',size:150,position:'dropped',dropLines:2,spaceAfter:.3}};
    const result=await buildPages(page,input,cfg);assert(result.complete,'paginator incomplete');assert(JSON.stringify(input)===before,'input mutated');
    const rows=[...page.querySelectorAll('[data-v9-layout-final]')];assert(rows.length>0,'no planned rows');
    for(const p of input){
      const matches=rows.filter(e=>e.dataset.v9ParagraphId===p.id);const expected=prepareV9SourceParagraph(p).mainText;
      assert(matches.length>0,`paragraph missing ${p.id}`);assert(matches.map(sourceText).join('')===expected,`paginator lost source ${p.id}`);
      let offset=0;for(const el of matches){assert(+el.dataset.v9SourceOffset===offset,`source overlap/gap ${p.id}`);offset=+el.dataset.v9SourceEnd;}
      assert(offset===expected.length,`source tail missing ${p.id}`);assert(matches.filter(e=>e.querySelector('.v9-opening-glyph')).length===1,`opening repetition ${p.id}`);
    }
    assert(!page.querySelector('[data-v9-opening-flow-block]'),'legacy flow painter still active');
    const out={pages:result.pages.length,rows:rows.length};page.remove();return out;
  });
  for (const numbersEnabled of [true, false]) await test(`full V9 side streams preserve source and refs enabled=${numbersEnabled}`,async()=>{
    const settings = getStreamSettings();
    const saved = { '01': settings['01'], '02': settings['02'] };
    for (const id of ['01','02']) settings[id] = { ...settings[id], mainRefEnabled: numbersEnabled };
    const page=makePage();
    try { const input=Array.from({length:5},(_,i)=>({id:`side-${i}`,mainText:neutral+' '+neutral,mainRuns:[{start:10,end:35,marks:{italic:true}}],notes:[{stream:'01',num:i+1,uid:`n1-${i}`,anchor:7,text:'הערת צד ניטרלית לבדיקת פריסה ושמירת תוכן.'},{stream:'02',num:i+1,uid:`n2-${i}`,anchor:12,text:'טקסט נוסף בצד השני עם מילים פשוטות לבדיקה.'}]}));
    const result=await buildPages(page,input,{pageWidth:380,pageHeight:300,padding:12,mainFontSize:13,mainFontFamily:'serif',sideFontFamily:'serif',talmudStreams:['01','02'],maxPages:80,openingWordSettings:{enabled:true,target:'word',count:1,font:'inherit',size:150,position:'dropped',dropLines:2,spaceAfter:.3}});
    assert(result.complete,'side-stream paginator incomplete'); const rows=[...page.querySelectorAll('[data-v9-layout-final]')];
    for(const p of input)assert(rows.filter(el=>el.dataset.v9ParagraphId===p.id).map(sourceText).join('')===prepareV9SourceParagraph(p).mainText,'main source lost with side streams');
    const mainFirst=rows[0],firstSide=page.querySelector('.v9-role-right, .v9-role-left');
    assert(mainFirst&&firstSide,'missing side streams');
    const refs = [...page.querySelectorAll('[data-v9-main-ref]')];
    const expected = numbersEnabled ? input.flatMap(p=>p.notes.map(n=>n.uid)).sort() : [];
    const actual = refs.map(el=>el.dataset.uid).sort();
    assert(JSON.stringify(actual)===JSON.stringify(expected),`reference identities: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    assert(+mainFirst.style.top.replace('px','')<250,'main pushed below page');
    return {pages:result.pages.length,rows:rows.length,refs:refs.length};
    } finally {
      page.remove();
      for (const id of ['01','02']) { if (saved[id]===undefined) delete settings[id]; else settings[id]=saved[id]; }
    }
  });
  await test('automatic final gap fill uses safe physical row space even on an otherwise full page',async()=>{
    const words=['אב','גד','הוז','חטיכ','למנ','סעפ','צקר','שת'];
    const textOf=n=>Array.from({length:n},(_,i)=>words[i%words.length]).join(' ');
    const lineH=13*1.55, fixtures=[];
    const bottomOf=page=>Math.max(0,...[...page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line')].map(el=>
      (parseFloat(el.style.top)||0)+(parseFloat(el.style.height)||0)));
    const assertSource=(host,input)=>{
      for(const p of input){
        const expected=prepareV9SourceParagraph(p).mainText;
        const rows=[...host.querySelectorAll('[data-v9-paragraph-id]')].filter(el=>el.dataset.v9ParagraphId===p.id);
        assert(rows.map(sourceText).join('')===expected,`gap-fill source mismatch ${p.id}`);
      }
    };
    for(const family of ['serif','sans-serif','monospace']){
      let found=null;
      for(const pageHeight of [190,210,230,250,270]){
        if(found)break;
        for(let firstWords=8;firstWords<=48;firstWords+=2){
          const input=[
            {id:'gap-a',mainText:textOf(firstWords),notes:[]},
            {id:'gap-b',mainText:textOf(90),notes:[]},
          ];
          const common={pageWidth:380,pageHeight,padding:12,reservedBottom:0,mainFontSize:13,sideFontSize:10,lineHeightRatio:1.55,
            mainFontFamily:family,sideFontFamily:family,maxPages:40,openingWordSettings:{enabled:false}};
          const oldHost=makePage(),newHost=makePage();
          try{
            const oldResult=await buildPages(oldHost,input,{...common,finalGapFillTriggerRatio:.84,finalGapFillMinRemainingLines:2.5,finalGapFillMinGain:.04});
            const newResult=await buildPages(newHost,input,common);
            if(!oldResult.complete||!newResult.complete||!oldResult.pages[0]||!newResult.pages[0])continue;
            const pageBottom=pageHeight-common.padding,oldBottom=bottomOf(oldResult.pages[0]),newBottom=bottomOf(newResult.pages[0]);
            const oldGap=pageBottom-oldBottom,gain=newBottom-oldBottom;
            if(oldGap<lineH*.85||oldGap>lineH*2.49||gain<lineH*.45)continue;
            assertSource(oldHost,input);assertSource(newHost,input);
            assert(newBottom<=pageBottom+.05,'gap fill crossed page bottom');
            assert(newResult.pages.length<=oldResult.pages.length+1,'gap fill unexpectedly inflated page count');
            const rows=[...newResult.pages[0].querySelectorAll('.v9-final-main-line')].map(el=>({top:parseFloat(el.style.top)||0,h:parseFloat(el.style.height)||0}));
            for(let i=1;i<rows.length;i++)assert(rows[i].top+0.05>=rows[i-1].top+rows[i-1].h,'gap fill overlapped main rows');
            found={family,pageHeight,firstWords,oldGap,gain,oldPages:oldResult.pages.length,newPages:newResult.pages.length};
            break;
          }finally{oldHost.remove();newHost.remove();}
        }
      }
      assert(found,`no physical one-to-two-row gap fixture found for ${family}`);
      fixtures.push(found);
    }
    return {fixtures};
  });

  await test('font timeout is a failure rather than ready metadata',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(document,'fonts');Object.defineProperty(document,'fonts',{configurable:true,value:{load:()=>new Promise(()=>{}),ready:new Promise(()=>{})}});
    let threw=false;try{await waitForV9LayoutFonts([],{mainFontFamily:'serif'},15);}catch(e){threw=e.message.startsWith('V9_FONT_TIMEOUT');}finally{if(descriptor)Object.defineProperty(document,'fonts',descriptor);else delete document.fonts;}
    assert(threw,'timeout returned ready');
  });
  await runBrowserEdges(test,{assert,makePage,sourceText,paint:renderV9PlannedMainLine,inspectLines});
  await runSpacingRegressions(test,{assert,makePage,sourceText,inspectLines});
  return {tests:results.length,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,results};
}
