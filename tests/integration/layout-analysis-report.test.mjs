import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  analyzePageElement,
  analyzePagesContainer,
  wireLayoutAnalysisReport,
} from "../../src/layout_analysis_report.js";

function rect(left, top, width, height) {
  return {
    x:left,y:top,left,top,width,height,
    right:left+width,bottom:top+height,
    toJSON(){ return this; },
  };
}

function installDom() {
  const dom = new JSDOM("<!doctype html><body><div id=\"pages\"></div><div id=\"render-safety-diagnostics-group\"></div></body>", {
    pretendToBeVisual:true,
  });
  const previous = {
    window:globalThis.window,
    document:globalThis.document,
    getComputedStyle:globalThis.getComputedStyle,
    Node:globalThis.Node,
    NodeFilter:globalThis.NodeFilter,
    alert:globalThis.alert,
  };
  globalThis.window=dom.window;
  globalThis.document=dom.window.document;
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.Node=dom.window.Node;
  globalThis.NodeFilter=dom.window.NodeFilter;
  globalThis.alert=()=>{};

  const nativeCreateRange=dom.window.document.createRange.bind(dom.window.document);
  dom.window.document.createRange=()=>{
    let selected=null;
    return {
      selectNodeContents(el){ selected=el; },
      getBoundingClientRect(){
        return selected?._inkRect || selected?.getBoundingClientRect?.() || rect(0,0,0,0);
      },
      detach(){},
      setStart(){},
      setEnd(){},
    };
  };

  return {
    dom,
    restore(){
      dom.window.document.createRange=nativeCreateRange;
      for(const [k,v] of Object.entries(previous)){
        if(v===undefined) delete globalThis[k];
        else globalThis[k]=v;
      }
      dom.window.close();
    },
  };
}

function makePage(document,{width=380,height=140,padding=10}={}) {
  const page=document.createElement("div");
  page.className="page";
  page.style.padding=`${padding}px`;
  page.getBoundingClientRect=()=>rect(0,0,width,height);
  Object.defineProperty(page,"clientHeight",{configurable:true,get:()=>height});
  Object.defineProperty(page,"scrollHeight",{configurable:true,get:()=>height});
  document.getElementById("pages").appendChild(page);
  return page;
}

function addLine(page,{
  x=20,y=20,width=200,height=20,
  inkLeft=x,inkTop=y,inkWidth=width*.9,inkHeight=height*.8,
  role="main",boxId="main",text="אבג",last=false,column="",
}={}) {
  const el=page.ownerDocument.createElement("div");
  el.className=`v9-line v9-role-${role}`;
  el.dataset.v9Role=role;
  el.dataset.v9BoxId=boxId;
  if(column)el.dataset.v9MainColumn=column;
  if(last)el.dataset.v9ParaLast="1";
  el.textContent=text;
  el.style.position="absolute";
  el.style.left=x+"px";
  el.style.top=y+"px";
  el.style.width=width+"px";
  el.style.height=height+"px";
  el.getBoundingClientRect=()=>rect(x,y,width,height);
  el._inkRect=rect(inkLeft,inkTop,inkWidth,inkHeight);
  page.appendChild(el);
  return el;
}

test("balanced knee keeps one row pitch and produces no knee error",()=>{
  const env=installDom();
  try{
    const page=makePage(document,{height:130,padding:10});
    addLine(page,{y:10,width:100,inkWidth:85,role:"right",boxId:"01"});
    addLine(page,{y:30,width:100,inkWidth:88,role:"right",boxId:"01"});
    addLine(page,{y:50,width:200,inkWidth:175,role:"right",boxId:"01"});
    addLine(page,{y:70,width:200,inkWidth:160,role:"right",boxId:"01"});
    addLine(page,{y:90,width:200,inkWidth:150,role:"right",boxId:"01",last:true});
    const r=analyzePageElement(page,0,{bottomGapWarningLines:2});
    assert.equal(r.knees.length,1);
    assert.equal(r.knees[0].ok,true);
    assert.equal(r.issues.some(i=>i.code==="knee-row-gap"),false);
  }finally{env.restore();}
});

