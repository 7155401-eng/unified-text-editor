import { readFileSync, writeFileSync } from 'node:fs';

const NOTE_TEXT = 'סינון חלוניות לפי בחירת זרמים — שורה נפרדת, לא פעילה';

function patchFile(path, patcher) {
  const before = readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) writeFileSync(path, after, 'utf8');
}

patchFile('src/pane_side_by_side_controls.js', (source) => (
  source.replace(
    /\s*const streamFilterNote = document\.createElement\("div"\);[\s\S]*?targetGroup\.appendChild\(streamFilterNote\);/,
    ''
  )
));

patchFile('src/compact_stream_menu.js', (source) => {
  if (source.includes(NOTE_TEXT)) return source;

  const anchor = 'body.appendChild(hint); if (input) {';
  const note = [
    'body.appendChild(hint);',
    ' const streamFilterNote = document.createElement("div");',
    ' streamFilterNote.className = "stream-menu-filter-note";',
    ' streamFilterNote.setAttribute("aria-disabled", "true");',
    ' streamFilterNote.title = "שורה נפרדת בלבד; אינה משנה את הכפתורים או ההתנהגות הקיימת";',
    ` streamFilterNote.textContent = "${NOTE_TEXT}";`,
    ' streamFilterNote.style.cssText = "border:1px solid rgba(0,0,0,.10);border-radius:10px;padding:7px 8px;background:rgba(0,0,0,.025);font-size:11px;line-height:1.35;opacity:.78;margin:0 0 8px;";',
    ' body.appendChild(streamFilterNote);',
    ' if (input) {'
  ].join('');

  if (!source.includes(anchor)) {
    throw new Error('stream menu note anchor not found');
  }

  return source.replace(anchor, note);
});
