import { saveTextStyles, loadTextStyles } from '../../src/style_registry.js';
import { buildPages,buildSinglePage } from '../../src/vilna_v9.js';
import { createV9TextLayoutContext, waitForV9LayoutFonts, appendV9PlannedPart } from '../../src/engine/v9_text_measurement.js';
import { flowV9MeasuredStream,renderV9MeasuredStreamLine } from '../../src/engine/v9_stream_inline_layout.js';
import { getStreamSettings, updateOriginalStreamColumnsPanel } from '../../src/original_stream_columns.js';
import { applyMainStreamColumnsToElement } from '../../src/main_stream_columns.js';
import { prepareV9SourceParagraph } from '../../src/engine/v9_source_fragments.js';
import { mapMainParagraphSource } from '../../src/engine/main_source_mapping.js';
import { installPageNumberPreRenderDecorator } from '../../src/document_features.js';
import { wordMainFragmentFromEditorHtml, wordRichFragmentFromEditorHtml } from '../../src/word_export_serialization.js';
import { fitRibbonTabs } from '../../src/ribbon_tabs_guard.js';
import { analyzePageElement } from '../../src/layout_analysis_report.js';
import { applyV9MainBottomGapToPage } from '../../src/engine/v9_main_bottom_gap.js';

const phrase='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const neutral='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר';
const cfg={pageWidth:380,pageHeight:350,padding:12,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,mainFontFamily:'serif',sideFontFamily:'serif',talmudStreams:['01','02'],maxPages:80,openingWordSettings:{enabled:false}};

export async function runSpacingRegressions(test,{assert,makePage,sourceText}) {
 await test('Word round-trip keeps hard breaks inside a paragraph distinct from paragraph boundaries',()=>{
   const html='<p>אחד<br><strong>שניים</strong></p><p>שלוש</p>';
   const out=wordMainFragmentFromEditorHtml(html);
   assert((out.match(/<br>/g)||[]).length===1,'hard break was converted into a Word paragraph boundary');
   assert((out.match(/<p class=MsoNormal dir=RTL><span lang=HE>/g)||[]).length===1,'editor block boundary was not converted exactly once');
   assert(out==='אחד<br><b>שניים</b></span></p>\n<p class=MsoNormal dir=RTL><span lang=HE>שלוש',
     `unexpected Word fragment: ${out}`);
 });
 await test('B13 rich Word export preserves hard breaks and real block boundaries exactly',()=>{
   const html='<p>אחד<br><em>שניים</em></p><p><strong>שלוש</strong></p><p>ארבע</p>';
   const out=wordRichFragmentFromEditorHtml(html);
   assert(out==='אחד<br><i>שניים</i><br><b>שלוש</b><br>ארבע',
     `unexpected rich Word fragment: ${out}`);
   assert((out.match(/<br>/g)||[]).length===3,
     'expected one source hard break plus two real block boundaries');
 });
 await test('B13 top-level inline siblings do not become invented Word line breaks',()=>{
   const html='alpha <strong>beta</strong><span style="color:red"> gamma</span>';
   const out=wordRichFragmentFromEditorHtml(html);
   assert(out==='alpha <b>beta</b><span style="color:red"> gamma</span>',
     `top-level inline content was split or lost: ${out}`);
   assert(!out.includes('<br>'),'inline siblings acquired an invented hard break');
 });
 await test('B13 intentional empty editor blocks remain blank lines',()=>{
   const out=wordRichFragmentFromEditorHtml('<p>א</p><p></p><p>ב</p>');
   assert(out==='א<br><br>ב',`blank editor block was not preserved: ${out}`);
 });
 await test('B13 formatting whitespace between top-level blocks does not create lines',()=>{
   const html='<p>א</p>\n    <p>ב</p>\n<div>ג</div>';
   const rich=wordRichFragmentFromEditorHtml(html);
   const main=wordMainFragmentFromEditorHtml(html);
   assert(rich==='א<br>ב<br>ג',`formatting whitespace created a rich line: ${JSON.stringify(rich)}`);
   assert(main==='א</span></p>\n<p class=MsoNormal dir=RTL><span lang=HE>ב</span></p>\n<p class=MsoNormal dir=RTL><span lang=HE>ג',
     `formatting whitespace created a Word paragraph: ${JSON.stringify(main)}`);
 });

 await test('wrapped ribbon tabs drive the sticky toolbar offset from measured height',async()=>{
   const link=document.createElement('link');
   link.rel='stylesheet';link.href='../../styles.css';
   document.head.appendChild(link);
   await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(new Error('styles.css did not load'));});

   const previousVar=document.documentElement.style.getPropertyValue('--ravtext-ribbon-tabs-height');
   const bar=document.createElement('div');
   bar.id='ribbon-tabs';bar.className='ribbon-tabs';
   const toolbar=document.createElement('div');
   toolbar.id='main-ribbon-toolbar';
   document.body.append(bar,toolbar);
   try {
     Object.defineProperty(bar,'clientWidth',{configurable:true,get:()=>100});
     Object.defineProperty(bar,'scrollWidth',{configurable:true,get:()=>{
       if(bar.classList.contains('rt-compact-3'))return 100;
       if(bar.classList.contains('rt-compact-2'))return 180;
       if(bar.classList.contains('rt-compact'))return 220;
       return 300;
     }});
     bar.getBoundingClientRect=()=>({
       x:0,y:0,left:0,top:0,right:100,bottom:bar.classList.contains('rt-compact-3')?68:34,
       width:100,height:bar.classList.contains('rt-compact-3')?68:34,
       toJSON(){return this;}
     });

     fitRibbonTabs();
     assert(bar.classList.contains('rt-compact-3'),'fixture did not enter wrapped two-row ribbon mode');
     assert(document.documentElement.style.getPropertyValue('--ravtext-ribbon-tabs-height')==='68px',
       `sticky offset var=${document.documentElement.style.getPropertyValue('--ravtext-ribbon-tabs-height')}`);
     assert(getComputedStyle(toolbar).top==='68px',
       `sticky toolbar top=${getComputedStyle(toolbar).top}, expected 68px`);
   } finally {
     bar.remove();toolbar.remove();link.remove();
     if(previousVar)document.documentElement.style.setProperty('--ravtext-ribbon-tabs-height',previousVar);
     else document.documentElement.style.removeProperty('--ravtext-ribbon-tabs-height');
   }
 });

 await test('edge bidi controls remain active around neutral punctuation instead of display-none',()=>{
    const host=document.createElement('span');
    appendV9PlannedPart(host,{
      leadingText:' \u200f\u061c ',
      text:"('אב",
      trailingText:' \u200e ',
      runs:[],refs:[],style:{}
    });

    assert(host.textContent===" \u200f\u061c ('אב \u200e ",
      `source order changed: ${JSON.stringify(host.textContent)}`);

    const hidden=[...host.querySelectorAll('.v9-source-whitespace')]
      .map(el=>el.textContent||'').join('');
    assert(!hidden.includes('\u200e')&&!hidden.includes('\u200f')&&!hidden.includes('\u061c'),
      'LRM/RLM/ALM were still hidden from the BiDi algorithm');

    const activeText=[...host.childNodes]
      .filter(n=>n.nodeType===Node.TEXT_NODE)
      .map(n=>n.nodeValue||'').join('');
    assert(activeText.includes('\u200f')&&activeText.includes('\u200e')&&activeText.includes('\u061c'),
      'direction controls are not active text nodes');
    host.remove();
  });

  await test('V9 split DOM matches native Chromium BiDi placement for apostrophe + parentheses',()=>{
    const samples=[
      {leading:'\u200f',text:"('אב",trailing:'\u200e',runs:[]},
      {leading:'\u200f',text:"אב')",trailing:'\u200e',runs:[]},
      {leading:'\u061c\u200f',text:"('אב'",trailing:'\u200e',runs:[]},

      // No explicit direction marks: neutral apostrophe/brackets must still be
      // laid out exactly like one native RTL text node.
      {leading:'',text:"אב'(גד)",trailing:'',runs:[]},
      {leading:'',text:"אב')גד(",trailing:'',runs:[]},
      {leading:'',text:"אב' (גד)",trailing:'',runs:[]},
      {leading:'',text:"אב'123(גד)",trailing:'',runs:[]},

      // Styling creates separate DOM spans. Span boundaries must not become
      // BiDi isolation boundaries or change bracket mirroring/order.
      {leading:'',text:"אב'(גד)",trailing:'',runs:[
        {start:2,end:3,marks:{color:'rgb(1, 2, 3)'}},
        {start:3,end:4,marks:{color:'rgb(4, 5, 6)'}},
      ]},
      {leading:'',text:"('אב')",trailing:'',runs:[
        {start:0,end:1,marks:{color:'rgb(1, 2, 3)'}},
        {start:1,end:2,marks:{color:'rgb(4, 5, 6)'}},
        {start:4,end:5,marks:{color:'rgb(7, 8, 9)'}},
      ]},
    ];

    const rectsForVisibleChars=(el)=>{
      const rootRect=el.getBoundingClientRect();
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      const out=[];
      let node;
      while((node=walker.nextNode())){
        if(node.parentElement?.classList?.contains('v9-source-whitespace'))continue;
        const value=node.nodeValue||'';
        for(let i=0;i<value.length;i++){
          const ch=value[i];
          if(['\u061c','\u200e','\u200f','\u2060'].includes(ch))continue;
          const range=document.createRange();
          range.setStart(node,i);range.setEnd(node,i+1);
          const r=range.getBoundingClientRect();
          out.push({ch,left:r.left-rootRect.left,right:r.right-rootRect.left,width:r.width});
        }
      }
      return out;
    };

    for(const sample of samples){
      const built=document.createElement('span');
      const native=document.createElement('span');
      for(const el of [built,native]){
        el.style.cssText='position:absolute;top:0;display:inline-block;white-space:pre;direction:rtl;font:24px serif;';
      }
      built.style.left='0px';native.style.left='300px';
      appendV9PlannedPart(built,{...sample,runs:sample.runs||[],refs:[],style:{}});
      native.textContent=sample.leading+sample.text+sample.trailing;
      document.body.append(built,native);
      try{
        const actual=rectsForVisibleChars(built),expected=rectsForVisibleChars(native);
        assert(actual.map(x=>x.ch).join('')===expected.map(x=>x.ch).join(''),
          `logical punctuation changed for ${JSON.stringify(sample)}`);
        assert(actual.length===expected.length,`character count differs for ${JSON.stringify(sample)}`);
        for(let i=0;i<actual.length;i++){
          assert(Math.abs(actual[i].left-expected[i].left)<.75,
            `BiDi left differs for ${JSON.stringify(sample)} char ${actual[i].ch}: ${actual[i].left} vs ${expected[i].left}`);
          assert(Math.abs(actual[i].right-expected[i].right)<.75,
            `BiDi right differs for ${JSON.stringify(sample)} char ${actual[i].ch}: ${actual[i].right} vs ${expected[i].right}`);
        }
      }finally{built.remove();native.remove();}
    }
  });

  await test('V9 paints page numbers during page construction without a post-render event',async()=>{
   const savedSetting=localStorage.getItem('ravtext.pageNumbers');
   const hadRegistry=Object.prototype.hasOwnProperty.call(window,'__ravtextPreRenderPageDecorators');
   const savedRegistry=window.__ravtextPreRenderPageDecorators;
   const host=makePage();
   try {
     localStorage.setItem('ravtext.pageNumbers','1');
     window.__ravtextPreRenderPageDecorators=[];
     installPageNumberPreRenderDecorator();
     const result=await buildPages(host,[{id:'page-number-during-render',mainText:Array(4).fill(neutral).join(' '),notes:[]}],
       {...cfg,pageHeight:300,talmudStreams:[],maxPages:10});
     assert(result.complete,'page-number fixture incomplete');
     assert(result.pages.length>0,'page-number fixture produced no page');
     const first=result.pages[0],label=first.querySelector('.ravtext-page-number-overlay');
     assert(label,'page number was left to the later engine-rendered/observer pass');
     assert(label.textContent==='א',`unexpected first page label: ${label.textContent}`);
     assert(first.dataset.ravtextPageNumberPaint==='during-render','page number was not painted by the render-time decorator');
   } finally {
     host.remove();
     if(savedSetting===null)localStorage.removeItem('ravtext.pageNumbers');else localStorage.setItem('ravtext.pageNumbers',savedSetting);
     if(hadRegistry)window.__ravtextPreRenderPageDecorators=savedRegistry;else delete window.__ravtextPreRenderPageDecorators;
   }
 });
 function assertNoWordOverlap(page) {
   const boxes=[];
   for(const line of page.querySelectorAll('.v9-line')) {
     const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let node;
     while(node=walker.nextNode()){
       if(node.parentElement.closest('.v9-source-whitespace'))continue;
       for(const m of node.textContent.matchAll(/[^\s]+/gu)) {
         if(/^[\u200e\u200f\u2060]+$/u.test(m[0]))continue;
         const range=document.createRange();range.setStart(node,m.index);range.setEnd(node,m.index+m[0].length);
         for(const r of range.getClientRects())if(r.width>.5 && r.height>1)boxes.push({r,line});
       }
     }
   }
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
     const {r:a,line:la}=boxes[i],{r:b,line:lb}=boxes[j];
     const dx=Math.min(a.right,b.right)-Math.max(a.left,b.left),dy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
     assert(!(dx>1.1 && dy>Math.min(a.height,b.height)*.5),`word overlap ${la.dataset.v9Role}/${lb.dataset.v9Role}, dx=${dx}, dy=${dy}, y=${la.style.top}/${lb.style.top}, page=${JSON.stringify(la.closest('.v9-page')?.dataset)}, a=${JSON.stringify({x:la.style.left,w:la.style.width,h:la.style.height,info:la.dataset})}, b=${JSON.stringify({x:lb.style.left,w:lb.style.width,h:lb.style.height,info:lb.dataset})}`);
   }
 }
 function inspectStream(el,line) {
   const r=el.getBoundingClientRect(),body=el.querySelector('.v9-planned-stream-text'),range=document.createRange();range.selectNodeContents(body);
   const ink=range.getBoundingClientRect();
   assert(body.scrollWidth<=line.width+1,`note width overflow ${body.scrollWidth}>${line.width}`);
   assert(!ink.height || (ink.top>=r.top-.6 && ink.bottom<=r.top+line.lineHeightPx+.6),`note ink vertical overflow: top=${ink.top-r.top}, bottom=${ink.bottom-r.top}, row=${line.lineHeightPx}`);
   assert(getComputedStyle(el).whiteSpace==='pre','note painter permits a second CSS row');
   assert(!el.classList.contains('justify'),'legacy reflow class retained');
 }
 await test('main stream layout exposes a 1/2-column control',()=>{
   const existing=document.getElementById('stream-columns-panel');
   const panel=existing || document.createElement('div');
   if(!existing){panel.id='stream-columns-panel';document.body.appendChild(panel);}
   try {
     updateOriginalStreamColumnsPanel([],()=>{});
     const mainBlock=panel.querySelector('[data-stream-code="main"]');
     assert(mainBlock,'main stream settings block missing');
     const colsLabel=[...mainBlock.querySelectorAll('label')].find(el=>
       String(el.querySelector(':scope > span')?.textContent||'').replace(/:$/,'').trim()==='טורים');
     assert(colsLabel,'main stream columns control is hidden');
     const input=colsLabel.querySelector('input[type="number"]');
     assert(input,'main stream columns input missing');
     assert(input.min==='1'&&input.max==='2',`main columns range is ${input.min}..${input.max}, expected 1..2`);
   } finally {
     panel.replaceChildren();
     if(!existing)panel.remove();
   }
 });

 await test('shared production helper applies main stream two-column layout',()=>{
   const settings=getStreamSettings(),saved=settings.main;
   const main=document.createElement('div');document.body.appendChild(main);
   try {
     settings.main={...(settings.main||{}),cols:2};
     const count=applyMainStreamColumnsToElement(main);
     assert(count===2,`resolved main columns=${count}`);
     assert(main.dataset.mainCols==='2',`main cols dataset=${main.dataset.mainCols}`);
     assert(getComputedStyle(main).columnCount==='2',`main columnCount=${getComputedStyle(main).columnCount}`);
   } finally {
     main.remove();
     if(saved===undefined)delete settings.main;else settings.main=saved;
   }
 });

 await test('V9 main stream flows right column then left without source loss',()=>{
   const settings=getStreamSettings(),saved=settings.main;
   const page=makePage();
   try {
     settings.main={...(settings.main||{}),cols:2,titleShow:true};
     const text=Array(28).fill(neutral).join(' ');
     const plan=buildSinglePage(page,{mainText:text,footerStreams:[]},
       {...cfg,pageHeight:280,talmudStreams:[],mainWidthRatio:.82,titles:{main:'MAIN TWO COLS'}});
     assert(plan.mainBox?.columns===2,`V9 main columns=${plan.mainBox?.columns}`);
     const right=plan.mainBox.lines.filter(l=>l.mainColumn==='right');
     const left=plan.mainBox.lines.filter(l=>l.mainColumn==='left');
     assert(right.length>0,'right main column is empty');
     assert(left.length>0,'left main column was never used');
     assert(Math.min(...right.map(l=>l.x))>Math.min(...left.map(l=>l.x)),
       'RTL reading order did not place first column on the right');
     const firstLeft=plan.mainBox.lines.findIndex(l=>l.mainColumn==='left');
     const lastRight=plan.mainBox.lines.map(l=>l.mainColumn).lastIndexOf('right');
     assert(firstLeft>lastRight,'main column source order interleaved instead of right then left');
     const painted=plan.mainBox.lines.map(l=>l.sourceText||'').join('');
     assert(painted+(plan.overflow?.mainText||'')===text,'two-column V9 lost or reordered main source');
     const title=[...page.querySelectorAll('.v9-stream-title')].find(el=>el.textContent==='MAIN TWO COLS');
     assert(title,'two-column main title missing');
     assert(Math.abs(parseFloat(title.style.width)-plan.mainBox.width)<.2,
       `main title width ${title.style.width} does not span main area ${plan.mainBox.width}`);
   } finally {
     page.remove();
     if(saved===undefined)delete settings.main;else settings.main=saved;
   }
 });

