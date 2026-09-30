import { saveTextStyles, loadTextStyles } from '../../src/style_registry.js';
import { buildPages,buildSinglePage } from '../../src/vilna_v9.js';
import { createV9TextLayoutContext, waitForV9LayoutFonts } from '../../src/engine/v9_text_measurement.js';
import { flowV9MeasuredStream,renderV9MeasuredStreamLine } from '../../src/engine/v9_stream_inline_layout.js';
import { getStreamSettings } from '../../src/original_stream_columns.js';
import { prepareV9SourceParagraph } from '../../src/engine/v9_source_fragments.js';
import { mapMainParagraphSource } from '../../src/engine/main_source_mapping.js';

const phrase='alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const neutral='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר';
const cfg={pageWidth:380,pageHeight:350,padding:12,mainFontSize:13,sideFontSize:11,lineHeightRatio:1.55,mainFontFamily:'serif',sideFontFamily:'serif',talmudStreams:['01','02'],maxPages:80,openingWordSettings:{enabled:false}};

export async function runSpacingRegressions(test,{assert,makePage,sourceText}) {
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
 await test('page furniture is attached during V9 page creation, not only after engine-rendered',async()=>{
   const savedNum=localStorage.getItem('ravtext.pageNumbers');
   const savedHeader=localStorage.getItem('ravtext.pageHeader');
   const savedFooter=localStorage.getItem('ravtext.pageFooter');
   localStorage.setItem('ravtext.pageNumbers','1');
   localStorage.setItem('ravtext.pageHeader','HEADER');
   localStorage.setItem('ravtext.pageFooter','FOOTER');
   const host=makePage();
   try {
     const result=await buildPages(host,[{id:'feature-render',mainText:neutral,notes:[]}],{...cfg,pageHeight:260,talmudStreams:[]});
     assert(result.complete,'feature render fixture incomplete');
     const rendered=host.querySelector(':scope > .v9-page');
     assert(rendered,'missing rendered V9 page');
     assert(rendered.dataset.ravtextFeaturesAppliedAtRender==='1','features were not attached at render time');
     assert(rendered.querySelector(':scope > .ravtext-page-number-overlay')?.textContent==='א','page number missing/wrong at render time');
     assert(rendered.querySelector(':scope > .ravtext-page-header')?.textContent==='HEADER','header missing at render time');
     assert(rendered.querySelector(':scope > .ravtext-page-footer')?.textContent==='FOOTER','footer missing at render time');
   } finally {
     host.remove();
     if(savedNum===null)localStorage.removeItem('ravtext.pageNumbers');else localStorage.setItem('ravtext.pageNumbers',savedNum);
     if(savedHeader===null)localStorage.removeItem('ravtext.pageHeader');else localStorage.setItem('ravtext.pageHeader',savedHeader);
     if(savedFooter===null)localStorage.removeItem('ravtext.pageFooter');else localStorage.setItem('ravtext.pageFooter',savedFooter);
   }
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
    } finally {page.remove();if(previous)settings['01']=previous;else delete settings['01'];}
  });
  await test('apostrophe + visible reference + following word stays on one V9 line without source whitespace',async()=>{
    const settings=getStreamSettings(),previous=settings['01'];
    settings['01']={...(settings['01']||{}),mainRefEnabled:true,noteNumEnabled:false,lemmaBold:false};
    const page=makePage();
    try {
      const source="alpha beta gamma ר'משה delta epsilon zeta eta theta";
      const anchor=source.indexOf('משה');
      const note={stream:'01',num:1,uid:'apostrophe-no-space',anchor,anchorAffinity:'backward',text:'short note'};
      const result=await buildPages(page,[{id:'apostrophe-source',mainText:source,notes:[note]}],
        {...cfg,pageWidth:220,pageHeight:280,mainWidthRatio:.42});
      assert(result.complete,'apostrophe reference fixture incomplete');
      const rows=[...page.querySelectorAll('[data-v9-layout-final]')]
        .filter(el=>el.dataset.v9ParagraphId==='apostrophe-source');
      const touching=rows.map(el=>({el,text:sourceText(el)}))
        .filter(x=>x.text.includes("ר'")||x.text.includes('משה'));
      assert(touching.length===1,
        `no-space source token split across V9 lines: ${touching.map(x=>JSON.stringify(x.text)).join(' | ')}`);
      assert(touching[0].text.includes("ר'משה"),
        `apostrophe/reference word was split: ${JSON.stringify(touching[0].text)}`);
      const ref=page.querySelector('[data-v9-main-ref][data-uid="apostrophe-no-space"]');
      assert(ref,'visible apostrophe reference missing');
      assert(ref.closest('[data-v9-layout-final]')===touching[0].el,
        'reference moved away from its no-space source token');
    } finally {
      page.remove();
      if(previous===undefined) delete settings['01']; else settings['01']=previous;
    }
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

  await test('per-stream Mishnah pair remains active after two fixed GPT streams',()=>{
    const page=makePage();
    const short='alpha beta gamma delta';
    const long=Array(14).fill(phrase).join(' ');
    const gpt='alpha beta gamma delta epsilon';
    const plan=buildSinglePage(page,{
      mainText:'main text',
      rightStream:{id:'01',items:[gpt],runs:[],rich:{text:gpt,runs:[]}},
      leftStream:{id:'02',items:[gpt],runs:[],rich:{text:gpt,runs:[]}},
      footerStreams:[
        {id:'03',items:[short],runs:[],rich:{text:short,runs:[]}},
        {id:'04',items:[long],runs:[],rich:{text:long,runs:[]}}
      ]
    },{
      ...cfg,pageHeight:720,talmudStreams:['01','02'],mishnaWrapOn:false,levels:[],
      streamSettings:{
        '01':{layoutRole:'gemara',inlineStyle:{fontSize:11}},
        '02':{layoutRole:'gemara',inlineStyle:{fontSize:11}},
        '03':{layoutRole:'mishna',mishnaSide:'right',inlineStyle:{fontSize:11}},
        '04':{layoutRole:'mishna',inlineStyle:{fontSize:11}}
      }
    });
    const b3=plan.footerBoxes.find(b=>b.id==='03'),b4=plan.footerBoxes.find(b=>b.id==='04');
    assert(b3&&b4,'mixed GPT+Mishnah footer boxes missing');
    assert(b3.mishnaRole==='float'&&b4.mishnaRole==='flow',
      `per-stream Mishnah role ignored after GPT: ${b3.mishnaRole}/${b4.mishnaRole}`);
    assert(Math.abs(b3.titleY-b4.titleY)<.1,'per-stream Mishnah pair no longer shares one geometric level');
    assert(b3.titleWidth<plan.pageBox.innerWidth*.75,'per-stream Mishnah stream fell back to full-width footer');
    assert(plan.streamBoxes.some(b=>b.id==='01')&&plan.streamBoxes.some(b=>b.id==='02'),
      'fixed GPT streams disappeared while activating Mishnah pair');
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
