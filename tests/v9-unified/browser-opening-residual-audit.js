import { createV9TextLayoutContext, renderV9PlannedMainLine } from '../../src/engine/v9_text_measurement.js';
import { layoutV9MainParagraphs } from '../../src/engine/v9_main_inline_layout.js';

function clean(s){return String(s||'').replace(/[\u061c\u200e\u200f\u2060]/gu,'');}

export async function runOpeningResidualAudit(){
  const families=['serif','sans-serif','monospace'];
  const sizes=[80,200,500];
  const spaces=[0,0.3,4];
  const dropLinesList=[1,2,4,8];
  const failures=[];
  const results=[];
  let cases=0;

  for(const family of families)
  for(const size of sizes)
  for(const spaceAfter of spaces)
  for(const dropLines of dropLinesList){
    cases++;
    const context=createV9TextLayoutContext({
      mainFontSize:13,
      mainFontFamily:family,
      lineHeightRatio:1.55,
      openingWordSettings:{
        enabled:true,target:'word',count:1,font:family,size,weight:'bold',
        position:'dropped',dropLines,spaceAfter,scope:'all',
        skipHeadings:false,skipSingleLine:false,skipShortLine:false,
        skipFewerThanLines:false,minLines:1,
      },
    });
    const host=document.createElement('div');
    host.style.cssText='position:relative;width:160px;height:420px;padding:0;margin:0;';
    document.body.appendChild(host);
    try{
      const source="פתיח אב'(גד) "+Array(28).fill('אב').join(' ');
      const entry=context.prepareEntry({
        id:`opening-residual-${family}-${size}-${spaceAfter}-${dropLines}`,
        index:1,text:source,runs:[],mainRefs:[],continues:false,
      });
      const plan=layoutV9MainParagraphs([entry],[{x:10,width:140,y_start:0,y_end:400}],context,400);
      for(const line of plan.lines) renderV9PlannedMainLine(line,host,0);

      const opening=host.querySelector('.v9-opening-glyph');
      const rows=[...host.querySelectorAll('.v9-final-main-line')];
      const sourceFromPlan=plan.lines.map(l=>l.sourceText||'').join('');
      const diag=(plan.diagnostics||[]).map(d=>d.code);
      const key={family,size,spaceAfter,dropLines};
      const issues=[];

      if(plan.overflowParagraphs?.length)issues.push('unexpected-overflow');
      if(sourceFromPlan!==source)issues.push('source-mismatch');
      if(!opening)issues.push('opening-missing');
      if(host.querySelectorAll('.v9-opening-glyph').length!==1)issues.push('opening-count');
      if(rows.length!==plan.lines.length)issues.push('painted-row-count');

      const sorted=[...plan.lines].sort((a,b)=>a.y-b.y);
      for(let i=0;i<sorted.length;i++){
        const line=sorted[i];
        if(line.x<10-0.05||line.x+line.width>150.05)issues.push(`row-outside-host-${i}`);
        if(i>0){
          const prev=sorted[i-1];
          const dy=line.y-prev.y;
          if(Math.abs(dy-prev.lineHeightPx)>.25)issues.push(`row-grid-${i}`);
        }
      }

      if(opening){
        const or=opening.getBoundingClientRect();
        const hr=host.getBoundingClientRect();
        if(or.left<hr.left+9.5||or.right>hr.left+150.5)issues.push('opening-outside-host');
        for(const row of rows){
          const body=row.querySelector('.v9-planned-line-text');
          if(!body)continue;
          const br=body.getBoundingClientRect();
          const rr=row.getBoundingClientRect();
          if(br.left<rr.left-.75||br.right>rr.right+.75)issues.push('body-outside-row');
          if(row.querySelector('.v9-opening-glyph')&&br.width>0){
            const overlap=Math.min(or.right,br.right)-Math.max(or.left,br.left);
            if(overlap>.75)issues.push('opening-body-overlap');
          }
        }
      }

      const text=clean(host.textContent);
      if(!text.includes('פתיח')||!text.includes("אב'(גד)"))issues.push('painted-text-loss');

      const rowWidths=plan.lines.map(l=>+Number(l.width||0).toFixed(2));
      results.push({...key,rows:plan.lines.length,openingWidth:+Number(plan.lines.find(l=>l.render?.opening)?.render?.opening?.width||0).toFixed(2),diag,rowWidths,issues});
      if(issues.length)failures.push({...key,issues,diag,rowWidths,sourceFromPlan,source});
    }finally{
      host.remove();
      context.dispose();
    }
  }

  return {cases,failed:failures.length,failures,results};
}
