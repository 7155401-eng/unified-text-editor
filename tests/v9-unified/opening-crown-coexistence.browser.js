import {createV9TextLayoutContext,renderV9PlannedMainLine} from '../../src/engine/v9_text_measurement.js';
import {layoutV9MainParagraphs,rowGeometry} from '../../src/engine/v9_main_inline_layout.js';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const sourceOf=element=>{
  const copy=element.cloneNode(true);copy.querySelectorAll('[data-v9-main-ref]').forEach(e=>e.remove());return copy.textContent;
};

// Guards a reported regression from an unmerged centering experiment. These
// assertions preserve earlier full-width rows; they do NOT approve body-only
// final-row centering as the completed user requirement.
export function runOpeningCrownCoexistenceChecks(){
  const results=[];
  for(const family of ['serif','sans-serif','monospace'])for(const dropLines of [2,3,4])
  for(const x of [0,19])for(const width of [180,240]){
    const name=`${family}/drop=${dropLines}/x=${x}/width=${width}`;
    const context=createV9TextLayoutContext({mainFontFamily:family,mainFontSize:16,lineHeightRatio:1.5,
      openingWordSettings:{enabled:true,target:'word',count:1,font:'inherit',size:175,weight:'bold',
        position:'dropped',dropLines,spaceAfter:.2,scope:'all',skipHeadings:false,
        skipSingleLine:false,skipShortLine:false,skipFewerThanLines:false}});
    const page=document.createElement('div');
    page.style.cssText='position:relative;margin:0;padding:0;border:0;';document.body.append(page);
    try{
      const lead=context.prepareEntry({id:'lead',text:Array(30).fill('אב').join(' '),runs:[],mainRefs:[],_v9OpeningWordAllowed:false});
      const strips=[{x:x+width/2,width:width/2,y_start:0,y_end:36},{x,width,y_start:36,y_end:1000}];
      let fixture=null;
      for(let words=4;words<=40;words++){
        const entry=context.prepareEntry({id:'opening',text:'פתיח '+Array(words).fill('אב').join(' '),runs:[],mainRefs:[]});
        const before=JSON.stringify([lead,entry,strips]);
        const plan=layoutV9MainParagraphs([lead,entry],strips,context,1000);
        assert(JSON.stringify([lead,entry,strips])===before,'source or geometry input mutated');
        const rows=plan.lines.filter(l=>l.source.paragraphId==='opening');
        if(rows.length===2 && rows[0].render.opening && rows[1].openingWindow && rows[0].wordTokens.length>1){fixture={entry,plan,rows};break;}
      }
      assert(fixture,'no two-row completed opening fixture');
      const {entry,plan,rows}=fixture,beforePaint=JSON.stringify(plan);
      page.style.width=`${x+width+20}px`;page.style.height='1000px';
      for(const line of plan.lines)renderV9PlannedMainLine(line,page,0);
      assert(JSON.stringify(plan)===beforePaint,'painter rewrote the plan');
      assert(sourceOf(page)===lead.text+entry.text,'rendered source lost or duplicated');
      assert(!plan.overflowText,'unexpected page overflow');
      assert(page.querySelectorAll('.v9-opening-glyph').length===1,'opening lost or duplicated');
      const first=rows[0],opening=first.render.opening;
      const full=rowGeometry(strips,first.y,first.lineHeightPx,1000);
      assert(full && full.width===width && first.y>=36,'opening not after the widening');
      assert(!first.isLast,'first opening row must not be a paragraph ending');
      assert(Math.abs(first.x-full.x)<.02,'non-final row was moved from its allocated left edge');
      const combinedWidth=first.width+opening.width+opening.gap;
      assert(Math.abs(combinedWidth-width)<.02,`centering narrowed a full row: ${combinedWidth} instead of ${width}`);
      const el=page.querySelectorAll('.v9-final-main-line')[plan.lines.indexOf(first)];
      const body=el.querySelector('.v9-planned-line-text'),glyph=el.querySelector('.v9-opening-glyph');
      const range=document.createRange();range.selectNodeContents(body);
      const bodyRect=range.getBoundingClientRect(),glyphRect=glyph.getBoundingClientRect(),pageRect=page.getBoundingClientRect();
      assert(Math.abs(bodyRect.left-pageRect.left-full.x)<.8,'actual text does not start at the allocated edge');
      assert(Math.abs(glyphRect.right-pageRect.left-(full.x+full.width))<.8,'painted opening shortened the row envelope');
      assert(bodyRect.right<=glyphRect.left-opening.gap+.8,'text overlaps opening');
      assert(Math.abs(bodyRect.width-first.width)<.8,'actual non-final row no longer fills its body allocation');
      results.push({name,pass:true,firstY:first.y,allocatedWidth:width,combinedWidth,bodyInkWidth:bodyRect.width});
    }catch(error){results.push({name,pass:false,error:String(error)});}
    finally{context.dispose();page.remove();}
  }
  return {total:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,
    jointCenteringAccepted:false,results};
}
