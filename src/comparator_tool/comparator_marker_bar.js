/**
 * Render comparator marker counters without parsing user-controlled symbols as HTML.
 * Symbols may originate in imported documents or persisted settings.
 */
export function renderComparatorMarkerBar(bar, edId, syms, counts) {
  if (!bar) return;
  bar.replaceChildren();

  for (let ci = 0; ci < (syms || []).length; ci++) {
    const entry = syms[ci] || {};
    const sym = String(entry.sym ?? '');
    const n = Number(counts?.[sym] || 0);
    if (!(n > 0)) continue;

    const group = bar.ownerDocument.createElement('span');
    group.className = 'mc mc-' + ci;

    const label = bar.ownerDocument.createElement('span');
    label.className = 'sym-label-bar';
    label.textContent = sym;
    group.appendChild(label);

    for (let i = 1; i <= n; i++) {
      const badge = bar.ownerDocument.createElement('span');
      badge.className = 'badge';
      badge.dataset.action = 'jumpToNth';
      badge.dataset.edid = String(edId);
      badge.dataset.sym = sym;
      badge.dataset.nth = String(i);
      badge.title = String(i);
      badge.textContent = String(i);
      group.appendChild(badge);
    }

    bar.appendChild(group);
  }
}
