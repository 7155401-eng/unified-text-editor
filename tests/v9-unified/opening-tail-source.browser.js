import {createV9TextLayoutContext,renderV9PlannedMainLine} from '../../src/engine/v9_text_measurement.js';
import {layoutV9MainParagraphs,partForRange} from '../../src/engine/v9_main_inline_layout.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const sourcePart = part => part ? (part.leadingText || '') + part.text + (part.trailingText || '') : '';
const sourceOf = element => {
  const copy = element.cloneNode(true);
  copy.querySelectorAll('[data-v9-main-ref]').forEach(ref => ref.remove());
  return copy.textContent;
};

export function runOpeningTailSourceChecks() {
  const results = [];
  for (const family of ['serif', 'sans-serif', 'monospace'])
  for (const prefix of ['', '  '])
  for (const separator of [' ', '  ', '\t', ' \u200f '])
  for (const noteMode of ['hidden', 'end-forward', 'word-backward'])
  for (const emptyHost of [false, true])
  for (const continuesAfter of [true, false]) {
    const name = JSON.stringify({family, prefix, separator, noteMode, emptyHost, continuesAfter});
    const context = createV9TextLayoutContext({
      mainFontFamily: family, mainFontSize: 16, lineHeightRatio: 1.5,
      openingWordSettings: {enabled: true, target: 'word', count: 1, font: 'inherit', size: 175,
        weight: 'bold', position: 'dropped', dropLines: 2, spaceAfter: .2, scope: 'all',
        skipHeadings: false, skipShortLine: false, skipSingleLine: false, skipFewerThanLines: false},
    });
    const page = document.createElement('div');
    page.style.cssText = 'position:relative;margin:0;padding:0;border:0;';
    document.body.append(page);
    try {
      const text = prefix + 'פתיח' + separator + Array(6).fill('אב').join(' ') +
        (continuesAfter ? '' : ' ' + 'W'.repeat(80));
      const openingEnd = prefix.length + 4;
      const wordStart = text.indexOf('אב', openingEnd);
      const entry = context.prepareEntry({id: 'tail-source', text, sourceOffset: 37, continuesAfter,
        runs: [{start: wordStart, end: wordStart + 2, marks: {bold: true, color: 'rgb(31,47,67)'}}],
        mainRefs: [{uid: 'boundary', anchor: noteMode === 'word-backward' ? wordStart : openingEnd,
          anchorAffinity: noteMode === 'word-backward' ? 'backward' : 'forward',
          formatted: noteMode === 'hidden' ? '' : '[1]', cssText: 'font-size:10px;line-height:1;vertical-align:super'},
          {uid: 'tail', anchor: text.length, anchorAffinity: 'backward', formatted: '[9]', cssText: 'font-size:10px;line-height:1'}],
      });
      const description = context.describeOpening(entry);
      assert(description.end === openingEnd, 'fixture extracted a different opening source range');
      const openingPart = partForRange(entry, 0, description.end);
      openingPart.runs.push({start: description.start, end: description.end, marks: description.marks});
      const openingWidth = context.measure(openingPart).width;
      const firstWidth = context.measure(partForRange(entry, openingEnd, wordStart + 2)).width;
      const width = emptyHost ? openingWidth + description.gapPx + firstWidth * .15 : 180;
      const strips = [{x: 13, width, y_start: 7, y_end: 270}];
      const input = JSON.stringify({entry, strips});
      const plan = layoutV9MainParagraphs([entry], strips, context, 270);
      const snapshot = JSON.stringify(plan);
      for (const line of plan.lines) renderV9PlannedMainLine(line, page, 0);
      assert(JSON.stringify({entry, strips}) === input, 'source, typography or note anchors mutated');
      assert(JSON.stringify(plan) === snapshot, 'painter rewrote the plan');
      assert(plan.lines.map(line => line.sourceText).join('') + plan.overflowText === text, 'planned source changed');
      assert(sourceOf(page) + plan.overflowText === text, 'paint lost or repeated source characters');
      assert(page.querySelectorAll('.v9-opening-glyph').length === 1, 'opening lost/duplicated');
      const refs = plan.lines.flatMap(line => [...(line.render.opening?.part.refs || []), ...line.render.body.refs]);
      const remainingRefs = plan.overflowParagraphs.flatMap(p => p.mainRefs);
      assert([...refs, ...remainingRefs].map(ref => ref.uid).sort().join(',') === 'boundary,tail',
        'reference disappeared or gained a second owner');
      for (const ref of refs) assert(ref.anchor === entry.mainRefs.find(r => r.uid === ref.uid).anchor, 'painted note anchor moved');
      for (const paragraph of plan.overflowParagraphs) for (const ref of paragraph.mainRefs) {
        assert(ref.anchor + paragraph.sourceOffset - entry.sourceOffset === entry.mainRefs.find(r => r.uid === ref.uid).anchor,
          'overflow note no longer maps to its source anchor');
      }
      const expectedVisible = refs.filter(ref => ref.formatted).map(ref => ref.uid).sort();
      const visible = [...page.querySelectorAll('[data-v9-main-ref]')];
      assert(JSON.stringify(visible.map(ref => ref.dataset.uid).sort()) === JSON.stringify(expectedVisible), 'visible label lost or hidden label painted');
      const opening = page.querySelector('.v9-opening-glyph').getBoundingClientRect();
      let bodyRows = 0;
      for (const [index, line] of plan.lines.entries()) {
        assert(sourcePart(line.render.opening?.part) + sourcePart(line.render.body) === line.sourceText, 'opening/body partition has a hole');
        assert(line.source.paragraphId === entry.id && !line.isLast, 'continuation became a separate completed paragraph');
        assert(line.render.alignment === 'right', 'source fix changed last-line alignment');
        const measured = context.measure(line.render.body);
        assert(Math.abs(measured.width - line.naturalWidth) <= 1/64, 'paint part differs from measured content');
        assert(line.naturalWidth <= line.width + 1/64, 'new label was not included in width planning');
        const body = page.querySelectorAll('.v9-planned-line-text')[index];
        assert(sourceOf(body) === sourcePart(line.render.body), 'body painter changed its source');
        if (line.wordTokens.length) bodyRows++;
        if (emptyHost && index === 0) {
          assert(line.wordTokens.length === 0, 'text moved into an opening-only glyph box');
          assert(body.textContent === '', 'source glue or a note moved into an opening-only glyph box');
        }
      }
      for (const marker of visible.filter(ref => !ref.closest('.v9-opening-glyph'))) {
        const rect = marker.getBoundingClientRect();
        const overlapX = Math.min(rect.right, opening.right) - Math.max(rect.left, opening.left);
        const overlapY = Math.min(rect.bottom, opening.bottom) - Math.max(rect.top, opening.top);
        assert(overlapX < .2 || overlapY < .2, 'restored note overlaps the opening');
      }
      assert(bodyRows > 0, 'fixture rendered no body');
      results.push({name, pass: true, rebalanced: plan.lines.some(line => line.tailRebalanced),
        emptyHost, rowCount: plan.lines.length, visibleLabels: visible.length, overflow: plan.overflowText.length});
    } catch (error) { results.push({name, pass: false, error: String(error)}); }
    finally { context.dispose(); page.remove(); }
  }
  return {total: results.length, passed: results.filter(r => r.pass).length,
    failed: results.filter(r => !r.pass).length,
    rebalancedCases: results.filter(r => r.pass && r.rebalanced).length,
    results};
}
