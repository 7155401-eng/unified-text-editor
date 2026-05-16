// RavText reference identity audit helper
// Usage in browser console after rendering pages:
//   import('/scripts/ravtext-ref-identity-audit.js').then(m => m.auditRefIdentity())
//
// Stage A purpose:
// - Detect whether rendered main references carry machine-readable identity.
// - Report how many refs are only visual text like [230], without data-stream/data-num/data-anchor.
// - Keep this separate from runtime code so it is safe and non-invasive.

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageNumberFor(el) {
  const page = el.closest('.page');
  if (!page) return null;
  const n = Number(page.dataset.pageIndex);
  return Number.isFinite(n) ? n + 1 : Array.from(document.querySelectorAll('.page')).indexOf(page) + 1;
}

function forceRealizeAllPages() {
  const holders = Array.from(document.querySelectorAll('*')).filter((el) => (
    el && typeof el.__realizePage === 'function' && Number.isFinite(el.__pageCount)
  ));
  for (const holder of holders) {
    for (let i = 0; i < holder.__pageCount; i++) {
      try { holder.__realizePage(i); } catch (_) {}
    }
  }
}

function textAroundElement(el, radius = 45) {
  const block = el.closest('p,h1,h2,h3,h4,h5,h6,td,blockquote,div');
  if (!block) return '';
  let before = '';
  let after = '';
  try {
    const r1 = document.createRange();
    r1.setStart(block, 0);
    r1.setEndBefore(el);
    before = r1.toString();
    r1.detach && r1.detach();
  } catch (_) {}
  try {
    const r2 = document.createRange();
    r2.setStartAfter(el);
    r2.setEnd(block, block.childNodes.length);
    after = r2.toString();
    r2.detach && r2.detach();
  } catch (_) {}
  return `${cleanText(before).slice(-radius)} ⟦${cleanText(el.textContent)}⟧ ${cleanText(after).slice(0, radius)}`;
}

function scanStreamRefs() {
  return Array.from(document.querySelectorAll('.page:not(.page-placeholder) .stream-ref')).map((el, index) => {
    const text = cleanText(el.textContent);
    const numberMatch = text.match(/\d+/);
    return {
      index,
      page: pageNumberFor(el),
      text,
      visualNum: numberMatch ? Number(numberMatch[0]) : null,
      stream: el.dataset.stream || '',
      num: el.dataset.num || el.dataset.noteNum || '',
      uid: el.dataset.uid || '',
      anchor: el.dataset.anchor || '',
      hasFullIdentity: !!(el.dataset.stream && (el.dataset.num || el.dataset.noteNum) && el.dataset.anchor),
      context: textAroundElement(el),
    };
  });
}

function scanRawBracketRefs() {
  const rows = [];
  const pages = Array.from(document.querySelectorAll('.page:not(.page-placeholder)'));
  for (const [pageIndex, page] of pages.entries()) {
    const text = cleanText(page.innerText || '');
    const re = /\[(\d+)\]/g;
    let m;
    while ((m = re.exec(text))) {
      rows.push({
        page: Number.isFinite(Number(page.dataset.pageIndex)) ? Number(page.dataset.pageIndex) + 1 : pageIndex + 1,
        num: Number(m[1]),
        index: m.index,
        context: `${text.slice(Math.max(0, m.index - 45), m.index)} ⟦${m[0]}⟧ ${text.slice(m.index + m[0].length, m.index + m[0].length + 45)}`,
      });
    }
  }
  return rows;
}

export function auditRefIdentity() {
  forceRealizeAllPages();
  const streamRefs = scanStreamRefs();
  const rawBracketRefs = scanRawBracketRefs();
  const withoutIdentity = streamRefs.filter((r) => !r.hasFullIdentity);
  const summary = {
    streamRefElements: streamRefs.length,
    streamRefsWithFullIdentity: streamRefs.length - withoutIdentity.length,
    streamRefsMissingIdentity: withoutIdentity.length,
    rawBracketRefsInPageText: rawBracketRefs.length,
    pagesWithRawBracketRefs: new Set(rawBracketRefs.map((r) => r.page)).size,
  };

  console.log('=== RavText reference identity summary ===');
  console.table([summary]);
  console.log('=== stream-ref elements missing identity ===');
  console.table(withoutIdentity.slice(0, 300));
  console.log('=== all stream-ref elements ===');
  console.table(streamRefs.slice(0, 300));

  const report = { summary, missingIdentity: withoutIdentity, streamRefs, rawBracketRefs };
  window.__ravtextRefIdentityAudit = report;
  window.__ravtextRefIdentityAuditText = JSON.stringify({ summary, missingIdentity: withoutIdentity }, null, 2);
  try {
    copy(window.__ravtextRefIdentityAuditText);
    console.log('Copied summary to clipboard.');
  } catch (_) {}
  return report;
}

if (typeof window !== 'undefined') {
  window.RavTextAuditRefIdentity = auditRefIdentity;
}
