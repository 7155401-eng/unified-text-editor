// READ-ONLY LAB: never imported by product code. The browser owns line wrapping.
// V9 still supplies the source entry, resolved styles and the opening descriptor.
import { appendV9PlannedPart } from '../../src/engine/v9_text_measurement.js';
import { applyMarksToSpan } from '../../src/engine/runs_dom.js';
import { partForRange } from '../../src/engine/v9_main_inline_layout.js';
import { analyzeLastRow, nativeEligibility } from './contracts.js';
import { appendNativeSourcePart } from './source-tokens.js';

const keys = ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant',
  'fontFeatureSettings','fontKerning','lineHeight','letterSpacing','wordSpacing',
  'color','backgroundColor','textDecoration','direction'];
const apply = (el, style) => { for (const k of keys) if (style?.[k] != null) el.style[k] = String(style[k]); };
const round = n => Math.round(n * 10000) / 10000;

export function renderNativeParagraph(host, entry, context, config = {}) {
  if (!(host instanceof HTMLElement) || !entry || typeof entry.text !== 'string') throw new TypeError('Expected a host and a prepared source entry');
  const {width = 300, mode = 'float', wrap = 'wrap', exclusion = 'none', cutoff = 60,
    cutwidth = 70, endAlignment = 'center', keepSourceTokens = true} = config;
  if (!Number.isFinite(width) || width <= 0) throw new RangeError('Invalid available width');
  if (!['float','initial-word','inline'].includes(mode) || !['wrap','balance','pretty'].includes(wrap)) throw new RangeError('Unsupported experiment');
  const before = JSON.stringify(entry), desc = context.describeOpening(entry);
  const p = document.createElement('p');
  p.className = 'native-proof-paragraph'; p.dataset.paragraphId = String(entry.id || ''); p.lang = 'he';
  p.style.cssText = 'display:flow-root;position:static;margin:0;padding:0;border:0;box-sizing:border-box;white-space:pre-line;overflow:visible;word-break:normal;overflow-wrap:normal;hyphens:none;text-align:justify;';
  apply(p, entry.typography || context.typography);
  p.style.width = `${width}px`; p.style.textAlignLast = entry.continuesAfter ? 'justify' : endAlignment;
  p.style.textWrap = wrap;
  host.append(p);
  // Empty native exclusion boxes represent external geometry only; not text.
  // They are not placed into production, and do not divide a paragraph by row.
  const sides = exclusion === 'both' ? ['left','right'] : exclusion === 'none' ? [] : [exclusion];
  for (const side of sides) {
    if (!['left','right'].includes(side)) throw new RangeError('Invalid exclusion side');
    const e = document.createElement('span');e.className = 'native-proof-exclusion';e.setAttribute('aria-hidden','true');
    e.style.cssText = `float:${side};width:${cutwidth}px;height:${cutoff}px;shape-outside:inset(0);`;
    p.append(e);
  }
  let opening = null;
  if (desc) {
    opening = document.createElement('span'); opening.className = 'native-proof-opening';
    opening.style.cssText = 'position:static;white-space:pre;margin:0;padding:0;border:0;';
    const part = partForRange(entry, 0, desc.end, desc.end);
    part.runs = [...part.runs, {start: desc.start, end: desc.end, marks: {...desc.marks}}];
    applyMarksToSpan(opening, desc.marks);
    if (mode === 'float') {
      opening.style.cssFloat = 'inline-start';
      opening.style.blockSize = `${Math.max(context.lineHeight * desc.dropLines, context.measure(part).height)}px`;
      opening.style.marginInlineEnd = `${desc.gapPx}px`;
    } else if (mode === 'initial-word') {
      opening.style.initialLetter = `${desc.dropLines} ${desc.dropLines}`;
      opening.style.marginInlineEnd = `${desc.gapPx}px`;
    } else {
      opening.style.marginInlineEnd = `${desc.gapPx}px`;
    }
    appendV9PlannedPart(opening, part);p.append(opening);
  }
  const body = document.createElement('span'); body.className = 'native-proof-body';
  body.style.position = 'static';
  (keepSourceTokens ? appendNativeSourcePart : appendV9PlannedPart)(body, partForRange(entry, desc?.end || 0, entry.text.length));
  p.append(body);
  return {element:p, opening, body, entry, descriptor:desc, context,
    inputBefore:before, config:{width,mode,wrap,exclusion,cutoff,cutwidth,keepSourceTokens},
    // Skip policies requiring a pre-layout eligibility pass are not silently
    // ignored in this proof. They block adoption until separately implemented.
    policySupported: !desc?.skipPolicy?.skipShortLine && !desc?.skipPolicy?.skipSingleLine && !desc?.skipPolicy?.skipFewerThanLines};
}

function sourceOf(element) {
  const copy=element.cloneNode(true);copy.querySelectorAll('[data-v9-main-ref]').forEach(n=>n.remove());return copy.textContent;
}

