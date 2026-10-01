import { createServer } from 'vite';
import { chromium } from 'playwright-chromium';

const server=await createServer({
  logLevel:'error',
  server:{host:'127.0.0.1',port:0,strictPort:false},
});
await server.listen();

const urls=server.resolvedUrls?.local || server.resolvedUrls?.network || [];
const base=urls[0];
if(!base) throw new Error('Vite did not expose a local URL');

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:700}});

const samples=[
  "אבג '(דהו זח טי כל מנ) סוף",
  "אבג ’(דהו זח טי כל מנ) סוף",
  "אבג ׳(דהו זח טי כל מנ) סוף",
  "אבג \u200e'(דהו זח טי כל מנ) סוף",
  "אבג '\u200e(דהו זח טי כל מנ) סוף",
  "אבג \u200f'(דהו זח טי כל מנ) סוף",
  "אבג '\u200f(דהו זח טי כל מנ) סוף",
  "אבג \u061c'(דהו זח טי כל מנ) סוף",
  "אבג '\u061c(דהו זח טי כל מנ) סוף",
  "אבג \u2060'(דהו זח טי כל מנ) סוף",
  "אבג '\u2060(דהו זח טי כל מנ) סוף",
];

try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async(samples)=>{
    const [{default:JSZip},{docx_extract_simple},{renderPages}]=await Promise.all([
      import('/node_modules/jszip/dist/jszip.min.js'),
      import('/src/word_extractor/word_extractor_engine.js'),
      import('/src/engine/renderer.js'),
    ]);

    const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const xmlEscape=s=>String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const makeDocx=async(text)=>{
      const zip=new JSZip();
      zip.file('word/document.xml',
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
      return zip.generateAsync({type:'arraybuffer'});
    };

    const charOrder=(el)=>{
      const root=el.getBoundingClientRect();
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      const chars=[];let node,logical=0;
      while((node=walker.nextNode())){
        const value=node.nodeValue||'';
        for(let i=0;i<value.length;i++,logical++){
          const ch=value[i];
          // Zero-width controls still affect BiDi but cannot be ordered by ink.
          if(['\u200e','\u200f','\u061c','\u2060'].includes(ch))continue;
          const range=document.createRange();
          range.setStart(node,i);range.setEnd(node,i+1);
          const r=range.getBoundingClientRect();
          if(r.width>.01||r.height>.01)chars.push({
            logical,ch,center:(r.left+r.right)/2-root.left
          });
        }
      }
      return chars.sort((a,b)=>a.center-b.center||a.logical-b.logical).map(x=>x.ch);
    };

    const failures=[];
    const oldSync=window.__FORCE_SYNC_RENDER__;
    window.__FORCE_SYNC_RENDER__=true;
    document.body.replaceChildren();

    try{
      for(const source of samples){
        const bytes=await makeDocx(source);
        const extracted=await docx_extract_simple(bytes,[]);
        if(extracted.main!==source){
          failures.push({source,stage:'extract',extracted:extracted.main});
          continue;
        }

        const host=document.createElement('div');
        host.style.cssText='position:relative;width:420px;';
        document.body.appendChild(host);
        renderPages([{
          main:[[0,extracted.main,0,extracted.main.length,{
            mainRuns:[],mainRefs:[],fullMainText:extracted.main
          }]],
          streams:{}
        }],host);

        const rendered=host.querySelector('.page-main > *');
        if(!rendered){
          failures.push({source,stage:'render',error:'regular renderer fixture missing'});
          host.remove();
          continue;
        }

        const native=document.createElement('div');
        native.dir='rtl';
        const cs=getComputedStyle(rendered);
        native.style.cssText='position:absolute;left:500px;top:600px;white-space:pre;';
        native.style.width=cs.width;
        native.style.font=cs.font;
        native.style.letterSpacing=cs.letterSpacing;
        native.style.wordSpacing=cs.wordSpacing;
        native.style.lineHeight=cs.lineHeight;
        native.textContent=source;
        document.body.appendChild(native);

        const renderedOrder=charOrder(rendered);
        const nativeOrder=charOrder(native);
        if(
          rendered.textContent!==source ||
          JSON.stringify(renderedOrder)!==JSON.stringify(nativeOrder)
        ){
          failures.push({
            source,
            stage:'visual',
            renderedText:rendered.textContent,
            renderedOrder,
            nativeOrder,
            html:rendered.outerHTML,
          });
        }

        native.remove();host.remove();
      }
    }finally{
      if(oldSync===undefined)delete window.__FORCE_SYNC_RENDER__;
      else window.__FORCE_SYNC_RENDER__=oldSync;
    }

    return {ok:failures.length===0,failures};
  },samples);

  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=1;
}finally{
  await browser.close();
  await server.close();
}