await test('collapsed ribbon hides separator-only level but preserves real active controls',async()=>{
   const links=[];
   const loadCss=(href)=>new Promise((resolve,reject)=>{
     const link=document.createElement('link');
     link.rel='stylesheet';link.href=href;link.onload=()=>resolve(link);
     link.onerror=()=>reject(new Error('failed to load '+href));
     document.head.appendChild(link);links.push(link);
   });
   const previousClasses=document.body.className;
   const toolbar=document.createElement('div');
   toolbar.id='main-ribbon-toolbar';
   toolbar.className='ribbon-toolbar';
   const sep=document.createElement('span');sep.className='sep';
   const hiddenGroup=document.createElement('span');hiddenGroup.className='tb-group ribbon-hidden';
   const hiddenButton=document.createElement('button');hiddenButton.textContent='hidden';
   hiddenGroup.appendChild(hiddenButton);
   toolbar.append(sep,hiddenGroup);
   document.body.appendChild(toolbar);
   try{
     await loadCss('../../styles.css');
     await loadCss('../../theme-base-refresh.css');
     for(const peek of [false,true]){
       document.body.className=(previousClasses+' ribbon-collapsed'+(peek?' ribbon-peek':'')).trim();
       assert(getComputedStyle(sep).display==='none',
         `separator resurrected in collapsed${peek?'+peek':''} mode: ${getComputedStyle(sep).display}`);
       assert(getComputedStyle(toolbar).display==='none',
         `separator-only toolbar still occupies a level in collapsed${peek?'+peek':''} mode`);

       const activeGroup=document.createElement('span');activeGroup.className='tb-group';
       const activeButton=document.createElement('button');activeButton.textContent='active';
       activeGroup.appendChild(activeButton);toolbar.appendChild(activeGroup);
       assert(getComputedStyle(toolbar).display!=='none','real active toolbar was hidden by empty-level cleanup');
       assert(getComputedStyle(activeGroup).display!=='none','real active group was hidden by empty-level cleanup');
       activeGroup.remove();
     }
   }finally{
     toolbar.remove();links.forEach(link=>link.remove());document.body.className=previousClasses;
   }
 });

  await test('classic source tokens do not break around punctuation without whitespace',async()=>{
   const link=document.createElement('link');
   link.rel='stylesheet';link.href='../../styles.css';
   document.head.appendChild(link);
   await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(new Error('styles.css did not load'));});
   const page=makePage();
   try {
     const token=document.createElement('span');
     token.className='ln-word';
     token.textContent='אבג[דה]וז';
     page.appendChild(token);
     assert(getComputedStyle(token).whiteSpace==='nowrap','classic word token is still breakable around punctuation');
     token.classList.add('ln-orphan-overflow');
     const cs=getComputedStyle(token);
     assert(cs.wordBreak==='normal',`overlong source token re-enabled word-break: ${cs.wordBreak}`);
     assert(cs.overflowWrap==='normal',`overlong source token re-enabled overflow-wrap: ${cs.overflowWrap}`);
   } finally {
     page.remove();link.remove();
   }
 });

 await test('Hebrew niqqud shaping features are preserved from V9 measurement to paint',async()=>{
   const page=makePage();
   const result=await buildPages(page,[{id:'niqqud-shaping',mainText:'מֶלֶךְ כָּךְ שָׁלוֹם',notes:[]}],
     {...cfg,talmudStreams:[],pageHeight:240,maxPages:10});
   assert(result.complete,'niqqud shaping fixture incomplete');
   const line=page.querySelector('[data-v9-paragraph-id="niqqud-shaping"]');
   assert(line,'niqqud shaping line missing');
   const features=getComputedStyle(line).fontFeatureSettings || '';
   assert(/["']?mark["']?/i.test(features),`OpenType mark feature missing: ${features}`);
   assert(/["']?mkmk["']?/i.test(features),`OpenType mkmk feature missing: ${features}`);
   page.remove();
 });

 await test('rich side text with large inline bold is measured before row placement',()=>{
   const c=createV9TextLayoutContext({...cfg,mainFontSize:11}),text=Array(4).fill(neutral).join(' '),input={text,runs:[{start:4,end:26,marks:{fontSize:23,fontFamily:'monospace',bold:true}},{start:42,end:70,marks:{fontSize:9,bold:true,color:'red'}}]};
   const p=flowV9MeasuredStream(input,[{x:0,width:160,y_start:0,y_end:600}],c,600),page=makePage();
   assert(!p.overflowText,'fixture overflow');
   for(const l of p.lines)inspectStream(renderV9MeasuredStreamLine(l,{role:'right',id:'01'},page,0),l);
   assert(page.textContent===text,'rich note lost characters');
   for(let i=1;i<p.lines.length;i++)assert(p.lines[i].y>=p.lines[i-1].y+p.lines[i-1].lineHeightPx-.02,'note rows overlap');
   const out={rows:p.lines.length};page.remove();c.dispose();return out;
 });
 await test('B3: punctuation-adjacent spaces remain visibly present in V9 main text',async()=>{
   const settings=getStreamSettings(),saved=settings.main;
   const host=makePage();
   const visibleText=(el)=>{
     const clone=el.cloneNode(true);
     clone.querySelectorAll('[data-v9-main-ref],.v9-source-whitespace').forEach(n=>n.remove());
     return clone.textContent||'';
   };
   const trimEdgeGlue=(s)=>String(s||'').replace(/^[ \t\u200e\u200f\u2060]+|[ \t\u200e\u200f\u2060]+$/gu,'');
   try {
     for(const cols of [1,2]){
       settings.main={...(settings.main||{}),cols};
       host.replaceChildren();
       const unit='alpha, beta. gamma; delta: epsilon? zeta! אחד, שניים. שלושה; ארבעה: חמישה? שישה!';
       const text=Array(18).fill(unit).join(' ');
       const runs=[];
       for(let i=0;i<text.length;i+=37){
         runs.push({start:i,end:Math.min(text.length,i+19),marks:{bold:(i/37)%2===0,color:(i/37)%3===0?'red':undefined}});
       }
       const result=await buildPages(host,[{id:`punct-space-${cols}`,mainText:text,mainRuns:runs,notes:[]}],
         {...cfg,pageHeight:260,talmudStreams:[],maxPages:80,openingWordSettings:{enabled:false}});
       assert(result.complete,`B3 fixture incomplete cols=${cols}`);
       const rows=[...host.querySelectorAll(`[data-v9-paragraph-id="punct-space-${cols}"]`)];
       assert(rows.length>5,`B3 fixture too small cols=${cols}`);
       for(const row of rows){
         const expected=trimEdgeGlue(sourceText(row));
         const visible=visibleText(row);
         assert(visible===expected,
           `B3 visible spacing mismatch cols=${cols}: source=${JSON.stringify(expected)} visible=${JSON.stringify(visible)}`);
         assert(!/[,.;:?!][^\s,.;:?!]/u.test(visible),
           `B3 punctuation lost following whitespace inside one visible row: ${JSON.stringify(visible)}`);
       }
     }
   } finally {
     host.remove();
     if(saved===undefined)delete settings.main;else settings.main=saved;
   }
 });

 await test('configured inter-note gap has no leading or trailing visible slot',()=>{
   const c=createV9TextLayoutContext({...cfg,mainFontSize:11}),text='\u200e  alpha    beta \u200e gamma delta   \u200e';
   const p=flowV9MeasuredStream({text,runs:[]},[{x:0,width:63,y_start:0,y_end:400}],c,400),page=makePage();
   assert(!p.overflowText,'unexpected spacing overflow');
   for(const l of p.lines){const t=l.render.body.text;assert(!/^[\s\u200e\u200f\u2060]|[\s\u200e\u200f\u2060]$/u.test(t),`visible edge gap ${JSON.stringify(t)}`);inspectStream(renderV9MeasuredStreamLine(l,{id:'01',role:'right'},page,0),l);}
   assert(page.textContent===text,'source spacing was deleted instead of excluded from measurement');page.remove();c.dispose();
 });
 await test('crown uses actual stream pitch plus explicit main gap',()=>{
   const page=makePage(),t=Array(8).fill(phrase).join(' '),plan=buildSinglePage(page,{mainText:neutral,rightStream:{id:'01',items:[t]},leftStream:{id:'02',items:[t]},footerStreams:[]},{...cfg,sideFontSize:10,crownLines:4,crownMainGapPx:8,streamSettings:{'01':{inlineStyle:{fontSize:11,lineHeight:1.55}},'02':{inlineStyle:{fontSize:11,lineHeight:1.55}}}});
   const firstMain=plan.mainBox.lines[0],right=plan.streamBoxes.find(b=>b.role==='right'),top=right.lines[0].y;
   assert(firstMain.y>=top+4*17.05+8-.1,`main before crown+gap: ${firstMain.y}`);
   assert(firstMain.y<top+4*17.05+9,'excess crown space');
   assert(right.lines[3].y+right.lines[3].lineHeightPx<=firstMain.y-7.9,'fourth actual crown line overlaps main');
   page.remove();return {mainTop:firstMain.y,crownBottom:plan.crownBottomY};
 });
 await test('global stream line-height is a real V9 planner pitch, independent from main',()=>{
   const page=makePage(),t=Array(10).fill(phrase).join(' ');
   const plan=buildSinglePage(page,{
     mainText:Array(4).fill(neutral).join(' '),
     rightStream:{id:'01',items:[t],runs:[],rich:{text:t,runs:[]}},
     leftStream:{id:'02',items:[t],runs:[],rich:{text:t,runs:[]}},
     footerStreams:[]
   },{
     ...cfg,
     pageHeight:720,
     mainFontSize:13,
     sideFontSize:10,
     lineHeightRatio:1.55,
     streamLineHeightRatio:2.05,
     crownLines:4,
     streamSettings:{'01':{inlineStyle:{fontSize:10}},'02':{inlineStyle:{fontSize:10}}}
   });
   const right=plan.streamBoxes.find(b=>b.role==='right');
   assert(right?.lines?.length>=2,'stream line-height fixture did not create two rows');
   const pitch=right.lines[1].y-right.lines[0].y;
   assert(Math.abs(pitch-20.5)<.2,
     `stream planner ignored streamLineHeightRatio: pitch=${pitch}, expected 20.5`);
   assert(Math.abs(Number(right.lines[0].lineHeightPx)-20.5)<.2,
     `stream painted lineHeightPx=${right.lines[0].lineHeightPx}, expected planner pitch 20.5`);
   const mainLine=plan.mainBox?.lines?.[0];
   assert(mainLine,'missing main line');
   assert(Math.abs(Number(mainLine.lineHeightPx)-20.15)<.25,
     `stream line-height leaked into main: main lineHeightPx=${mainLine.lineHeightPx}`);
   page.remove();
 });

 await test('explicit per-stream line-height overrides the global stream pitch',()=>{
   const page=makePage(),t=Array(10).fill(phrase).join(' ');
   const plan=buildSinglePage(page,{
     mainText:Array(4).fill(neutral).join(' '),
     rightStream:{id:'01',items:[t],runs:[],rich:{text:t,runs:[]}},
     leftStream:{id:'02',items:[t],runs:[],rich:{text:t,runs:[]}},
     footerStreams:[]
   },{
     ...cfg,
     pageHeight:720,
     sideFontSize:10,
     streamLineHeightRatio:2.05,
     crownLines:4,
     streamSettings:{
       '01':{inlineStyle:{fontSize:10,lineHeight:1.8}},
       '02':{inlineStyle:{fontSize:10,lineHeight:1.8}}
     }
   });
   const right=plan.streamBoxes.find(b=>b.role==='right');
   assert(right?.lines?.length>=2,'explicit stream style fixture did not create two rows');
   const pitch=right.lines[1].y-right.lines[0].y;
   assert(Math.abs(pitch-18)<.2,
     `explicit stream lineHeight did not override global pitch: ${pitch}`);
   page.remove();
 });

 await test('configured four-row crown paints four complete rows before body transition',()=>{
   const page=makePage(),t=Array(18).fill(phrase).join(' ');
   const plan=buildSinglePage(page,{
     mainText:Array(5).fill(neutral).join(' '),
     rightStream:{id:'01',items:[t],runs:[],rich:{text:t,runs:[]}},
     leftStream:{id:'02',items:[t],runs:[],rich:{text:t,runs:[]}},
     footerStreams:[]
   },{...cfg,pageHeight:720,crownLines:4,streamSettings:{
     '01':{inlineStyle:{fontSize:11,lineHeight:1.55}},
     '02':{inlineStyle:{fontSize:11,lineHeight:1.55}}
   }});
   const crownBottom=plan.crownBottomY;
   for(const role of ['right','left']){
     const box=plan.streamBoxes.find(b=>b.role===role);
     assert(box,'missing crown side '+role);
     const crownRows=box.lines.filter(l=>l.y+Math.max(1,l.lineHeightPx||0)<=crownBottom+.15);
     assert(crownRows.length>=4,`${role} crown painted only ${crownRows.length} complete rows`);
   }
   page.remove();
 });


 await test('heterogeneous crown pitches do not manufacture a blank row at crown→body transition',()=>{
   const page=makePage(),t=Array(24).fill(phrase).join(' ');
   const plan=buildSinglePage(page,{
     mainText:Array(6).fill(neutral).join(' '),
     rightStream:{id:'01',items:[t],runs:[],rich:{text:t,runs:[]}},
     leftStream:{id:'02',items:[t],runs:[],rich:{text:t,runs:[]}},
     footerStreams:[]
   },{
     ...cfg,pageHeight:760,crownLines:4,crownMainGapPx:11,
     streamSettings:{
       '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
       '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
     }
   });

   const crownBottom=Number(plan.crownBottomY)||0;
   for(const role of ['right','left']){
     const box=plan.streamBoxes.find(b=>b.role===role);
     assert(box?.lines?.length>4,`missing crown/body rows for ${role}`);
     const sorted=[...box.lines].sort((a,b)=>a.y-b.y);
     const crownRows=sorted.filter(l=>l.y+Math.max(1,Number(l.lineHeightPx)||0)<=crownBottom+.15);
     assert(crownRows.length===4,`${role} crown must contain exactly 4 complete rows, got ${crownRows.length}`);
     const lastCrown=crownRows[crownRows.length-1];
     const next=sorted.find(l=>l.y>lastCrown.y+.1);
     assert(next,`no body row after crown for ${role}`);
     const pitch=Number(lastCrown.lineHeightPx)||Number(next.lineHeightPx)||1;
     const dy=next.y-lastCrown.y;
     assert(dy<=pitch+.2,
       `${role} crown→body transition inserted vertical gap: dy=${dy}, pitch=${pitch}, crownBottom=${crownBottom}, lastY=${lastCrown.y}, nextY=${next.y}`);
     assert(dy>=pitch-.2,
       `${role} crown→body rows overlap/collapse: dy=${dy}, pitch=${pitch}`);
   }
   page.remove();
 });

 await test('main stream title reserves geometry below crown and honors titleShow',()=>{
   const settings=getStreamSettings(),saved=settings.main;
   const t=Array(12).fill(phrase).join(' ');
   const content={
     mainText:Array(4).fill(neutral).join(' '),
     rightStream:{id:'01',items:[t],runs:[],rich:{text:t,runs:[]}},
     leftStream:{id:'02',items:[t],runs:[],rich:{text:t,runs:[]}},
     footerStreams:[]
   };
   try {
     settings.main={...(settings.main||{}),titleShow:true};
     const shown=makePage();
     const plan=buildSinglePage(shown,content,{...cfg,pageHeight:720,crownLines:4,crownMainGapPx:8,titles:{main:'MAIN TITLE'}});
     const title=[...shown.querySelectorAll('.v9-stream-title')].find(e=>e.textContent==='MAIN TITLE');
     assert(title,'main title was not painted');
     assert(plan.mainTitleReserve===plan.titleHeight,`main title reserve missing: ${plan.mainTitleReserve}/${plan.titleHeight}`);
     const titleTop=parseFloat(title.style.top)||0;
     const firstMain=plan.mainBox.lines[0];
     assert(titleTop>=plan.crownBottomY+plan.crownMainGap-.15,
       `main title overlaps crown: titleY=${titleTop}, crownBottom=${plan.crownBottomY}`);
     assert(titleTop+plan.titleHeight<=firstMain.y+.15,'main title overlaps first main row');
     shown.remove();

     settings.main={...(settings.main||{}),titleShow:false};
     const hidden=makePage();
     const hiddenPlan=buildSinglePage(hidden,content,{...cfg,pageHeight:720,crownLines:4,crownMainGapPx:8,titles:{main:'MAIN TITLE'}});
     assert(![...hidden.querySelectorAll('.v9-stream-title')].some(e=>e.textContent==='MAIN TITLE'),'hidden main title was still painted');
     assert(hiddenPlan.mainTitleReserve===0,'hidden main title still reserved vertical space');
     hidden.remove();
   } finally {
     if(saved===undefined) delete settings.main; else settings.main=saved;
   }
 });

 await test('full note pagination keeps every new note start with its main reference',async()=>{
   const settings=getStreamSettings(),saved={};for(const id of ['01','02','03']){saved[id]=settings[id];settings[id]={...settings[id],mainRefEnabled:true};}
   const page=makePage();
   try {
     const text=Array(9).fill(neutral).join(' '),words=[...text.matchAll(/\S+/gu)],notes=[];
     for(let i=0;i<9;i++) {const stream=['01','02','03'][i%3],w=words[i*10+3];notes.push({stream,num:i+1,uid:`binding-${i}`,anchor:w.index+w[0].length,anchorAffinity:'backward',text:Array(i%3===2?3:2).fill(neutral).join(' ')});}
     const input=[{id:'binding-source',mainText:text,mainRuns:[{start:80,end:160,marks:{bold:true,color:'red'}}],notes},{id:'after-binding',mainText:neutral,notes:[]}];
     const result=await buildPages(page,input,{...cfg,pageHeight:280,levels:[['01','02'],['03']],streamSettings:{'01':{inlineStyle:{fontSize:11}},'02':{inlineStyle:{fontSize:11}},'03':{cols:2,inlineStyle:{fontSize:11}}}});
     assert(result.complete,'co-pagination incomplete');assert(result.pages.length>1,'fixture does not paginate');
     const rows=[...page.querySelectorAll('[data-v9-layout-final]')];
     for(const p of input)assert(rows.filter(el=>el.dataset.v9ParagraphId===p.id).map(sourceText).join('')===prepareV9SourceParagraph(p).mainText,'main source lost');
     const starts=new Map(),refs=new Map();
     result.pages.forEach((p,i)=>{
       assertNoWordOverlap(p);
       for(const ref of p.querySelectorAll('[data-v9-main-ref]')){assert(!refs.has(ref.dataset.uid),'duplicate main ref');refs.set(ref.dataset.uid,i);}
       for(const n of p.querySelectorAll('[data-v9-note-start]')){const id=n.dataset.v9NoteStart;if(starts.has(id))assert(starts.get(id)===i,'note start repeated on another page');else starts.set(id,i);}
     });
     for(const n of notes){const key=`binding-source:${n.stream}:${n.uid}`;assert(starts.has(key),`note missing ${key}`);assert(refs.get(n.uid)===starts.get(key),`note ${n.uid}: text page ${refs.get(n.uid)}, note page ${starts.get(key)}`);}
     return {pages:result.pages.length,notes:notes.length};
   }finally{page.remove();for(const id of ['01','02','03'])if(saved[id])settings[id]=saved[id];else delete settings[id];}
 });
 await test('marker normalization leaves bold covering complete intended word in DOM',async()=>{
   const raw='alpha@01beta gamma delta',at=raw.indexOf('beta'),m=mapMainParagraphSource(raw,[{start:at,end:at+4,marks:{bold:true,color:'rgb(255, 0, 0)'}}],[{atInPara:5,sym:'@01',code:'01'}]);
   const page=makePage();await buildPages(page,[{id:'bold-map',mainText:m.mainTextNet,mainRuns:m.mainRuns,notes:[]}],cfg);
   assert([...page.querySelectorAll('[style*="255, 0, 0"]')].map(e=>e.textContent).join('')==='beta','bold scope drifted after marker');page.remove();
 });
  for (const enabled of [false, true]) await test(`hidden mid-word reference has no invented whitespace; visible=${enabled}`,async()=>{
    const settings=getStreamSettings(),previous=settings['01'];settings['01']={mainRefEnabled:enabled,noteNumEnabled:false,lemmaBold:false};
    const raw='אל@01פא בית',m=mapMainParagraphSource(raw,[{start:0,end:raw.length,marks:{bold:true}}],[{atInPara:2,sym:'@01',code:'01'}]);
    const page=makePage();
    try {
      assert(m.mainTextNet==='אלפא בית','hidden marker introduced whitespace');
      const n={stream:'01',num:1,uid:'mid-word',anchor:m.mainConsumers[0].anchor,anchorAffinity:'backward',text:neutral};
      const result=await buildPages(page,[{id:'marker',mainText:m.mainTextNet,mainRuns:m.mainRuns,notes:[n]}],cfg);
      assert(result.complete,'marker fixture incomplete');
      const rows=[...page.querySelectorAll('[data-v9-layout-final]')];
      assert(rows.map(sourceText).join('')==='אלפא בית','painted source contains placeholder gap');
      assert(page.querySelectorAll('[data-v9-main-ref]').length===(enabled?1:0),'incorrect label visibility');
       if(!enabled){
         const body=page.querySelector('.v9-planned-line-text');
         assert(body,'hidden-reference fixture has no planned line body');
         assert(body.childNodes.length===1,
           `hidden reference still fragments inline content into ${body.childNodes.length} nodes`);
       }
    } finally {page.remove();if(previous)settings['01']=previous;else delete settings['01'];}
  });
  for (const onlyOneStream of [true,false]) await test(`every styled note survives all columns and carry-over; single=${onlyOneStream}`,async()=>{
    const settings=getStreamSettings(),saved={};for(const id of ['01','02','03','04']){saved[id]=settings[id];settings[id]={mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false,noteTextPrefix:'  ',noteTextSuffix:'   ',boldOverrideEnabled:false};}
    const page=makePage();
    try {
      const main=Array(7).fill(neutral).join(' '),words=[...main.matchAll(/\S+/gu)];
      const notes=Array.from({length:7},(_,i)=>{
        const text=`START${i} `+Array(i===2?16:3).fill(neutral).join(' ')+` END${i}`;
        const at=words[i*10+2];
        return {stream:onlyOneStream?'01':['01','02','03','04'][i%4],uid:`conserve-${i}`,num:i+1,anchor:at.index+at[0].length,anchorAffinity:'backward',text,
          runs:[{start:0,end:text.length,marks:i===2?{bold:true,color:'rgb(255, 0, 0)'}:{}},
                {start:8,end:Math.min(63,text.length),marks:{fontSize:17,fontFamily:'monospace'}}]};
      });
      const input={id:'conserve',mainText:main,notes};
      const result=await buildPages(page,[input,{id:'following',mainText:neutral,notes:[]}],{...cfg,pageHeight:320,levels:[['01','02'],['03','04']],streamSettings:{'03':{cols:2},'04':{cols:2}}});
      assert(result.complete,'incomplete styled-note pagination');
      const compact=s=>s.replace(/[\s\u200e\u200f\u2060]/gu,'');
      for(const note of notes) {
        const key=`conserve:${note.stream}:${note.uid}`;
        const segments=[...page.querySelectorAll('[data-v9-note-key]')].filter(e=>e.dataset.v9NoteKey===key);
        assert(compact(segments.map(e=>e.textContent).join(''))===compact(`[${note.num}] `+note.text),`lost/reordered text in ${key}`);
        if(note.num===3) {
          const sourceSpans=segments.filter(e=>e.textContent.trim()&&!e.textContent.includes('[3]'));
          assert(sourceSpans.length>2,'whole-bold fixture did not split');
          assert(sourceSpans.every(e=>+getComputedStyle(e).fontWeight>=700),'original whole-note bold was changed');
        }
        const refPage=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-main-ref]')].some(e=>e.dataset.uid===note.uid));
        const startPage=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-note-start]')].some(e=>e.dataset.v9NoteStart===key));
        assert(refPage===startPage && refPage>=0,`note ${note.uid} not on its source page`);
        const occupied=result.pages.map((p,i)=>p.querySelector(`[data-v9-note-key="${key}"]`)?i:-1).filter(i=>i>=0);
        for(let i=1;i<occupied.length;i++)assert(occupied[i]===occupied[i-1]+1,`note continuation skipped a page: ${key}`);
      }
      for(const p of result.pages){
        assertNoWordOverlap(p);
        const bottom=+p.style.height.replace('px','')-12;
        for(const l of p.querySelectorAll('.v9-line'))assert(parseFloat(l.style.top)+parseFloat(l.style.height)<=bottom+.1,'line escapes printable page');
      }
      return {pages:result.pages.length,notes:notes.length};
    } finally {page.remove();for(const id of ['01','02','03','04'])if(saved[id])settings[id]=saved[id];else delete settings[id];}
  });
  for(const longSide of ['right','left']) await test(`full crown reserves clearance above opposite side title; ${longSide}`,()=>{
    const page=makePage(),longText=Array(10).fill(phrase).join(' '),shortText='short note';
    const content={mainText:neutral,rightStream:{id:'01',items:[longSide==='right'?longText:shortText]},leftStream:{id:'02',items:[longSide==='left'?longText:shortText]},footerStreams:[]};
    const original=JSON.stringify(content),opts={...cfg,pageHeight:537,titles:{'01':'Notes A','02':'Notes B'},crownMainGapPx:8};
    const plan=buildSinglePage(page,content,opts);
    assert(plan.crownScenario.name==='one_full_one_short','fixture is not a full crown');
    assert(JSON.stringify(content)===original,'trial mutated caller content');
    const shortBox=plan.streamBoxes.find(b=>b.role!==longSide),first=shortBox.lines[0];
    const shortTitle=[...page.querySelectorAll('.v9-stream-title')].find(t=>t.textContent===opts.titles[shortBox.id]);
    assert(shortTitle && parseFloat(shortTitle.style.top)>=plan.crownBottomY+8-.1,'painted opposite title touches full crown');
    assert(first.y-plan.titleHeight>=plan.crownBottomY+8-.1,'side title touches full crown');
    assert(plan.mainBox.lines[0].y>=plan.crownBottomY+8-.1,'main touches full crown');
    assertNoWordOverlap(page);page.remove();
  });
  await test('styled numbering is measured without inheriting justification expansion',async()=>{
    const settings=getStreamSettings(),saved=settings['01'],styles=loadTextStyles();
    saveTextStyles([...styles,{id:'v9-number-regression',name:'Number regression',fontFamily:'monospace',fontSize:15,fontSizeUnit:'pt',superscript:true}]);
    settings['01']={mainRefEnabled:true,mainRefPrefix:' [ ',mainRefSuffix:' ] ',mainRefStyleId:'v9-number-regression',noteNumEnabled:true,noteNumStyleId:'v9-number-regression',lemmaBold:false};
    const page=makePage();
    try {
      const text=Array(6).fill(neutral).join(' '),words=[...text.matchAll(/\S+/gu)];
      const notes=Array.from({length:6},(_,i)=>({uid:`styled-number-${i}`,num:i+1,stream:'01',anchor:words[i*10+2].index+words[i*10+2][0].length,anchorAffinity:'backward',text:neutral}));
      const result=await buildPages(page,[{id:'numbered',mainText:text,notes}],{...cfg,pageHeight:537});
      assert(result.complete,'numbered pagination incomplete');
      for(const p of result.pages){
        assertNoWordOverlap(p);
        for(const l of p.querySelectorAll('.v9-line')) {
          const body=l.querySelector('.v9-planned-line-text,.v9-planned-stream-text');
          assert(body.scrollWidth<=parseFloat(l.style.width)+1,`styled label made row overflow: ${body.scrollWidth}>${l.style.width}`);
        }
      }
      assert(page.querySelectorAll('[data-v9-main-ref]').length===notes.length,'styled number missing');
    } finally {page.remove();saveTextStyles(styles);if(saved)settings['01']=saved;else delete settings['01'];}
  });
  await test('base bold style X does not promote whole main text to override Y',async()=>{
    const settings=getStreamSettings(),savedMain=settings.main,styles=loadTextStyles();
    saveTextStyles([
      ...styles,
      {id:'v9-main-base-bold-semantic',name:'Base X',fontFamily:'sans-serif',fontSize:13,fontSizeUnit:'px',bold:true},
      {id:'v9-main-bold-choice-semantic',name:'Bold Y',fontFamily:'monospace',fontSize:17,fontSizeUnit:'px',bold:true}
    ]);
    settings.main={...(settings.main||{}),boldOverrideEnabled:true,boldOverrideStyleId:'v9-main-bold-choice-semantic',boldOverrideForcesDocStyles:true};
    const page=makePage();
    try {
      const text='alpha beta gamma';
      const result=await buildPages(page,[{id:'main-bold-semantic',mainText:text,
        mainRuns:[
          {start:0,end:5,marks:{fontFamily:'serif',fontSize:15,fontSizeUnit:'px'}},
          {start:6,end:10,marks:{fontFamily:'serif',fontSize:15,fontSizeUnit:'px',bold:true}},
          {start:11,end:16,marks:{fontFamily:'serif',fontSize:15,fontSizeUnit:'px'}}
        ],notes:[]}],
        {...cfg,pageHeight:260,talmudStreams:[],mainStyleId:'v9-main-base-bold-semantic'});
      assert(result.complete,'semantic bold fixture incomplete');
      const body=page.querySelector('[data-v9-paragraph-id="main-bold-semantic"] .v9-planned-line-text');
      assert(body,'missing main body');
      const spans=[...body.querySelectorAll('span')].filter(el=>el.textContent.trim());
      const beta=spans.find(el=>el.textContent.trim()==='beta');
      assert(beta,`explicit bold beta span missing: ${spans.map(x=>x.textContent).join('|')}`);
      const base=getComputedStyle(body),b=getComputedStyle(beta);
      assert(base.fontFamily.toLowerCase().includes('sans-serif'),`selected X font missing from ordinary text: ${base.fontFamily}`);
      assert(!base.fontFamily.toLowerCase().includes('monospace'),'base X promoted whole document to Y');
      assert(b.fontFamily.toLowerCase().includes('monospace'),`explicit bold beta did not receive Y: ${b.fontFamily}`);
      assert(parseFloat(b.fontSize)>=16.5,`explicit bold beta missed Y size: ${b.fontSize}`);
      assert(!spans.some(el=>['alpha','gamma'].includes(el.textContent.trim()) && getComputedStyle(el).fontFamily.toLowerCase().includes('serif')),
        'Word font survived on non-bold source despite override ON');
    } finally {
      page.remove();saveTextStyles(styles);
      if(savedMain===undefined) delete settings.main; else settings.main=savedMain;
    }
  });

  await test('source style fontWeight 700 receives Y while base X bold alone does not',async()=>{
    const settings=getStreamSettings(),savedMain=settings.main,styles=loadTextStyles();
    saveTextStyles([
      ...styles,
      {id:'v9-main-base-x-fontweight',name:'Base X',fontFamily:'sans-serif',fontSize:13,fontSizeUnit:'px',bold:true},
      {id:'v9-main-bold-y-fontweight',name:'Bold Y',fontFamily:'monospace',fontSize:17,fontSizeUnit:'px',bold:true}
    ]);
    settings.main={...(settings.main||{}),boldOverrideEnabled:true,boldOverrideStyleId:'v9-main-bold-y-fontweight',boldOverrideForcesDocStyles:true};
    const page=makePage();
    try {
      const input=[
        {id:'source-bold-style',mainText:'alpha beta',mainRuns:[],style:{fontFamily:'serif',fontSize:'15px',fontWeight:'700'},notes:[]},
        {id:'base-x-only',mainText:'gamma delta',mainRuns:[],style:{fontFamily:'serif',fontSize:'15px',fontWeight:'400'},notes:[]}
      ];
      const result=await buildPages(page,input,{...cfg,pageHeight:300,talmudStreams:[],mainStyleId:'v9-main-base-x-fontweight'});
      assert(result.complete,'source-style bold fixture incomplete');
      const boldRow=page.querySelector('[data-v9-paragraph-id="source-bold-style"] .v9-planned-line-text');
      const plainRow=page.querySelector('[data-v9-paragraph-id="base-x-only"] .v9-planned-line-text');
      assert(boldRow&&plainRow,'missing source-style rows');
      const boldSpan=[...boldRow.querySelectorAll('span')].find(el=>el.textContent.trim());
      assert(boldSpan,'source paragraph bold style was not converted to a Y run');
      const b=getComputedStyle(boldSpan),p=getComputedStyle(plainRow);
      assert(b.fontFamily.toLowerCase().includes('monospace'),`style-defined bold did not receive Y: ${b.fontFamily}`);
      assert(parseFloat(b.fontSize)>=16.5,`style-defined bold missed Y size: ${b.fontSize}`);
      assert(!p.fontFamily.toLowerCase().includes('monospace'),`base X bold promoted non-bold source to Y: ${p.fontFamily}`);
      assert(p.fontFamily.toLowerCase().includes('sans-serif'),`selected X did not override source Word font: ${p.fontFamily}`);
      assert(![...plainRow.querySelectorAll('span')].some(el=>getComputedStyle(el).fontFamily.toLowerCase().includes('serif')),
        'source serif font survived in plain paragraph');
    } finally {
      page.remove();saveTextStyles(styles);
      if(savedMain===undefined) delete settings.main; else settings.main=savedMain;
    }
  });

  await test('snapshot case: explicit Word Arial cannot beat selected X, explicit bold still gets Y',async()=>{
    const settings=getStreamSettings(),savedMain=settings.main,styles=loadTextStyles();
    saveTextStyles([
      ...styles,
      {id:'v9-main-snapshot-x',name:'Snapshot X',fontFamily:'FrankRuehl DP',fontSize:13,fontSizeUnit:'px',bold:true},
      {id:'v9-main-snapshot-y',name:'Snapshot Y',fontFamily:'PFT_Vilna',fontSize:9,fontSizeUnit:'px',bold:true}
    ]);
    settings.main={...(settings.main||{}),boldOverrideEnabled:true,boldOverrideStyleId:'v9-main-snapshot-y',boldOverrideForcesDocStyles:true};
    const page=makePage();
    try {
      const text='alpha beta gamma';
      const result=await buildPages(page,[{id:'snapshot-font',mainText:text,
        mainRuns:[
          {start:0,end:5,marks:{fontFamily:'Arial'}},
          {start:6,end:10,marks:{fontFamily:'Arial',bold:true}},
          {start:11,end:16,marks:{}}
        ],notes:[]}],
        {...cfg,pageHeight:260,talmudStreams:[],mainStyleId:'v9-main-snapshot-x'});
      assert(result.complete,'snapshot font fixture incomplete');
      const body=page.querySelector('[data-v9-paragraph-id="snapshot-font"] .v9-planned-line-text');
      assert(body,'snapshot font body missing');
      const spans=[...body.querySelectorAll('span')].filter(x=>x.textContent.trim());
      const beta=spans.find(x=>x.textContent.trim()==='beta');
      assert(beta,`snapshot bold span missing: ${spans.map(x=>x.textContent).join('|')}`);
      const a=getComputedStyle(body),b=getComputedStyle(beta);
      assert(!a.fontFamily.toLowerCase().includes('arial'),`Word Arial survived override ON at body level: ${a.fontFamily}`);
      assert(a.fontFamily.toLowerCase().includes('frankruehl'),`selected X font missing: ${a.fontFamily}`);
      assert(!spans.some(el=>getComputedStyle(el).fontFamily.toLowerCase().includes('arial')),
        'an explicit Word Arial span survived override ON');
      assert(b.fontFamily.toLowerCase().includes('pft_vilna'),`explicit source bold did not get Y: ${b.fontFamily}`);
      assert(Math.abs(parseFloat(b.fontSize)-9)<.7,`Y size missing: ${b.fontSize}`);
    } finally {
      page.remove();saveTextStyles(styles);
      if(savedMain===undefined) delete settings.main; else settings.main=savedMain;
    }
  });

  await test('main bold override checkbox off preserves Word font on explicit bold',async()=>{
    const settings=getStreamSettings(),savedMain=settings.main,styles=loadTextStyles();
    saveTextStyles([
      ...styles,
      {id:'v9-main-base-bold-test-off',name:'Base X off',fontFamily:'sans-serif',fontSize:13,fontSizeUnit:'px',bold:true},
      {id:'v9-main-bold-choice-test-off',name:'Bold Y off',fontFamily:'monospace',fontSize:17,fontSizeUnit:'px',bold:true}
    ]);
    settings.main={...(settings.main||{}),boldOverrideEnabled:true,boldOverrideStyleId:'v9-main-bold-choice-test-off',boldOverrideForcesDocStyles:false};
    const page=makePage();
    try {
      const text='alpha beta gamma';
      const result=await buildPages(page,[{id:'main-bold-base-off',mainText:text,
        mainRuns:[{start:6,end:10,marks:{fontFamily:'serif',fontSize:15,fontSizeUnit:'px',bold:true}}],notes:[]}],
        {...cfg,pageHeight:260,talmudStreams:[],mainStyleId:'v9-main-base-bold-test-off'});
      assert(result.complete,'main bold opt-out fixture incomplete');
      const span=[...page.querySelectorAll('.v9-planned-line-text span')].find(el=>el.textContent.trim()==='beta');
      assert(span,'missing explicit bold Word span');
      const cs=getComputedStyle(span);
      assert(cs.fontFamily.toLowerCase().includes('serif'),`unchecked override did not preserve Word font: ${cs.fontFamily}`);
      assert(Math.abs(parseFloat(cs.fontSize)-15)<.6,`unchecked override did not preserve Word size: ${cs.fontSize}`);
    } finally {
      page.remove();saveTextStyles(styles);
      if(savedMain===undefined) delete settings.main; else settings.main=savedMain;
    }
  });

  await test('secondary Mishnah level 03/04 flows analytically beside and below its float',()=>{
    const page=makePage();
    const short='alpha beta gamma delta';
    const long=Array(14).fill(phrase).join(' ');
    const plan=buildSinglePage(page,{
      mainText:'main text',
      rightStream:null,leftStream:null,
      footerStreams:[
        {id:'03',items:[short],runs:[],rich:{text:short,runs:[]}},
        {id:'04',items:[long],runs:[],rich:{text:long,runs:[]}}
      ]
    },{
      ...cfg,pageHeight:720,talmudStreams:['01','02'],mishnaWrapOn:true,
      levels:[['01','02'],['03','04']],
      streamSettings:{
        '03':{mishnaSide:'right',inlineStyle:{fontSize:11}},
        '04':{inlineStyle:{fontSize:11}}
      }
    });
    const b3=plan.footerBoxes.find(b=>b.id==='03'),b4=plan.footerBoxes.find(b=>b.id==='04');
    assert(b3&&b4,'Mishnah level boxes missing');
    assert(b3.mishnaRole==='float'&&b4.mishnaRole==='flow',`wrong Mishnah roles: ${b3.mishnaRole}/${b4.mishnaRole}`);
    assert(Math.abs(b3.titleY-b4.titleY)<.1,'03/04 do not start in one Mishnah level');
    assert(b3.titleX>b4.titleX,'configured right float is not on the right');
    assert(b3.titleWidth<plan.pageBox.innerWidth*.75,'03 is still a full-width footer');
    assert(b4.lines.length>2,'long flow fixture too short');
    const firstWidth=b4.lines[0].width;
    const expanded=b4.lines.some(l=>l.width>firstWidth+40 && l.y>=Math.max(...b3.lines.map(x=>x.y+x.lineHeightPx))-.1);
    assert(expanded,'04 never expands to full width below 03');
    assert(!plan.overflow.streams['03'],'short Mishnah float overflowed');
    page.remove();
  });

  await test('two fixed Talmud streams plus two explicit Mishnah streams keep 2+2 geometry',()=>{
    const page=makePage();
    const sideText=Array(8).fill(phrase).join(' ');
    const short='alpha beta gamma delta';
    const long=Array(14).fill(phrase).join(' ');
    const plan=buildSinglePage(page,{
      mainText:'main text',
      rightStream:{id:'01',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      leftStream:{id:'02',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      footerStreams:[
        {id:'03',items:[short],runs:[],rich:{text:short,runs:[]}},
        {id:'04',items:[long],runs:[],rich:{text:long,runs:[]}}
      ]
    },{
      ...cfg,pageHeight:900,mishnaWrapOn:false,levels:[],
      streamSettings:{
        '01':{inlineStyle:{fontSize:11}},
        '02':{inlineStyle:{fontSize:11}},
        '03':{layoutRole:'mishna',mishnaSide:'right',inlineStyle:{fontSize:11}},
        '04':{layoutRole:'mishna',inlineStyle:{fontSize:11}}
      }
    });
    const right=plan.streamBoxes.find(b=>b.id==='01');
    const left=plan.streamBoxes.find(b=>b.id==='02');
    const b3=plan.footerBoxes.find(b=>b.id==='03');
    const b4=plan.footerBoxes.find(b=>b.id==='04');
    assert(right&&left,'fixed Talmud side streams were displaced');
    assert(b3&&b4,'explicit Mishnah footer pair missing');
    assert(b3.mishnaRole==='float'&&b4.mishnaRole==='flow',`wrong explicit Mishnah roles: ${b3.mishnaRole}/${b4.mishnaRole}`);
    assert(b3.mishnaSource==='layoutRole'&&b4.mishnaSource==='layoutRole','explicit Mishnah source not recorded');
    assert(Math.abs(b3.titleY-b4.titleY)<.1,'explicit Mishnah streams do not start together');
    assert(b3.titleWidth<plan.pageBox.innerWidth*.75,'explicit Mishnah stream is still a full-width footer');
    page.remove();
  });

  await test('main-bottom gap is reserved in the V9 plan and post-pass cannot move painted geometry',()=>{
    const page=makePage();
    const footerText=Array(5).fill(neutral).join(' ');
    const requested=28;
    const plan=buildSinglePage(page,{
      mainText:Array(3).fill(neutral).join(' '),
      rightStream:null,leftStream:null,
      footerStreams:[{id:'03',items:[footerText],runs:[],rich:{text:footerText,runs:[]}}],
      titles:{'03':'הערות'}
    },{...cfg,talmudStreams:[],pageHeight:620,mainBottomGapPx:requested,
      titles:{'03':'הערות'},streamSettings:{'03':{inlineStyle:{fontSize:11}}}});

    assert(plan.mainBox?.lines?.length,'fixture has no main lines');
    assert(plan.footerBoxes?.length,'fixture has no footer box');
    assert(plan.mainBottomGapPlan?.boundary==='main',
      `main did not own footer boundary: ${JSON.stringify(plan.mainBottomGapPlan)}`);

    const mainBottom=Math.max(...plan.mainBox.lines.map(l=>l.y+l.lineHeightPx));
    const footerTop=plan.footerBoxes[0].titleY;
    assert(footerTop-mainBottom>=requested-.15,
      `planned main/footer gap too small: ${footerTop-mainBottom} < ${requested}`);

    const positioned=[...page.querySelectorAll('.v9-line,.v9-stream-title,.v9-main-separator')];
    const before=positioned.map(el=>el.style.top);
    const diag=applyV9MainBottomGapToPage(page,{gapPx:50});
    const after=positioned.map(el=>el.style.top);
    assert(JSON.stringify(before)===JSON.stringify(after),
      'post-render main-bottom pass moved V9 geometry');
    assert(diag?.applied===0&&diag?.authority==='planner',
      `post-pass is not diagnostic-only: ${JSON.stringify(diag)}`);
    page.remove();
  });

  await test('main-bottom gap never adds an extra blank slot after a lower side stream',()=>{
    const page=makePage();
    const sideText=Array(10).fill(phrase).join(' ');
    const footerText=Array(3).fill(neutral).join(' ');
    const plan=buildSinglePage(page,{
      mainText:'אחד שניים שלוש ארבע',
      rightStream:{id:'01',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      leftStream:{id:'02',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      footerStreams:[{id:'03',items:[footerText],runs:[],rich:{text:footerText,runs:[]}}],
      titles:{'03':'הערות'}
    },{...cfg,pageHeight:1100,crownLines:2,mainBottomGapPx:50,
      titles:{'03':'הערות'},streamSettings:{
        '01':{inlineStyle:{fontSize:11,lineHeight:1.45}},
        '02':{inlineStyle:{fontSize:12,lineHeight:1.6}},
        '03':{inlineStyle:{fontSize:11}},
      }});

    assert(plan.footerBoxes?.length,'fixture has no footer');
    assert(plan.mainBottomGapPlan?.boundary==='side-stream',
      `side stream did not own footer boundary: ${JSON.stringify(plan.mainBottomGapPlan)}`);
    assert(plan.mainBottomGapPlan.planned===plan.mainBottomGapPlan.interStreamGap,
      `main bottom gap leaked below side stream: ${JSON.stringify(plan.mainBottomGapPlan)}`);

    const sideBottom=Math.max(...plan.streamBoxes.flatMap(b=>(b.lines||[]).map(l=>l.y+l.lineHeightPx)));
    const footerTop=plan.footerBoxes[0].titleY;
    const actualGap=footerTop-sideBottom;
    assert(Math.abs(actualGap-plan.mainBottomGapPlan.interStreamGap)<.2,
      `side→footer gap changed by mainBottomGap: ${actualGap}`);
    page.remove();
  });

  await test('legacy audit: side commentaries widen after a short main text ends',()=>{
    const page=makePage();
    const sideText=Array(22).fill(phrase).join(' ');
    const plan=buildSinglePage(page,{
      mainText:'אחד שניים שלוש ארבע',
      rightStream:{id:'01',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      leftStream:{id:'02',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      footerStreams:[]
    },{...cfg,pageHeight:720,crownLines:2,streamSettings:{'01':{inlineStyle:{fontSize:11}},'02':{inlineStyle:{fontSize:11}}}});
    const main=plan.mainBox;
    const right=plan.streamBoxes.find(b=>b.role==='right');
    assert(main&&right&&right.lines.length>3,'fixture did not produce main plus side commentary');
    const mainBottom=(main.y||0)+(main.height||0);
    const before=right.lines.filter(l=>l.y<mainBottom-.1);
    const after=right.lines.filter(l=>l.y>=mainBottom-.1);
    assert(before.length&&after.length,'fixture does not cross the end of the main text');
    const narrow=Math.min(...before.map(l=>l.width));
    const widened=Math.max(...after.map(l=>l.width));
    assert(widened>narrow+25,`commentary did not widen below main: ${narrow} -> ${widened}`);
    page.remove();
  });

  await test('commentary knee never inserts a blank row when crown→main gap is off the stream grid',()=>{
    const page=makePage();
    const sideText=Array(38).fill(phrase).join(' ');
    const plan=buildSinglePage(page,{
      mainText:Array(3).fill(neutral).join(' '),
      rightStream:{id:'01',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      leftStream:{id:'02',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      footerStreams:[]
    },{...cfg,pageHeight:760,crownLines:4,crownMainGapPx:11,streamSettings:{
      '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
      '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
    }});
    assert(plan.crownMainGap===11,`fixture lost crown→main gap: ${plan.crownMainGap}`);
    for(const role of ['right','left']){
      const box=plan.streamBoxes.find(b=>b.role===role);
      assert(box&&box.lines.length>4,`missing ${role} commentary rows`);
      const sorted=[...box.lines].sort((a,b)=>a.y-b.y);
      let transition=null;
      for(let i=1;i<sorted.length;i++){
        if(sorted[i].width>sorted[i-1].width+20){
          transition={prev:sorted[i-1],wide:sorted[i]};
          break;
        }
      }
      assert(transition,`${role} fixture did not create a knee`);
      const pitch=Number(transition.prev.lineHeightPx)||Number(transition.wide.lineHeightPx)||1;
      const dy=transition.wide.y-transition.prev.y;
      assert(Math.abs(dy-pitch)<.2,
        `${role} knee changed the row pitch: dy=${dy}, pitch=${pitch}`);
    }
    assertNoWordOverlap(page);
    page.remove();
  });

  await test('side streams widen on their own row grids without forcing a shared off-grid boundary',()=>{
    const page=makePage();
    const sideText=Array(34).fill(phrase).join(' ');
    const plan=buildSinglePage(page,{
      mainText:'אחד שניים שלוש ארבע חמש',
      rightStream:{id:'01',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      leftStream:{id:'02',items:[sideText],runs:[],rich:{text:sideText,runs:[]}},
      footerStreams:[]
    },{...cfg,pageHeight:760,crownLines:2,streamSettings:{
      '01':{inlineStyle:{fontSize:11,lineHeight:1.45}},
      '02':{inlineStyle:{fontSize:12,lineHeight:1.6}},
    }});
    const mainBottom=(plan.mainBox?.y||0)+(plan.mainBox?.height||0);
    const boxes=['right','left'].map(role=>plan.streamBoxes.find(b=>b.role===role));
    assert(boxes.every(Boolean),'missing side boxes');
    for(const box of boxes){
      const sorted=[...box.lines].sort((a,b)=>a.y-b.y);
      const prior=sorted.filter(l=>l.y<mainBottom-.1);
      const narrow=prior.length ? Math.min(...prior.map(l=>l.width)) : Math.min(...sorted.map(l=>l.width));
      const wideIndex=sorted.findIndex(l=>l.y>=mainBottom-.1 && l.width>narrow+20);
      assert(wideIndex>0,`fixture did not create a wide continuation row for ${box.role}`);
      const prev=sorted[wideIndex-1],wide=sorted[wideIndex];
      const pitch=Number(prev.lineHeightPx)||Number(wide.lineHeightPx)||1;
      const dy=wide.y-prev.y;
      assert(Math.abs(dy-pitch)<.2,
        `${box.role} widened off its own row grid: dy=${dy}, pitch=${pitch}`);
    }
    assertNoWordOverlap(page);
    page.remove();
  });


  await test('cross-geometry: crown gap + knee + dropped opening share one row grid and full visual width',()=>{
    const openingSettings={
      enabled:true,target:'word',count:1,font:'serif',size:180,weight:'bold',
      position:'dropped',dropLines:2,spaceAfter:0.3,scope:'all',
      skipHeadings:false,skipSingleLine:false,skipShortLine:false,skipFewerThanLines:false,minLines:3,shortLineMinFill:0.65
    };
    const shortSide=Array(8).fill(phrase).join(' ');
    const longSide=Array(34).fill(phrase).join(' ');
    let found=null;

    // Search a small deterministic fixture space instead of baking one fragile
    // word count. The invariant is geometric: find a real page where the second
    // main paragraph starts after a narrow→wide transition, then audit it.
    for(let leadRepeats=1;leadRepeats<=14 && !found;leadRepeats++){
      const page=makePage();
      const lead=Array(leadRepeats).fill(neutral).join(' ');
      const openingText='פתיח '+Array(5).fill(neutral).join(' ');
      const mainText=lead+'\n'+openingText;
      const plan=buildSinglePage(page,{
        mainText,
        mainParagraphs:[
          {id:'cross-lead',index:1,text:lead,runs:[],mainRefs:[],continues:false},
          {id:'cross-opening',index:2,text:openingText,runs:[],mainRefs:[],continues:false},
        ],
        rightStream:{id:'01',items:[shortSide],runs:[],rich:{text:shortSide,runs:[]}},
        leftStream:{id:'02',items:[longSide],runs:[],rich:{text:longSide,runs:[]}},
        footerStreams:[]
      },{
        ...cfg,pageHeight:760,crownLines:4,crownMainGapPx:11,
        openingWordSettings:openingSettings,
        streamSettings:{
          '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
          '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
        }
      });

      const lines=plan.mainBox?.lines||[];
      const op=lines.find(l=>l.source?.paragraphId==='cross-opening' && l.render?.opening);
      if(!op){page.remove();continue;}
      const previous=lines.filter(l=>l.y<op.y-.1);
      if(!previous.length){page.remove();continue;}
      const narrowBefore=Math.min(...previous.slice(-4).map(l=>Number(l.width)||0));
      const hostFull=Number(op.openingHostFullWidth)||0;
      const visualWidth=(Number(op.width)||0)+(Number(op.render.opening?.gap)||0)+(Number(op.render.opening?.width)||0);
      if(hostFull>narrowBefore+20){
        found={page,plan,op,narrowBefore,hostFull,visualWidth};
      }else page.remove();
    }

    assert(found,'fixture search never produced opening after a real main widening knee');
    try{
      const {plan,op,narrowBefore,hostFull,visualWidth}=found;
      assert(plan.crownMainGap===11,`crown gap drifted: ${plan.crownMainGap}`);
      assert(hostFull>narrowBefore+20,`opening row did not actually widen: ${narrowBefore} -> ${hostFull}`);
      assert(Math.abs(visualWidth-hostFull)<.75,
        `opening occupies only a partial wide row: body=${op.width}, opening=${op.render.opening.width}, gap=${op.render.opening.gap}, visual=${visualWidth}, host=${hostFull}`);
      assert(op.render.opening.part.text==='פתיח',`unexpected opening segment: ${op.render.opening.part.text}`);

      const analysis=analyzePageElement(found.page,0,{bottomGapWarningLines:100});
      assert(!analysis.issues.some(i=>i.code==='knee-row-gap'),
        `layout report falsely flags the validated knee: ${JSON.stringify(analysis.knees)}`);
      assert(!analysis.issues.some(i=>i.code==='opening-center'),
        `layout report falsely flags the validated opening center: ${JSON.stringify(analysis.openingCentering)}`);

      // Side-stream knees on the same page must also remain one normal pitch.
      for(const role of ['right','left']){
        const box=plan.streamBoxes.find(b=>b.role===role);
        if(!box?.lines?.length) continue;
        const sorted=[...box.lines].sort((a,b)=>a.y-b.y);
        for(let i=1;i<sorted.length;i++){
          if(sorted[i].width>sorted[i-1].width+20){
            const pitch=Number(sorted[i-1].lineHeightPx)||Number(sorted[i].lineHeightPx)||1;
            const dy=sorted[i].y-sorted[i-1].y;
            assert(Math.abs(dy-pitch)<.2,
              `${role} knee lost row grid in combined fixture: dy=${dy}, pitch=${pitch}`);
            break;
          }
        }
      }
    }finally{found.page.remove();}
  });

  await test('legacy audit: heavy mixed pagination keeps every rendered row inside the physical page',async()=>{
    const page=makePage();
    const main=Array(9).fill(neutral).join(' ');
    const words=[...main.matchAll(/\S+/gu)];
    const input=Array.from({length:5},(_,pi)=>({
      id:`legacy-overflow-${pi}`,mainText:main,
      notes:Array.from({length:6},(_,ni)=>{
        const w=words[Math.min(words.length-1,ni*8+3)];
        return {stream:['01','02','03'][ni%3],uid:`legacy-overflow-${pi}-${ni}`,num:ni+1,
          anchor:w.index+w[0].length,anchorAffinity:'backward',text:Array(4+(ni%3)).fill(neutral).join(' ')};
      })
    }));
    const localCfg={...cfg,pageHeight:280,maxPages:120,levels:[['01','02'],['03']],mishnaWrapOn:true,
      streamSettings:{'01':{inlineStyle:{fontSize:11}},'02':{inlineStyle:{fontSize:11}},'03':{cols:2,inlineStyle:{fontSize:11}}}};
    const result=await buildPages(page,input,localCfg);
    assert(result.complete,'heavy mixed pagination did not complete');
    for(const [pageIndex,p] of result.pages.entries()){
      for(const line of p.querySelectorAll('.v9-line')){
        const top=parseFloat(line.style.top)||0;
        const height=parseFloat(line.style.height)||line.getBoundingClientRect().height||0;
        assert(top+height<=localCfg.pageHeight+0.75,
          `row crosses page bottom on page ${pageIndex}: ${top}+${height} > ${localCfg.pageHeight}`);
      }
    }
    page.remove();
    return {pages:result.pages.length};
  });

  await test('legacy audit: one long commentary stream really occupies both sides',()=>{
    const page=makePage();
    const main=Array(5).fill(neutral).join(' ');
    const commentary=Array(24).fill(phrase).join(' ');
    const plan=buildSinglePage(page,{
      mainText:main,
      rightStream:{id:'01',items:[commentary],runs:[],rich:{text:commentary,runs:[]}},
      leftStream:null,
      footerStreams:[]
    },{...cfg,pageHeight:720,crownLines:4,balanceSingleStreamSides:true});
    assert(plan.crownScenario?.name==='one_long_split',`fixture did not enter one_long_split: ${plan.crownScenario?.name}`);
    const right=plan.streamBoxes.find(b=>b.role==='right'&&b.id==='01');
    const left=plan.streamBoxes.find(b=>b.role==='left'&&b.id==='01');
    assert(right&&left,'single commentary was not split across both sides');
    assert(right.lines.length>0&&left.lines.length>0,'one side of the split commentary is empty');
    const pitch=Math.max(right.lines[0]?.lineHeightPx||0,left.lines[0]?.lineHeightPx||0,1);
    assert(Math.abs((right.endY||0)-(left.endY||0))<=pitch*1.6,
      `single-stream sides end at very different heights: ${right.endY}/${left.endY}`);
    page.remove();
  });

  await test('legacy audit: one short commentary with no main text uses the free full width',()=>{
    const page=makePage();
    const commentary='alpha beta gamma delta';
    const plan=buildSinglePage(page,{
      mainText:'',
      rightStream:{id:'01',items:[commentary],runs:[],rich:{text:commentary,runs:[]}},
      leftStream:null,
      footerStreams:[]
    },{...cfg,pageHeight:300,crownLines:4});
    assert(plan.mainBox===null,'empty main text created a phantom main box');
    assert(plan.crownScenario?.name==='one_short_no_crown',`unexpected no-main scenario: ${plan.crownScenario?.name}`);
    const box=plan.streamBoxes.find(b=>b.id==='01');
    assert(box&&box.lines.length>0,'no-main commentary disappeared');
    assert(box.lines[0].width>=plan.pageBox.innerWidth-1,
      `no-main commentary still reserves an empty central column: ${box.lines[0].width}/${plan.pageBox.innerWidth}`);
    page.remove();
  });

  await test('legacy audit: a footer title is never published without at least one content row',()=>{
    const page=makePage();
    const footer='alpha beta gamma delta epsilon';
    const plan=buildSinglePage(page,{
      mainText:Array(14).fill(neutral).join(' '),
      rightStream:null,
      leftStream:null,
      footerStreams:[{id:'03',items:[footer],runs:[],rich:{text:footer,runs:[]}}]
    },{...cfg,pageHeight:125,talmudStreams:[],streamSettings:{'03':{inlineStyle:{fontSize:11}}}});
    const box=plan.footerBoxes.find(b=>b.id==='03');
    assert(!box,'footer title/content box was created even though no content row fits');
    assert(plan.overflow?.streams?.['03']?.text===footer,'footer content was not carried intact to overflow');
    assert(page.querySelectorAll('.v9-stream-title').length===0,'orphan stream title was painted');
    page.remove();
  });

  await test('short heading is not published as a one-line intermediate page',async()=>{
    const settings=getStreamSettings(),saved=settings['01'];
    settings['01']={...(settings['01']||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};
    const page=makePage();
    try {
      const body=Array(8).fill(neutral).join(' ');
      const words=[...body.matchAll(/\S+/gu)],w=words[5];
      const input=[
        {id:'orphan-heading',blockType:'heading',headingLevel:1,mainText:'SECTION TITLE',notes:[]},
        {id:'orphan-body',mainText:body,notes:[{stream:'01',uid:'orphan-heading-note',num:1,anchor:w.index+w[0].length,anchorAffinity:'backward',text:Array(24).fill(neutral).join(' ')}]},
        {id:'orphan-after',mainText:Array(4).fill(neutral).join(' '),notes:[]}
      ];
      const result=await buildPages(page,input,{...cfg,pageHeight:260,talmudStreams:['01','02'],maxPages:40});
      assert(result.complete,'heading orphan fixture incomplete');
      const bad=result.pages.slice(0,-1).find((p)=>{
        const mains=[...p.querySelectorAll('.v9-role-main')];
        const streams=[...p.querySelectorAll('.v9-line:not(.v9-role-main)')];
        return mains.length===1 &&
          mains[0].dataset.v9ParagraphId==='orphan-heading' &&
          streams.length===0;
      });
      assert(!bad,'heading was published alone on an intermediate page');
      assert((result.noteAnchorFallbacks||[]).length===0,'heading rescue broke note ownership');
    } finally {page.remove();if(saved===undefined)delete settings['01'];else settings['01']=saved;}
  });

  await test('short stream carry shares the next page instead of creating a drain-marker page',async()=>{
    const settings=getStreamSettings(),saved=settings['03'];
    settings['03']={...(settings['03']||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};
    const page=makePage();
    try {
      const first=Array(7).fill(neutral).join(' '),words=[...first.matchAll(/\S+/gu)],w=words[7];
      const input=[
        {id:'carry-owner',mainText:first,notes:[{stream:'03',uid:'carry-tail-note',num:1,anchor:w.index+w[0].length,anchorAffinity:'backward',text:Array(35).fill(neutral).join(' ')}]},
        {id:'carry-next-a',mainText:Array(6).fill(neutral).join(' '),notes:[]},
        {id:'carry-next-b',mainText:Array(6).fill(neutral).join(' '),notes:[]}
      ];
      const result=await buildPages(page,input,{...cfg,pageHeight:260,talmudStreams:['01','02'],mishnaWrapOn:false,maxPages:50});
      assert(result.complete,'carry-tail fixture incomplete');
      assert(result.pages.length>1,'carry-tail fixture did not paginate');
      const sparseCarry=result.pages.slice(0,-1).find((p)=>{
        const mainCount=p.querySelectorAll('.v9-role-main').length;
        const streamCount=p.querySelectorAll('.v9-line:not(.v9-role-main)').length;
        let bottom=0;
        for(const l of p.querySelectorAll('.v9-line')){
          const y=parseFloat(l.style.top)||0,h=parseFloat(l.style.height)||0;
          bottom=Math.max(bottom,y+h);
        }
        const fill=bottom/(260-12);
        return mainCount===0 && streamCount>0 && streamCount<=3 && fill<0.50;
      });
      assert(!sparseCarry,'obsolete drain-marker behavior produced a sparse carry-only page');
      assert((result.noteAnchorFallbacks||[]).length===0,'carry-tail rescue broke note ownership');
    } finally {page.remove();if(saved===undefined)delete settings['03'];else settings['03']=saved;}
  });

  await test('legal note continuation does not create very short intermediate pages',async()=>{
    const settings=getStreamSettings(),saved={};
    for(const id of ['01','02']){saved[id]=settings[id];settings[id]={...(settings[id]||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};}
    const page=makePage();
    try {
      const input=Array.from({length:6},(_,i)=>{
        const text=Array(3).fill(neutral).join(' ');
        const words=[...text.matchAll(/\S+/gu)],w=words[5+i%8];
        return {id:`fill-source-${i}`,mainText:text,notes:[{
          stream:i%2?'02':'01',uid:`fill-note-${i}`,num:i+1,
          anchor:w.index+w[0].length,anchorAffinity:'backward',
          text:Array(10+(i%3)*3).fill(neutral).join(' ')
        }]};
      });
      const result=await buildPages(page,input,{...cfg,pageHeight:300,talmudStreams:['01','02'],maxPages:80});
      assert(result.complete,'underfill fixture incomplete');
      assert(result.pages.length>2,'underfill fixture did not paginate');
      const fills=result.pages.slice(0,-1).map((p)=>{
        let bottom=0;
        for(const l of p.querySelectorAll('.v9-line')){
          const y=parseFloat(l.style.top)||0,h=parseFloat(l.style.height)||0;
          bottom=Math.max(bottom,y+h);
        }
        return bottom/(300-12);
      });
      const minFill=Math.min(...fills);
      assert(minFill>=0.50,`very short intermediate page survived: min fill=${minFill.toFixed(3)}, fills=${fills.map(x=>x.toFixed(3)).join(',')}`);
      assert((result.noteAnchorFallbacks||[]).length===0,`anchor fallback in fill fixture: ${JSON.stringify(result.noteAnchorFallbacks)}`);
      return {pages:result.pages.length,minFill:+minFill.toFixed(3)};
    } finally {
      page.remove();
      for(const id of ['01','02']){if(saved[id]===undefined)delete settings[id];else settings[id]=saved[id];}
    }
  });

  await test('pending main tail plus note carry does not close an almost-empty page',async()=>{
    const settings=getStreamSettings(),saved={};
    for(const id of ['01','02']){saved[id]=settings[id];settings[id]={...(settings[id]||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};}
    const page=makePage();
    try {
      const main1=Array(15).fill(neutral).join(' ');
      const words=[...main1.matchAll(/\S+/gu)],w=words[18];
      const input=[
        {id:'pending-carry-a',mainText:main1,notes:[{stream:'01',uid:'pending-carry-note',num:1,anchor:w.index+w[0].length,anchorAffinity:'backward',text:Array(34).fill(neutral).join(' ')}]},
        {id:'pending-carry-b',mainText:Array(7).fill(neutral).join(' '),notes:[{stream:'02',uid:'pending-carry-note-2',num:2,anchor:30,anchorAffinity:'backward',text:Array(8).fill(neutral).join(' ')}]},
        {id:'pending-carry-c',mainText:Array(5).fill(neutral).join(' '),notes:[]}
      ];
      const result=await buildPages(page,input,{...cfg,pageHeight:280,talmudStreams:['01','02'],maxPages:80});
      assert(result.complete,'pending+carry fixture incomplete');
      assert(result.pages.length>=3,'fixture did not create pending/carry pagination');
      const mainPages=result.pages.map((p,i)=>p.querySelector('[data-v9-paragraph-id="pending-carry-a"]')?i:-1).filter(i=>i>=0);
      const notePages=result.pages.map((p,i)=>p.querySelector('[data-v9-note-key*="pending-carry-note"]')?i:-1).filter(i=>i>=0);
      assert(mainPages.length>1,'main paragraph did not create a pending tail');
      assert(notePages.length>1,'note did not create carry-over');
      const fills=result.pages.slice(0,-1).map((p)=>{
        let bottom=0;
        for(const l of p.querySelectorAll('.v9-line')){
          const y=parseFloat(l.style.top)||0,h=parseFloat(l.style.height)||0;
          bottom=Math.max(bottom,y+h);
        }
        return bottom/(280-12);
      });
      const minFill=Math.min(...fills);
      assert(minFill>=0.50,`pending/carry produced sparse intermediate page: ${fills.map(x=>x.toFixed(3)).join(',')}`);
      assert((result.noteAnchorFallbacks||[]).length===0,`anchor fallback in pending/carry fixture: ${JSON.stringify(result.noteAnchorFallbacks)}`);
      return {pages:result.pages.length,minFill:+minFill.toFixed(3),mainPages,notePages};
    } finally {
      page.remove();
      for(const id of ['01','02']){if(saved[id]===undefined)delete settings[id];else settings[id]=saved[id];}
    }
  });

  await test('no-mid emergency split searches page-sized prefixes for a paragraph larger than one page',async()=>{
    const page=makePage();
    try{
      const text=Array(28).fill(neutral).join(' ');
      const input=[{id:'no-mid-long',mainText:text,notes:[]}];
      const localCfg={...cfg,pageHeight:210,talmudStreams:[],noMidLineSplits:true,maxPages:80};
      const result=await buildPages(page,input,localCfg);
      assert(result.complete,'no-mid long paragraph did not complete');
      assert(result.pages.length>1,'fixture did not require an emergency page split');

      const rows=[...page.querySelectorAll('[data-v9-paragraph-id="no-mid-long"]')];
      assert(rows.length>2,'emergency split produced too little visible text');
      assert(rows.map(sourceText).join('')===prepareV9SourceParagraph(input[0]).mainText,
        'emergency split lost or reordered paragraph source');

      const first=result.pages[0];
      let bottom=0;
      for(const l of first.querySelectorAll('.v9-line')){
        const y=parseFloat(l.style.top)||0,h=parseFloat(l.style.height)||0;
        bottom=Math.max(bottom,y+h);
      }
      const fill=bottom/(localCfg.pageHeight-localCfg.padding);
      assert(fill>=0.55,`emergency split still chose an oversized/failed cut and left a sparse first page: ${fill.toFixed(3)}`);
      return {pages:result.pages.length,firstFill:+fill.toFixed(3)};
    }finally{page.remove();}
  });

  await test('footer note starts on the same page as its main reference under carry pressure',async()=>{
    const settings=getStreamSettings(),saved=settings['03'];
    settings['03']={...(settings['03']||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};
    const host=makePage();
    try{
      const mainA=Array(9).fill(neutral).join(' ');
      const mainB=Array(5).fill(neutral).join(' ');
      const wordsA=[...mainA.matchAll(/\S+/gu)];
      const wordsB=[...mainB.matchAll(/\S+/gu)];
      const aWord=wordsA[5],bWord=wordsB[3];
      const input=[
        {id:'footer-anchor-a',mainText:mainA,notes:[{
          stream:'03',uid:'footer-carry-1',num:1,
          anchor:aWord.index+aWord[0].length,anchorAffinity:'backward',
          text:Array(42).fill(neutral).join(' ')
        }]},
        {id:'footer-anchor-b',mainText:mainB,notes:[{
          stream:'03',uid:'footer-next-2',num:2,
          anchor:bWord.index+bWord[0].length,anchorAffinity:'backward',
          text:Array(8).fill(neutral).join(' ')
        }]},
        {id:'footer-anchor-c',mainText:Array(3).fill(neutral).join(' '),notes:[]}
      ];
      const result=await buildPages(host,input,{...cfg,pageHeight:220,talmudStreams:['01','02'],maxPages:100});
      assert(result.complete,'footer anchor fixture incomplete');
      assert(result.pages.length>1,'footer anchor fixture did not create carry pressure');
      assert((result.noteAnchorFallbacks||[]).length===0,
        `footer anchor fallback: ${JSON.stringify(result.noteAnchorFallbacks||[])}`);
      for(const note of input.flatMap(p=>p.notes||[])){
        const sourceId=note.uid==='footer-carry-1'?'footer-anchor-a':'footer-anchor-b';
        const key=`${sourceId}:03:${note.uid}`;
        const refPage=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-main-ref]')].some(e=>e.dataset.uid===note.uid));
        const startPage=result.pages.findIndex(p=>p.querySelector(`[data-v9-note-start="${key}"]`));
        assert(refPage>=0&&refPage===startPage,
          `footer note/reference page mismatch: ${JSON.stringify({uid:note.uid,refPage,startPage})}`);
      }
    } finally {
      host.remove();
      if(saved===undefined)delete settings['03'];else settings['03']=saved;
    }
  });

  await test('probe: split extension can fill through a legal note continuation',async()=>{
   const settings=getStreamSettings(),saved={};
   for(const id of ['01','02','03']){
     saved[id]=settings[id];
     settings[id]={...(settings[id]||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false,titleShow:false};
   }
   const host=makePage();
   const anchorAt=(text,index)=>{
     const words=[...String(text).matchAll(/\S+/gu)];
     const w=words[Math.min(words.length-1,Math.max(0,index))];
     return w ? w.index+w[0].length : Math.max(0,text.length-1);
   };
   try {
     const input=Array.from({length:7},(_,pi)=>{
       const main=Array(3+(pi%3)).fill('אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר אחד עשר שנים עשר').join(' ');
       return {id:`active-split-fill-${pi}`,mainText:main,notes:[
         {stream:'01',uid:`asf-a-${pi}`,num:pi*3+1,anchor:anchorAt(main,5),anchorAffinity:'backward',
          text:Array(5+(pi%3)).fill(phrase).join(' ')},
         {stream:'02',uid:`asf-b-${pi}`,num:pi*3+2,anchor:anchorAt(main,12),anchorAffinity:'backward',
          text:Array(6+((pi+1)%3)).fill(phrase).join(' ')},
         {stream:'03',uid:`asf-f-${pi}`,num:pi*3+3,anchor:anchorAt(main,19),anchorAffinity:'backward',
          text:Array(3+(pi%2)).fill(neutral).join(' ')}
       ]};
     });
     const result=await buildPages(host,input,{
       ...cfg,pageHeight:360,crownLines:4,crownMainGapPx:11,mainBottomGapPx:24,
       openingWordSettings:{enabled:false},mishnaWrapOn:false,maxPages:120,
       streamSettings:{
         '01':{inlineStyle:{fontSize:11,lineHeight:1.47}},
         '02':{inlineStyle:{fontSize:12,lineHeight:1.63}},
         '03':{inlineStyle:{fontSize:10,lineHeight:1.4},cols:1},
       },
     });
     assert(result.complete,'active-split fill fixture incomplete');
     assert((result.noteAnchorFallbacks||[]).length===0,'active-split extension introduced anchor fallback');
     const fills=result.pages.slice(0,-1).map(p=>Number(p.dataset.v9PageFill)).filter(Number.isFinite);
     const minFill=fills.length?Math.min(...fills):1;
     // Current-main baseline for this exact fixture was 0.541 before legal
     // note-continuation was allowed through split extension. Keep a modest
     // margin below the measured 0.5707 so font/runtime noise cannot erase
     // the recovered fill without turning this into an overfitted pixel test.
     assert(minFill>=0.56,`legal continuation no longer improves sparse active-split page: minFill=${minFill}`);
     for(const p of input){
       const rows=[...host.querySelectorAll(`[data-v9-paragraph-id="${p.id}"]`)];
       assert(rows.map(sourceText).join('')===prepareV9SourceParagraph(p).mainText,`source loss in ${p.id}`);
     }
     return {pages:result.pages.length,minFill:+minFill.toFixed(4),fills:fills.map(x=>+x.toFixed(4))};
   } finally {
     host.remove();
     for(const id of ['01','02','03']){if(saved[id]===undefined)delete settings[id];else settings[id]=saved[id];}
   }
 });

  await test('long anchored note may continue after starting with its source line',async()=>{
    const settings=getStreamSettings(),saved=settings['01'];
    settings['01']={...(settings['01']||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};
    const page=makePage();
    try {
      const main=Array(12).fill(neutral).join(' '),words=[...main.matchAll(/\S+/gu)],anchorWord=words[4];
      const noteText=Array(80).fill(neutral).join(' ');
      const note={stream:'01',uid:'long-anchor-continuation',num:1,
        anchor:anchorWord.index+anchorWord[0].length,anchorAffinity:'backward',text:noteText};
      const result=await buildPages(page,[{id:'long-anchor-source',mainText:main,notes:[note]}],
        {...cfg,pageHeight:240,talmudStreams:['01','02'],maxPages:80});
      assert(result.complete,'long-note pagination incomplete');
      assert(result.pages.length>1,'fixture did not force note continuation');
      assert((result.noteAnchorFallbacks||[]).length===0,
        `anchor fallback used for a legal continuation: ${JSON.stringify(result.noteAnchorFallbacks)}`);
      const refPage=result.pages.findIndex(p=>p.querySelector('[data-uid="long-anchor-continuation"]'));
      const key='long-anchor-source:01:long-anchor-continuation';
      const startPage=result.pages.findIndex(p=>p.querySelector(`[data-v9-note-start="${key}"]`));
      assert(refPage>=0&&refPage===startPage,`note start separated from source: ref=${refPage}, start=${startPage}`);
      const occupied=result.pages.map((p,i)=>p.querySelector(`[data-v9-note-key="${key}"]`)?i:-1).filter(i=>i>=0);
      assert(occupied.length>1,'note did not actually continue across pages');
      for(let i=1;i<occupied.length;i++)assert(occupied[i]===occupied[i-1]+1,'note continuation skipped a page');
    } finally { page.remove();if(saved===undefined)delete settings['01'];else settings['01']=saved; }
  });

  await test('B10: configured Talmud sides keep ownership when the left stream is empty',async()=>{
    const page=makePage();
    const settings=getStreamSettings();
    const saved={};
    for(const id of ['01','02','03']) {
      saved[id]=settings[id];
      settings[id]={...(settings[id]||{}),titleShow:true,mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};
    }
    try {
      const main=Array(7).fill(neutral).join(' ');
      const words=[...main.matchAll(/\S+/gu)];
      const at1=words[8],at3=words[30];
      const input=[{
        id:'b10-fixed-sides',
        mainText:main,
        notes:[
          {stream:'01',uid:'b10-right',num:1,anchor:at1.index+at1[0].length,anchorAffinity:'backward',text:Array(4).fill(phrase).join(' ')},
          {stream:'03',uid:'b10-footer',num:1,anchor:at3.index+at3[0].length,anchorAffinity:'backward',text:Array(4).fill(phrase).join(' ')}
        ]
      }];
      const localCfg={...cfg,pageHeight:537,talmudStreams:['01','02'],
        titles:{...(cfg.titles||{}),'01':'RIGHT','02':'LEFT','03':'FOOTER-03'},
        streamSettings:{
          ...(cfg.streamSettings||{}),
          '01':{inlineStyle:{fontSize:11}},
          '02':{inlineStyle:{fontSize:11}},
          '03':{inlineStyle:{fontSize:11}}
        }};
      const result=await buildPages(page,input,localCfg);
      assert(result.complete,'B10 fixture did not complete');
      assert(!page.querySelector('[data-v9-box-id="02"]'),'empty configured left side unexpectedly rendered content');
      const footerLines=[...page.querySelectorAll('[data-v9-box-id="03"]')];
      assert(footerLines.length,'footer stream 03 was not rendered');
      const innerWidth=localCfg.pageWidth-2*localCfg.padding;
      assert(footerLines.some(el=>(parseFloat(el.style.width)||0)>=innerWidth*.9),
        'stream 03 opportunistically occupied the empty left Talmud side instead of staying a footer');
      const title=[...page.querySelectorAll('.v9-stream-title')].find(el=>el.textContent==='FOOTER-03');
      assert(title,'footer title missing');
      assert((parseFloat(title.style.width)||0)>=innerWidth*.9,
        'footer title width proves stream 03 jumped into a side column');
      return {pages:result.pages.length,footerWidth:parseFloat(title.style.width)||0,innerWidth};
    } finally {
      page.remove();
      for(const id of ['01','02','03']) {
        if(saved[id]===undefined) delete settings[id]; else settings[id]=saved[id];
      }
    }
  });

  // Surgically ported from audit/remaining-sep-layout-regressions-20260930 after
  // confirming current main had no equivalent B12/C8 regression coverage.
  await test('audit B12: a visible main reference is painted at the original marker boundary',async()=>{
    const settings=getStreamSettings(),saved=settings['01'];
    settings['01']={...(settings['01']||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};
    const page=makePage();
    try {
      const raw='alpha@01 beta';
      const mapped=mapMainParagraphSource(raw,[],[{atInPara:5,sym:'@01',code:'01'}]);
      assert(mapped.mainTextNet==='alpha beta','marker mapping changed source text');
      assert(mapped.mainConsumers[0].anchor===5,'reference anchor is not the original marker boundary');
      const note={stream:'01',uid:'audit-ref-position',num:1,
        anchor:mapped.mainConsumers[0].anchor,anchorAffinity:mapped.mainConsumers[0].anchorAffinity,
        text:'note body'};
      const result=await buildPages(page,[{id:'audit-ref-source',mainText:mapped.mainTextNet,notes:[note]}],
        {...cfg,pageHeight:260,talmudStreams:['01','02'],maxPages:10});
      assert(result.complete,'reference-position fixture incomplete');
      const ref=page.querySelector('[data-v9-main-ref][data-uid="audit-ref-position"]');
      assert(ref,'visible main reference missing');
      const body=ref.closest('.v9-planned-line-text');
      assert(body,'reference is not inside the planned main line');
      let before='',after='',seen=false;
      for(const node of body.childNodes){
        if(node===ref){seen=true;continue;}
        if(seen)after+=node.textContent||'';else before+=node.textContent||'';
      }
      assert(before.endsWith('alpha'),`reference moved before its source word: ${JSON.stringify(before)}`);
      assert(after.startsWith(' beta'),`reference moved after following source text: ${JSON.stringify(after)}`);
    } finally {
      page.remove();
      if(saved===undefined) delete settings['01']; else settings['01']=saved;
    }
  });

  await test('audit C8: the first wide commentary row pulls source text forward after a narrow strip',()=>{
    const ctx=createV9TextLayoutContext({...cfg,mainFontSize:11});
    const text=Array(8).fill(phrase).join(' ');
    const pitch=ctx.lineHeight;
    const strips=[
      {x:0,width:76,y_start:0,y_end:pitch*2},
      {x:0,width:230,y_start:pitch*2,y_end:400}
    ];
    const plan=flowV9MeasuredStream({text,runs:[]},strips,ctx,400);
    assert(plan.lines.length>4,'strip-transition fixture too short');
    const firstWide=plan.lines.find(l=>l.y>=pitch*2-.05);
    assert(firstWide,'missing first row after widening');
    assert(!firstWide.isLast,'first wide row accidentally became paragraph end');
    const fill=firstWide.naturalWidth/firstWide.width;
    assert(firstWide.wordTokens.length>=4,
      `first wide row did not pull enough words forward: ${firstWide.wordTokens.map(t=>t.text).join(' ')}`);
    assert(fill>=0.55,`first wide row remained mostly empty: fill=${fill.toFixed(3)}`);
    assert(plan.lines.map(l=>l.sourceText).join('')===text,'strip transition lost or reordered source text');
    ctx.dispose();
    return {fill:+fill.toFixed(3),words:firstWide.wordTokens.length};
  });

  await test('B20 crowded pagination: footer stream never overlaps main rows across pages',async()=>{
    const settings=getStreamSettings(),saved=settings['03'];
    settings['03']={...(settings['03']||{}),mainRefEnabled:true,noteNumEnabled:true,lemmaBold:false};
    const page=makePage();
    try {
      const main=Array(8).fill(neutral).join(' '),words=[...main.matchAll(/\S+/gu)];
      const input=Array.from({length:5},(_,pi)=>({
        id:`b20-crowded-${pi}`,mainText:main,
        notes:Array.from({length:4},(_,ni)=>{
          const w=words[Math.min(words.length-1,7+ni*12)];
          return {stream:'03',uid:`b20-crowded-${pi}-${ni}`,num:pi*4+ni+1,
            anchor:w.index+w[0].length,anchorAffinity:'backward',
            text:Array(7+ni).fill(neutral).join(' ')};
        })
      }));
      const localCfg={...cfg,pageHeight:300,maxPages:100,talmudStreams:['01','02'],
        mishnaWrapOn:false,streamSettings:{'03':{inlineStyle:{fontSize:11}}}};
      const result=await buildPages(page,input,localCfg);
      assert(result.complete,'crowded footer fixture incomplete');
      assert(result.pages.length>1,'crowded footer fixture did not paginate');
      for(const [pageIndex,p] of result.pages.entries()){
        assertNoWordOverlap(p);
        const mains=[...p.querySelectorAll('.v9-line[data-v9-role="main"]')];
        const footers=[...p.querySelectorAll('.v9-line[data-v9-box-id="03"]')];
        for(const m of mains)for(const ft of footers){
          const mx=parseFloat(m.style.left)||0,mw=parseFloat(m.style.width)||0,my=parseFloat(m.style.top)||0,mh=parseFloat(m.style.height)||0;
          const fx=parseFloat(ft.style.left)||0,fw=parseFloat(ft.style.width)||0,fy=parseFloat(ft.style.top)||0,fh=parseFloat(ft.style.height)||0;
          const dx=Math.min(mx+mw,fx+fw)-Math.max(mx,fx);
          const dy=Math.min(my+mh,fy+fh)-Math.max(my,fy);
          assert(!(dx>.5&&dy>.5),`main/footer geometry overlap on page ${pageIndex}: dx=${dx}, dy=${dy}`);
        }
      }
    } finally {
      page.remove();
      if(saved===undefined)delete settings['03'];else settings['03']=saved;
    }
  });

  await test('B20/C7: footer streams never cover the last main-text row',()=>{
    const page=makePage();
    const main=Array(8).fill(neutral).join(' ');
    const footer=Array(5).fill(phrase).join(' ');
    const plan=buildSinglePage(page,{
      mainText:main,
      rightStream:null,
      leftStream:null,
      footerStreams:[{id:'03',items:[footer],runs:[],rich:{text:footer,runs:[]}}]
    },{
      ...cfg,pageHeight:537,talmudStreams:[],
      titles:{'03':'Footer'},
      streamSettings:{'03':{inlineStyle:{fontSize:11}}}
    });
    assert(plan.mainBox?.lines?.length,'fixture produced no main rows');
    const box=plan.footerBoxes.find(b=>b.id==='03');
    assert(box?.lines?.length,'fixture produced no footer rows');
    const mainBottom=Math.max(...plan.mainBox.lines.map(l=>l.y+l.lineHeightPx));
    const footerTop=Math.min(
      Number.isFinite(box.titleY)?box.titleY:Number.POSITIVE_INFINITY,
      ...box.lines.map(l=>l.y)
    );
    assert(mainBottom<=footerTop+.1,
      `main/footer vertical overlap: mainBottom=${mainBottom}, footerTop=${footerTop}`);
    assertNoWordOverlap(page);
    page.remove();
    return {mainBottom,footerTop};
  });

  await test('B5 selected one-line rule suppresses an opening before V9 paints it',async()=>{
    const host=makePage();
    try {
      const settings={
        enabled:true,target:'word',count:1,font:'serif',size:180,weight:'bold',
        position:'dropped',dropLines:2,spaceAfter:0.3,scope:'all',
        skipHeadings:true,headingMin:80,
        skipSingleLine:true,skipShortLine:false,skipFewerThanLines:false,minLines:3,shortLineMinFill:0.65
      };
      const result=await buildPages(host,[{id:'b5-one-row',mainText:'alpha beta gamma',notes:[]}],
        {...cfg,pageHeight:300,talmudStreams:[],openingWordSettings:settings});
      assert(result.complete,'B5 one-row fixture incomplete');
      assert(host.querySelectorAll('.v9-opening-glyph').length===0,'opening was painted despite selected one-line skip rule');
    } finally {host.remove();}
  });

  await test('B5 rules are opt-in and do not remove the same opening by default',async()=>{
    const host=makePage();
    try {
      const settings={
        enabled:true,target:'word',count:1,font:'serif',size:180,weight:'bold',
        position:'dropped',dropLines:2,spaceAfter:0.3,scope:'all',
        skipHeadings:true,headingMin:80,
        skipSingleLine:false,skipShortLine:false,skipFewerThanLines:false,minLines:3,shortLineMinFill:0.65
      };
      const result=await buildPages(host,[{id:'b5-default',mainText:'alpha beta gamma',notes:[]}],
        {...cfg,pageHeight:300,talmudStreams:[],openingWordSettings:settings});
      assert(result.complete,'B5 default fixture incomplete');
      assert(host.querySelectorAll('.v9-opening-glyph').length===1,'opt-in B5 policy changed an existing opening by default');
    } finally {host.remove();}
  });

  await test('font preflight includes note runs, nested notes and resolved label styles',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(document,'fonts'),requests=[];
    Object.defineProperty(document,'fonts',{configurable:true,value:{load:font=>{requests.push(font);return Promise.resolve([]);},ready:Promise.resolve()}});
    try {
      await waitForV9LayoutFonts([{notes:[{runs:[{marks:{fontFamily:'"Note Only"'}}],children:[{runs:[{marks:{fontFamily:'"Nested Only"'}}]}]}]}],
        {mainFontFamily:'serif',__v9ResolvedFontStyles:[{fontFamily:'"Number Only"'},{fontFamily:'"Bold Only"'}]});
      for(const family of ['Note Only','Nested Only','Number Only','Bold Only'])
        assert(requests.some(q=>q.includes(family)),`font missing from preflight: ${family}`);
    } finally {if(descriptor)Object.defineProperty(document,'fonts',descriptor);else delete document.fonts;}
  });

}