export function inspectNativeParagraph(handle) {
  const {element:p,opening,body,entry,context,descriptor:desc,config:c}=handle;
  const origin=p.getBoundingClientRect(), units=[], rows=[];
  let sourceOffset=desc?.end || 0;
  const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);
  const segmenter=new Intl.Segmenter('he',{granularity:'grapheme'});
  const r=document.createRange();
  for(let node;(node=walker.nextNode());){
    if(node.parentElement.closest('[data-v9-main-ref]')) continue;
    for(const part of segmenter.segment(node.data)){
      if(!/^\s+$/u.test(part.segment)){
        r.setStart(node,part.index);r.setEnd(node,part.index+part.segment.length);
        const boxes=[...r.getClientRects()].filter(x=>x.width>0&&x.height>0);
        for(const box of boxes) units.push({start:sourceOffset+part.index,end:sourceOffset+part.index+part.segment.length,text:part.segment,
          left:box.left-origin.left,right:box.right-origin.left,top:box.top-origin.top,bottom:box.bottom-origin.top});
      }
    }
    sourceOffset+=node.data.length;
  }
  // Diagnostic grouping, not a renderer: ranges are measured only after native
  // flow. Mixed-size runs may share a baseline although their tops differ.
  for(const u of units){
    let row=rows.find(x=>Math.min(x.bottom,u.bottom)-Math.max(x.top,u.top)>Math.min(x.bottom-x.top,u.bottom-u.top)*0.5);
    if(!row){row={top:u.top,bottom:u.bottom,left:u.left,right:u.right,units:[]};rows.push(row);}
    row.top=Math.min(row.top,u.top);row.bottom=Math.max(row.bottom,u.bottom);row.left=Math.min(row.left,u.left);row.right=Math.max(row.right,u.right);row.units.push(u);
  }
  rows.sort((a,b)=>a.top-b.top);
  for(const row of rows){row.start=Math.min(...row.units.map(u=>u.start));row.end=Math.max(...row.units.map(u=>u.end));row.text=entry.text.slice(row.start,row.end);}
  const conflicts=[];
  for(const word of entry.text.matchAll(/\S+/gu)){
    const indices=rows.flatMap((row,i)=>row.units.some(u=>u.start<word.index+word[0].length&&u.end>word.index)?[i]:[]);
    if(indices.length>1)conflicts.push({start:word.index,end:word.index+word[0].length,rows:indices});
  }
  const opRect=opening?.getBoundingClientRect();
  const op=opRect?{left:opRect.left-origin.left,right:opRect.right-origin.left,top:opRect.top-origin.top,bottom:opRect.bottom-origin.top,
    gap:desc.gapPx,fontSize:getComputedStyle(opening).fontSize,fontFamily:getComputedStyle(opening).fontFamily}:null;
  const last=rows.at(-1);
  const insideWindow=!!(op&&last&&c.mode==='float'&&last.top<op.bottom-.65&&last.bottom>op.top+.65);
  const hostLeft=c.exclusion==='left'||c.exclusion==='both'?((last?.top||0)<c.cutoff?c.cutwidth:0):0;
  const hostRight=c.width-((c.exclusion==='right'||c.exclusion==='both')&&((last?.top||0)<c.cutoff)?c.cutwidth:0);
  const center=insideWindow&&!entry.continuesAfter?analyzeLastRow({hostLeft,hostRight,opening:op,row:last}):null;
  const computed=opening?getComputedStyle(opening):null;
  const sourcePreserved=sourceOf(p)===entry.text;
  const rowFit=rows.every(row=>{
    const overlapsCut=row.top<c.cutoff-.65&&row.bottom>0;
    const left=(c.exclusion==='left'||c.exclusion==='both')&&overlapsCut?c.cutwidth:0;
    let right=c.width-((c.exclusion==='right'||c.exclusion==='both')&&overlapsCut?c.cutwidth:0);
    if(op&&c.mode==='float'&&row.top<op.bottom-.65&&row.bottom>op.top+.65)right=Math.min(right,op.left-op.gap);
    return row.left>=left-.65&&row.right<=right+.65;
  });
  const noPositioning=[p,...p.querySelectorAll('*')].every(el=>!['absolute','fixed','relative','sticky'].includes(getComputedStyle(el).position));
  const check={sourcePreserved,inputUnchanged:JSON.stringify(entry)===handle.inputBefore,
    oneParagraph:p.tagName==='P'&&p.querySelectorAll('p').length===0,
    flowPositioned:noPositioning,typographyPreserved:!desc||Math.abs(parseFloat(computed.fontSize)-desc.marks.fontSize)<.01,
    rowFit,noSpaceBreaks:conflicts.length===0,centeredOpeningTail:center,
    // A recognized declaration is not evidence that a full-word initial works.
    geometrySufficient:!desc||(desc.position==='dropped'?c.mode==='float':c.mode==='inline'),policySupported:handle.policySupported};
  return JSON.parse(JSON.stringify({sourcePreserved,sourceOffsetEnd:sourceOffset,sourceLength:entry.text.length,
    rowCount:rows.length,rows:rows.map(({units,...rest})=>rest),opening:op,
    conflicts,center,contract:nativeEligibility(check),height:origin.height,checks:check,
    references:[...p.querySelectorAll('[data-v9-main-ref]')].map(el=>({uid:el.dataset.uid,text:el.textContent})),
    css:{mode:c.mode,wrap:getComputedStyle(p).textWrap,initialLetter:computed?.initialLetter||'normal'},
    structural:{paragraphs:1,forcedBreakNodes:p.querySelectorAll('br').length,absoluteTextNodes:p.querySelectorAll('[style*="position: absolute"]').length}},
    (key,value)=>typeof value==='number'?round(value):value));
}
