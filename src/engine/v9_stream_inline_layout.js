import { createV9TextLayoutContext, appendV9PlannedPart } from './v9_text_measurement.js';
import { layoutV9MainParagraphs } from './v9_main_inline_layout.js';
import { normalizeRichTextEntry, makeRichText, sliceRichText } from './rich_text_runs.js';
import { applyStyleToElement, applyTextStyleObjectToElement } from '../style_registry.js';

// Streams use the SAME measured line breaker as main text. No CSS wrapping
// after V9 has assigned absolute row positions; no scale or font-size rescue.
export function streamContextForV9(cfg, id, styleId, inlineStyle) {
  const cache = cfg.__v9StreamContexts;
  if (!cache) throw new Error('Missing render-scoped stream contexts');
  const streamLineHeightRatio = Number(cfg.streamLineHeightRatio) > 0
    ? Number(cfg.streamLineHeightRatio)
    : (Number(cfg.lineHeightRatio) > 0 ? Number(cfg.lineHeightRatio) : 1.55);
  const key = JSON.stringify([id, styleId, inlineStyle, cfg.sideFontFamily, cfg.sideFontSize, streamLineHeightRatio]);
  if (cache.has(key)) return cache.get(key);
  const c = createV9TextLayoutContext({ mainFontSize: cfg.sideFontSize || 11,
    mainFontFamily: cfg.sideFontFamily || 'serif', lineHeightRatio: streamLineHeightRatio,
    openingWordSettings: {enabled:false} }, {decorateBase(el) {
      applyStyleToElement(el, styleId);
      if (inlineStyle) applyTextStyleObjectToElement(el, inlineStyle);
    }});
  c.streamId = id;
  cache.set(key,c); return c;
}

export function flowV9MeasuredStream(input, strips, context, maxY, options = {}) {
  const rich = normalizeRichTextEntry(input);
  if (!rich.text || !strips?.length) return {lines:[],overflowRich:rich,overflowText:rich.text,overflowRuns:rich.runs,endY:0};
  const ss = strips.map((s,i) => ({ ...s, x:Number(s.x)||0,
    y_end: Number.isFinite(s.y_end) ? Math.min(s.y_end,maxY) : Math.min(strips[i+1]?.y_start ?? maxY,maxY) }));
  const entry = context.prepareEntry({id:context.streamId || 'stream',text:rich.text,runs:rich.runs,mainRefs:[],continuesAfter:!!options.continuesAfter});
  const plan = layoutV9MainParagraphs([entry],ss,context,maxY,options);
  const remaining = plan.overflowParagraphs[0];
  const overflowRich = remaining ? makeRichText(remaining.text,remaining.runs) : makeRichText('');
  return { lines: plan.lines.map(l => ({...l, layoutVersion:undefined, _v9MeasuredStream:true,
      words:l.wordTokens.map(t=>t.text), render:l.render})),
    overflowText:overflowRich.text,overflowRuns:overflowRich.runs,overflowRich,
    consumedWords:plan.lines.reduce((n,l)=>n+l.wordTokens.length,0),
    totalWords:(rich.text.match(/\S+/gu)||[]).length,endY:plan.endY };
}

// Scenario selection must use the same styled row breaker as final paint.
// This answers only the threshold question and never approximates with Canvas.
export function hasAtLeastV9Rows(input, context, width, rows) {
  const target = Math.max(1, Math.floor(Number(rows) || 0));
  if (!normalizeRichTextEntry(input).text) return false;
  const plan = flowV9MeasuredStream(
    input,
    [{ x: 0, width, y_start: 0, y_end: Number.MAX_SAFE_INTEGER }],
    context,
    Number.MAX_SAFE_INTEGER,
    { maxLines: target }
  );
  return (plan.lines || []).length >= target;
}

// Crown row count is a typography constraint, not a base-font estimate.
// Inspect only the requested leading rows using the same line planner.
export function measureV9CrownHeight(input, context, width, rows) {
  if (!(rows>0) || !normalizeRichTextEntry(input).text) return 0;
  const plan=flowV9MeasuredStream(input,[{x:0,width,y_start:0,y_end:Number.MAX_SAFE_INTEGER}],context,Number.MAX_SAFE_INTEGER,{maxLines:rows});
  return plan.endY;
}

// The historical column balancer supplies a word count, not source offsets.
// Recover the split in the ORIGINAL string before slicing style ranges.
export function splitV9StreamAtWordCount(input, wordCount) {
  const rich=normalizeRichTextEntry(input),words=[...rich.text.matchAll(/\S+/gu)];
  const at=words[Math.max(0,wordCount)]?.index ?? rich.text.length;
  return [sliceRichText(rich,0,at),sliceRichText(rich,at,rich.text.length)];
}

export function flowV9MeasuredColumns(input, context, {top,bottom,width,columns=1,gap=0,maxLines=0}) {
  const cw=columns>1?(width-gap*(columns-1))/columns:width;
  let remaining=normalizeRichTextEntry(input),endY=top;
  const lines=[];
  let lineBudget=Math.max(0,Math.floor(Number(maxLines)||0));
  for(let column=0;column<columns && remaining.text;column++) {
    if(lineBudget>0 && lines.length>=lineBudget) break;
    const x=(columns-1-column)*(cw+gap);
    const remainingBudget=lineBudget>0?Math.max(0,lineBudget-lines.length):0;
    const p=flowV9MeasuredStream(
      remaining,
      [{x,width:cw,y_start:top,y_end:bottom}],
      context,
      bottom,
      remainingBudget>0?{maxLines:remainingBudget}:{}
    );
    lines.push(...p.lines);remaining=p.overflowRich;endY=Math.max(endY,p.endY);
  }
  return {lines,endY,overflowRich:remaining};
}

export function renderV9MeasuredStreamLine(line,box,page,padding,colorClass='') {
  const el=document.createElement('div');
  el.className=`v9-line v9-final-stream-line v9-role-${box.role || 'stream'}${colorClass}`;
  // The CSS classes .justify/.center deliberately aren't used: they permit
  // a browser-created second row inside a one-row absolutely positioned box.
  el.style.cssText='position:absolute;box-sizing:border-box;white-space:pre;overflow:visible;transform:none;margin:0;padding:0;border:0;text-indent:0;';
  Object.assign(el.style,line.render.body.style);
  Object.assign(el.style,{left:`${padding+line.x}px`,top:`${line.y}px`,width:`${line.width}px`,height:`${line.lineHeightPx}px`,
    wordSpacing:'0px',textAlign:'right'});
  Object.assign(el.dataset,{v9Role:box.role||'stream',v9BoxId:String(box.id),v9SourceStream:String(box.id),
    v9StreamLayoutFinal:'v9-inline-1',v9StretchPolicy:'planned-in-v9',v9NaturalWidth:String(line.naturalWidth)});
  if(line.forcedBreak)el.dataset.v9ForcedBreak='1';
  if(line.isLast)el.dataset.v9ParaLast='1';
  const body=document.createElement('span');body.className='v9-planned-stream-text';
  body.style.cssText=`position:absolute;left:0;display:block;box-sizing:border-box;margin:0;padding:0;top:${line.render.topInset || 0}px;white-space:pre;width:${line.width}px;`;
  body.style.wordSpacing=`${line.render.wordSpacing}px`;body.style.textAlign=line.render.alignment;
  appendV9PlannedPart(body,line.render.body);el.append(body);page.append(el);return el;
}