test("layout report exposes only commentary streams actually present on the page",()=>{
  const env=installDom();
  try{
    const page=makePage(document,{height:150,padding:10});
    addLine(page,{x:20,y:10,width:160,role:"main",boxId:"main"});
    addLine(page,{x:210,y:10,width:90,role:"right",boxId:"01"});
    addLine(page,{x:210,y:30,width:90,role:"right",boxId:"01"});
    addLine(page,{x:20,y:90,width:280,role:"stream",boxId:"03"});
    const r=analyzePageElement(page,0,{bottomGapWarningLines:10});
    assert.deepEqual(r.commentaryStreams.map(x=>x.id),["01","03"]);
    const s01=r.commentaryStreams.find(x=>x.id==="01");
    const s03=r.commentaryStreams.find(x=>x.id==="03");
    assert.equal(s01.lines,2);
    assert.equal(s03.lines,1);
    assert(!r.commentaryStreams.some(x=>x.id==="main"));
  }finally{env.restore();}
});

test("off-grid knee with a manufactured blank slot is an error",()=>{
  const env=installDom();
  try{
    const page=makePage(document,{height:170,padding:10});
    addLine(page,{y:10,width:100,role:"right",boxId:"01"});
    addLine(page,{y:30,width:100,role:"right",boxId:"01"});
    addLine(page,{y:50,width:100,role:"right",boxId:"01"});
    addLine(page,{y:90,width:200,role:"right",boxId:"01"});
    addLine(page,{y:110,width:200,role:"right",boxId:"01"});
    const r=analyzePageElement(page,0,{bottomGapWarningLines:10});
    const knee=r.knees.find(k=>k.wideWidth>k.narrowWidth);
    assert(knee,"missing knee");
    assert.equal(knee.ok,false);
    assert.equal(r.issues.some(i=>i.code==="knee-row-gap"&&i.severity==="error"),true);
  }finally{env.restore();}
});

test("overlapping visible ink is reported but side-by-side rows are not",()=>{
  const env=installDom();
  try{
    const page=makePage(document,{height:120,padding:10});
    addLine(page,{x:20,y:10,width:150,height:20,inkLeft:20,inkTop:10,inkWidth:145,inkHeight:18,role:"main"});
    addLine(page,{x:20,y:24,width:150,height:20,inkLeft:20,inkTop:24,inkWidth:145,inkHeight:18,role:"main"});
    addLine(page,{x:200,y:24,width:100,height:20,inkLeft:200,inkTop:24,inkWidth:90,inkHeight:18,role:"left",boxId:"02"});
    const r=analyzePageElement(page,0,{bottomGapWarningLines:10});
    assert.equal(r.overlaps.length,1);
    assert.equal(r.issues.some(i=>i.code==="line-overlap"),true);
  }finally{env.restore();}
});

test("bottom whitespace is normalized to the measured row pitch",()=>{
  const env=installDom();
  try{
    const page=makePage(document,{height:180,padding:10});
    for(const y of [10,30,50,70])addLine(page,{y,width:200,inkTop:y,inkHeight:18});
    const r=analyzePageElement(page,0,{bottomGapWarningLines:1.5});
    assert(r.bottomGapLines>3,`bottomGapLines=${r.bottomGapLines}`);
    assert.equal(r.issues.some(i=>i.code==="bottom-gap"),true);
  }finally{env.restore();}
});


test("page metrics are invariant to preview zoom",()=>{
  const env=installDom();
  try{
    const normal=makePage(document,{width:380,height:140,padding:10});
    Object.defineProperty(normal,"offsetWidth",{configurable:true,get:()=>380});
    Object.defineProperty(normal,"clientWidth",{configurable:true,get:()=>380});
    for(const y of [10,30,50,70,90])addLine(normal,{x:20,y,width:200,height:20,inkLeft:20,inkTop:y,inkWidth:180,inkHeight:16});
    const a=analyzePageElement(normal,0,{bottomGapWarningLines:10});

    const zoomed=makePage(document,{width:760,height:280,padding:10});
    Object.defineProperty(zoomed,"offsetWidth",{configurable:true,get:()=>380});
    Object.defineProperty(zoomed,"clientWidth",{configurable:true,get:()=>380});
    Object.defineProperty(zoomed,"clientHeight",{configurable:true,get:()=>140});
    Object.defineProperty(zoomed,"scrollHeight",{configurable:true,get:()=>140});
    for(const y of [20,60,100,140,180])addLine(zoomed,{x:40,y,width:400,height:40,inkLeft:40,inkTop:y,inkWidth:360,inkHeight:32});
    const b=analyzePageElement(zoomed,1,{bottomGapWarningLines:10});

    assert.equal(b.visualScale,2);
    assert(Math.abs(a.bottomGapLines-b.bottomGapLines)<0.05,
      `zoom changed bottom gap: ${a.bottomGapLines} -> ${b.bottomGapLines}`);
    assert(Math.abs(a.fillRatio-b.fillRatio)<0.01,
      `zoom changed fill ratio: ${a.fillRatio} -> ${b.fillRatio}`);
  }finally{env.restore();}
});

