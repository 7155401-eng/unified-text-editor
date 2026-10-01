// Research candidate planner, NOT a browser feature or a production renderer.
// It asks the browser to reflow complete paragraphs at bounded candidate widths;
// no character/row positioning, text duplication, source edits, or <br> insertions.
import {partForRange} from '../../src/engine/v9_main_inline_layout.js';
import {renderNativeParagraph, inspectNativeParagraph} from './prototype.js';
import {analyzeLastRow} from './contracts.js';

function inspectGroup(handle, outerWidth) {
  const measurement = inspectNativeParagraph(handle);
  const {element:p,opening,body} = handle;
  const hostRect = p.parentElement.getBoundingClientRect(), pRect = p.getBoundingClientRect();
  const shift = pRect.left-hostRect.left;
  const op = measurement.opening && {...measurement.opening,
    left:measurement.opening.left+shift,right:measurement.opening.right+shift};
  const last = measurement.rows.at(-1);
  const row = last && {...last,left:last.left+shift,right:last.right+shift};
  const jointCenter = op && row ? analyzeLastRow({hostLeft:0,hostRight:outerWidth,opening:op,row}) : null;
  const allLeft=Math.min(op?.left??Infinity,...measurement.rows.map(r=>r.left+shift));
  const allRight=Math.max(op?.right??-Infinity,...measurement.rows.map(r=>r.right+shift));
  return {...measurement,jointCenter,
    wholeParagraphEnvelopeCenter:(allLeft+allRight)/2,
    wholeParagraphCentered:Math.abs((allLeft+allRight)/2-outerWidth/2)<=.65,
    sourceHTML:p.innerHTML,
    paragraphBox:{left:shift,right:pRect.right-hostRect.left,width:pRect.width},
    textNodes:body.querySelectorAll('.native-source-token').length,
    visualEquivalenceProven:false,productionEligible:false};
}

export function renderJointNativeCandidate(host, entry, context, config, inset = 0) {
  const width = config.width;
  if (!Number.isFinite(width) || !Number.isFinite(inset) || inset<0 || inset>=width) throw new RangeError('Invalid group geometry');
  host.style.width=`${width}px`;
  const handle=renderNativeParagraph(host,entry,context,{...config,width:width-inset,keepSourceTokens:true});
  // A single native paragraph box changes size/inline-start margin as a group.
  // The opening and all body rows still receive their positions from the browser.
  handle.element.style.marginInlineStart=`${inset}px`;
  handle.element.style.marginInlineEnd='0px';
  return {handle,measurement:inspectGroup(handle,width)};
}

export function probeJointNativeGroup(entry, context, config = {}) {
  const width = config.width ?? 300;
  const host=document.createElement('div');host.style.cssText='visibility:hidden;direction:rtl;border:0;padding:0;margin:0;';
  document.body.append(host);
  try {
    const settings={...config,width,mode:'float'};
    const baseline=renderJointNativeCandidate(host,entry,context,settings,0).measurement;
    const desc=context.describeOpening(entry);
    if ((config.mode && config.mode!=='float') || !desc || desc.position!=='dropped' || baseline.rowCount!==2 || !baseline.center || entry.continuesAfter || /[\r\n]/u.test(entry.text) || (config.exclusion && config.exclusion!=='none') || !baseline.checks.policySupported) {
      return {accepted:false,reason:'outside-two-row-constant-region-probe',baseline,trials:[],productionEligible:false};
    }
    const opWidth=baseline.opening.right-baseline.opening.left,gap=desc.gapPx;
    const candidates=new Set();
    for(const word of entry.text.matchAll(/\S+/gu)){
      if(word.index<desc.end)continue;
      const tail=context.measure(partForRange(entry,word.index,entry.text.length));
      // For a body natively centered in the remaining slot, a common right
      // inset t centers the final body+opening envelope when 3t=W-O-gap-L.
      // The browser MUST validate the actual last row after reflow; the predicted
      // suffix is not a forced break. A changed suffix may invalidate this t.
      const inset=Math.round((width-opWidth-gap-tail.width)/3*64)/64;
      if(inset>=0 && inset<width-opWidth-gap)candidates.add(inset);
    }
    const trials=[];
    for(const inset of [...candidates].sort((a,b)=>a-b).slice(0,64)){
      host.replaceChildren();
      const measurement=renderJointNativeCandidate(host,entry,context,settings,inset).measurement;
      const safe=['sourcePreserved','inputUnchanged','oneParagraph','flowPositioned','typographyPreserved','rowFit','noSpaceBreaks','policySupported'].every(k=>measurement.checks[k]===true);
      const accepted=safe && measurement.rowCount===2 && !!measurement.center && measurement.jointCenter?.meetsReportedCentering===true;
      const rowBoundariesChanged=JSON.stringify(measurement.rows.map(r=>[r.start,r.end]))!==JSON.stringify(baseline.rows.map(r=>[r.start,r.end]));
      trials.push({inset,accepted,rowCount:measurement.rowCount,rowBoundariesChanged,jointCenter:measurement.jointCenter,checks:measurement.checks});
      if(accepted)return {accepted:true,baseline,measurement,inset,trials,rowBoundariesChanged,
        paragraphWidthChanged:inset>0,openingPositionChanged:inset>0,
        // A native wrapping proof with JS candidate sizing is NOT the requested
        // identical appearance from one new native CSS property.
        sameAppearanceProven:false,productionEligible:false};
    }
    return {accepted:false,reason:'no-admissible-native-group-candidate',baseline,trials,productionEligible:false};
  } finally {host.remove();}
}