test("opening centering audit uses explicit V9 host metadata, not parent-box guesses",()=>{
  const env=installDom();
  try{
    const page=makePage(document,{height:120,padding:0});
    const line=addLine(page,{x:34,y:10,width:10,height:20,inkLeft:34,inkTop:10,inkWidth:10,inkHeight:16,last:true});
    line.dataset.v9OpeningCompositeCentered="1";
    line.dataset.v9OpeningExpectedCenterPx="50";
    line.dataset.v9OpeningHostFullWidthPx="100";
    line.dataset.v9OpeningCompositeWidthPx="32";

    const body=document.createElement("span");
    body.className="v9-planned-line-text";
    body.getBoundingClientRect=()=>rect(34,10,10,20);
    body._inkRect=rect(34,10,10,16);
    line.appendChild(body);

    const opening=document.createElement("span");
    opening.className="v9-opening-glyph";
    opening.getBoundingClientRect=()=>rect(46,10,20,20);
    line.appendChild(opening);

    line._inkRect=rect(34,10,32,20);
    let r=analyzePageElement(page,0,{bottomGapWarningLines:10});
    assert.equal(r.openingCentering.length,0);

    opening.getBoundingClientRect=()=>rect(54,10,20,20);
    line._inkRect=rect(34,10,40,20);
    r=analyzePageElement(page,0,{bottomGapWarningLines:10});
    assert.equal(r.openingCentering.length,1);
    assert.equal(r.issues.some(i=>i.code==="opening-center"),true);
  }finally{env.restore();}
});


test("same commentary stream split across right and left boxes gets two-column metrics",()=>{
  const env=installDom();
  try{
    const page=makePage(document,{height:150,padding:10});
    for(const y of [10,30,50,70]){
      addLine(page,{x:200,y,width:80,inkLeft:200,inkTop:y,inkWidth:70,role:"right",boxId:"01"});
      addLine(page,{x:100,y,width:80,inkLeft:100,inkTop:y,inkWidth:70,role:"left",boxId:"01"});
    }
    const r=analyzePageElement(page,0,{bottomGapWarningLines:10});
    const split=r.columns.find(c=>c.key==="split-stream:01");
    assert(split,"shared stream id was not recognized as a two-column commentary");
    assert.equal(split.topAligned,true);
    assert.equal(split.bottomAligned,true);
    assert.equal(split.densityBalanced,true);
  }finally{env.restore();}
});

test("container summary aggregates errors and the diagnostics button wires idempotently",()=>{
  const env=installDom();
  try{
    const pages=document.getElementById("pages");
    const ok=makePage(document,{height:90,padding:10});
    addLine(ok,{y:10,width:200,inkWidth:180});
    addLine(ok,{y:30,width:200,inkWidth:180});
    addLine(ok,{y:50,width:200,inkWidth:180,last:true});

    const bad=makePage(document,{height:140,padding:10});
    addLine(bad,{y:10,width:100,role:"right",boxId:"01"});
    addLine(bad,{y:30,width:100,role:"right",boxId:"01"});
    addLine(bad,{y:70,width:200,role:"right",boxId:"01"});

    const report=analyzePagesContainer(pages,{bottomGapWarningLines:10});
    assert.equal(report.pages,2);
    assert(report.errors>=1);
    assert.equal(report.issueCounts["knee-row-gap"],1);

    wireLayoutAnalysisReport(pages);
    wireLayoutAnalysisReport(pages);
    assert.equal(document.querySelectorAll("#layout-analysis-report-btn").length,1);
    assert.equal(document.querySelector("#layout-analysis-report-btn").textContent,"דוח עימוד");
  }finally{env.restore();}
});
