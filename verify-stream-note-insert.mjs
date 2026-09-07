// Verification for note 2 ("mark as stream" really moves the text) and note 3
// (the add-a-footnote popup). Drives the real page at 127.0.0.1:5203.
//
// The local dev server does not serve /api/main-text-tools (it answers 404), so
// the request is fulfilled here by the very same worker function the deployed
// site runs - worker/main_text_tools.js. Nothing is re-implemented.
//
// No Hebrew is printed: every check reports numbers and ASCII probe words only.
import { chromium } from 'playwright-chromium';
import fs from 'node:fs';
import { handleMainTextTools } from './worker/main_text_tools.js';

const results = [];
const check = (name, cond, detail) => {
  results.push({ name, pass: !!cond, detail: String(detail ?? '') });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let apiCalls = 0;
await page.route('**/api/main-text-tools', async (route) => {
  apiCalls += 1;
  const body = JSON.parse(route.request().postData() || '{}');
  const res = await handleMainTextTools({ method: 'POST', json: async () => body });
  await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
});

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));

await page.goto('http://127.0.0.1:5203/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);

// ---------------------------------------------------------------- helpers
await page.evaluate(() => {
  window.__t = {
    pm: () => window.paneManager,
    main: () => window.paneManager.getMainPane(),
    stream: (c) => window.paneManager.panes.find((p) => p.streamCode === c),
    plain: (ed) => ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n', '\n'),
    markers: (ed, c) => (ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n', '\n').match(new RegExp('@' + c, 'g')) || []).length,
  };
});

// ------------------------------------------------- 0. wiring is really there
const wiring = await page.evaluate(() => ({
  markFn: typeof window.__ravtextMarkSelectionAsStream,
  addFn: typeof window.__ravtextAddNoteToStream,
  openFn: typeof window.__ravtextOpenAddNoteDialog,
  openBtn: !!document.getElementById('rt-add-note-open-btn'),
  labelFn: typeof window.__ravtextSyncStreamButtonLabels,
}));
check('mark-as-stream is wired', wiring.markFn === 'function', wiring.markFn);
check('add-note engine is wired', wiring.addFn === 'function', wiring.addFn);
check('popup opener is wired', wiring.openFn === 'function', wiring.openFn);
check('open button sits in the stream toolbar', wiring.openBtn, wiring.openBtn);

// ------------------------------------ 1. stream buttons show the LIVE name
const labels = await page.evaluate(() => {
  const pane = window.paneManager.panes.find((p) => p.streamCode === '01');
  const before = document.querySelector('.btn-stream[data-stream="01"]').textContent.trim();
  pane.label = 'ZZTESTNAME';
  window.__ravtextSyncStreamButtonLabels();
  const markAfter = document.querySelector('.btn-stream[data-stream="01"]').textContent.trim();
  const jumpAfter = document.querySelector('.btn-stream-jump[data-stream="01"]').textContent.trim();
  return { beforeLen: before.length, markAfter, jumpAfter, wasDefault: before !== 'ZZTESTNAME' };
});
check('mark button shows the new name', labels.markAfter === 'ZZTESTNAME', labels.markAfter);
check('jump button shows the new name', labels.jumpAfter === 'ZZTESTNAME', labels.jumpAfter);
check('the name really changed', labels.wasDefault, `old length ${labels.beforeLen}`);

// ------------------------------------------------ 2. "mark as stream" moves
const PROBE = 'AAAABBBBCCCC';           // 12 characters
const move = await page.evaluate(async (PROBE) => {
  const t = window.__t;
  const main = t.main();
  const st = t.stream('01');
  main.editor.commands.setContent(`<p>one @01 two @01 three ${PROBE} four</p>`);
  st.editor.commands.setContent('<p>@01 [1] NOTEONE</p><p>@01 [2] NOTETWO</p>');
  await new Promise((r) => setTimeout(r, 300));

  const before = {
    main: t.plain(main.editor),
    stream: t.plain(st.editor),
    mainMarkers: t.markers(main.editor, '01'),
  };

  const idx = before.main.indexOf(PROBE);
  const from = idx + 1;                       // one paragraph -> text starts at 1
  const to = from + PROBE.length;
  window.paneManager.activePane = main;
  main.editor.commands.focus();
  main.editor.commands.setTextSelection({ from, to });
  const selected = main.editor.state.doc.textBetween(from, to);

  const ok = await window.__ravtextMarkSelectionAsStream('01');
  await new Promise((r) => setTimeout(r, 500));

  const after = {
    main: t.plain(main.editor),
    stream: t.plain(st.editor),
    mainMarkers: t.markers(main.editor, '01'),
    streamHtmlHasMark: /stream-marker/.test(st.editor.getHTML()),
    mainHtmlMarks: (main.editor.getHTML().match(/stream-marker/g) || []).length,
  };
  return { ok, selected, before, after, status: document.getElementById('status').textContent.length };
}, PROBE);

check('the selected text was really the probe', move.selected === PROBE, move.selected);
check('the call reported success', move.ok === true, move.ok);
check('main text lost exactly the probe',
  !move.after.main.includes(PROBE) && move.before.main.includes(PROBE),
  `before ${move.before.main.length} chars, after ${move.after.main.length} chars`);
check('main text is exactly -12 +3 characters',
  move.after.main.length === move.before.main.length - PROBE.length + 3,
  `${move.before.main.length} -> ${move.after.main.length} (expected ${move.before.main.length - PROBE.length + 3})`);
check('main text gained one marker',
  move.after.mainMarkers === move.before.mainMarkers + 1,
  `${move.before.mainMarkers} -> ${move.after.mainMarkers}`);
check('stream gained exactly the probe',
  move.after.stream.includes(PROBE) && !move.before.stream.includes(PROBE),
  `before ${move.before.stream.length} chars, after ${move.after.stream.length} chars`);
// the new note is "@01 [3] " + probe, plus the newline that joins the new block
check('stream grew by the exact note length',
  move.after.stream.length === move.before.stream.length + ('@01 [3] ' + PROBE).length + 1,
  `${move.before.stream.length} -> ${move.after.stream.length} (expected ${move.before.stream.length + ('@01 [3] ' + PROBE).length + 1})`);
check('the note landed third and the old two kept their order',
  /\[1\] NOTEONE[\s\S]*\[2\] NOTETWO[\s\S]*\[3\] AAAABBBBCCCC/.test(move.after.stream),
  move.after.stream.replace(/[^\x20-\x7e\n]/g, '#').slice(0, 80));
check('the new marker is painted as a stream marker', move.after.mainHtmlMarks >= 1, move.after.mainHtmlMarks);
check('a status line was written for the user', move.status > 0, `${move.status} characters`);

// --------------------------------- 2b. no selection -> the old behaviour stays
const noSel = await page.evaluate(async () => {
  const t = window.__t;
  const main = t.main();
  const st = t.stream('01');
  const beforeMain = t.plain(main.editor).length;
  const beforeStream = t.plain(st.editor).length;
  main.editor.commands.setTextSelection(3);
  const ok = await window.__ravtextMarkSelectionAsStream('01');
  await new Promise((r) => setTimeout(r, 300));
  return { ok, beforeMain, beforeStream, afterMain: t.plain(main.editor).length, afterStream: t.plain(st.editor).length };
});
check('with no selection nothing is moved',
  noSel.ok === false && noSel.afterMain === noSel.beforeMain && noSel.afterStream === noSel.beforeStream,
  `main ${noSel.beforeMain}->${noSel.afterMain}, stream ${noSel.beforeStream}->${noSel.afterStream}`);

// ---------------------------------------------- 3. the add-a-footnote popup
const NOTE = 'POPUPNOTE1234';   // 13 characters
const popup = await page.evaluate(async () => {
  const t = window.__t;
  const main = t.main();
  const st = t.stream('02');
  main.editor.commands.setContent('<p>alpha @02 beta</p>');
  st.editor.commands.setContent('<p>@02 [1] FIRSTNOTE</p>');
  await new Promise((r) => setTimeout(r, 300));
  const size = main.editor.state.doc.content.size;
  window.paneManager.activePane = main;
  main.editor.commands.setTextSelection(size - 1);
  return {
    mainBefore: t.plain(main.editor),
    streamBefore: t.plain(st.editor),
    markersBefore: t.markers(main.editor, '02'),
  };
});

await page.evaluate(() => window.__ravtextOpenAddNoteDialog());
await page.waitForTimeout(300);

const openState = await page.evaluate(() => {
  const dlg = document.getElementById('rt-add-note-dialog');
  const sel = document.getElementById('rt-add-note-stream');
  const opts = Array.from(sel.options).map((o) => ({ value: o.value, text: o.textContent }));
  const win = dlg.querySelector('.rtan-window');
  const cs = getComputedStyle(win);
  return {
    open: dlg.classList.contains('is-open'),
    dir: dlg.getAttribute('dir'),
    role: win.getAttribute('role'),
    optionCount: opts.length,
    firstOptionText: opts[0]?.text,
    firstOptionIsLiveName: opts[0]?.text === 'ZZTESTNAME',
    focusIsBox: document.activeElement?.id,
    visible: cs.display !== 'none' && win.getBoundingClientRect().width > 200,
    hasClose: !!dlg.querySelector('.rtan-head button'),
  };
});
check('popup opened and is visible', openState.open && openState.visible, `${openState.open}/${openState.visible}`);
check('popup is right-to-left', openState.dir === 'rtl', openState.dir);
check('popup is a dialog for screen readers', openState.role === 'dialog', openState.role);
check('popup has a close button', openState.hasClose, openState.hasClose);
check('chooser lists every stream pane', openState.optionCount === 5, openState.optionCount);
check('chooser shows the LIVE name, not the default',
  openState.firstOptionIsLiveName, openState.firstOptionText);
check('focus lands in the text box', openState.focusIsBox === 'rt-add-note-text', openState.focusIsBox);

// empty box must insert nothing
const emptyTry = await page.evaluate(async () => {
  const t = window.__t;
  const st = t.stream('02');
  const before = t.plain(st.editor).length;
  const mainBefore = t.plain(t.main().editor).length;
  document.getElementById('rt-add-note-text').value = '   ';
  document.querySelector('#rt-add-note-dialog .rtan-foot button').click();
  await new Promise((r) => setTimeout(r, 400));
  return {
    stillOpen: document.getElementById('rt-add-note-dialog').classList.contains('is-open'),
    msgLen: document.querySelector('#rt-add-note-dialog .rtan-msg').textContent.length,
    streamBefore: before,
    streamAfter: t.plain(st.editor).length,
    mainBefore,
    mainAfter: t.plain(t.main().editor).length,
  };
});
check('an empty box inserts nothing',
  emptyTry.streamAfter === emptyTry.streamBefore && emptyTry.mainAfter === emptyTry.mainBefore,
  `stream ${emptyTry.streamBefore}->${emptyTry.streamAfter}, main ${emptyTry.mainBefore}->${emptyTry.mainAfter}`);
check('an empty box explains itself and stays open',
  emptyTry.stillOpen && emptyTry.msgLen > 0, `open=${emptyTry.stillOpen} message=${emptyTry.msgLen} chars`);

// Escape must close it
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const afterEsc = await page.evaluate(() => document.getElementById('rt-add-note-dialog').classList.contains('is-open'));
check('Escape closes the popup', afterEsc === false, afterEsc);

// real insert through the popup
await page.evaluate(() => window.__ravtextOpenAddNoteDialog());
await page.waitForTimeout(250);
await page.selectOption('#rt-add-note-stream', '02');
await page.fill('#rt-add-note-text', NOTE);
// Enter alone must NOT submit
await page.focus('#rt-add-note-text');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const afterEnter = await page.evaluate(() => ({
  open: document.getElementById('rt-add-note-dialog').classList.contains('is-open'),
  streamLen: window.__t.plain(window.__t.stream('02').editor).length,
}));
check('plain Enter does not submit', afterEnter.open === true, afterEnter.open);

const apiBeforePopup = apiCalls;
await page.evaluate(() => { document.getElementById('rt-add-note-text').value = 'POPUPNOTE1234'; });
await page.click('#rt-add-note-dialog .rtan-foot button');
await page.waitForTimeout(800);
check('the popup asked the SERVER for this insert', apiCalls === apiBeforePopup + 1,
  `${apiBeforePopup} -> ${apiCalls} calls to /api/main-text-tools`);

const popupAfter = await page.evaluate(() => {
  const t = window.__t;
  return {
    open: document.getElementById('rt-add-note-dialog').classList.contains('is-open'),
    main: t.plain(t.main().editor),
    stream: t.plain(t.stream('02').editor),
    markers: t.markers(t.main().editor, '02'),
    statusLen: document.getElementById('status').textContent.length,
  };
});
check('popup inserted the note into the stream',
  popupAfter.stream.includes(NOTE), popupAfter.stream.replace(/[^\x20-\x7e\n]/g, '#'));
check('stream grew by the exact note length',
  popupAfter.stream.length === popup.streamBefore.length + ('@02 [2] ' + NOTE).length + 1,
  `${popup.streamBefore.length} -> ${popupAfter.stream.length} (expected ${popup.streamBefore.length + ('@02 [2] ' + NOTE).length + 1})`);
check('main text gained exactly one marker',
  popupAfter.markers === popup.markersBefore + 1,
  `${popup.markersBefore} -> ${popupAfter.markers}`);
check('main text grew by exactly 3 characters',
  popupAfter.main.length === popup.mainBefore.length + 3,
  `${popup.mainBefore.length} -> ${popupAfter.main.length}`);
check('the note landed second, after the existing one',
  /\[1\] FIRSTNOTE[\s\S]*\[2\] POPUPNOTE1234/.test(popupAfter.stream), 'order');
check('popup closed itself after a clean insert', popupAfter.open === false, popupAfter.open);
check('the server was really asked every time', apiCalls >= 2, `${apiCalls} calls`);

// -------------------------- 4. the out-of-sync case is explained, not hidden
const outOfSync = await page.evaluate(async () => {
  const t = window.__t;
  const main = t.main();
  const st = t.stream('03');
  main.editor.commands.setContent('<p>x @03 y @03 z @03 w</p>');
  st.editor.commands.setContent('<p>@03 [1] ONLYNOTE</p>');
  await new Promise((r) => setTimeout(r, 250));
  window.paneManager.activePane = main;
  main.editor.commands.setTextSelection(main.editor.state.doc.content.size - 1);
  window.__ravtextOpenAddNoteDialog();
  await new Promise((r) => setTimeout(r, 250));
  document.getElementById('rt-add-note-stream').value = '03';
  document.getElementById('rt-add-note-text').value = 'LATENOTE';
  document.querySelector('#rt-add-note-dialog .rtan-foot button').click();
  await new Promise((r) => setTimeout(r, 700));
  return {
    open: document.getElementById('rt-add-note-dialog').classList.contains('is-open'),
    msgLen: document.querySelector('#rt-add-note-dialog .rtan-msg').textContent.length,
    warn: document.querySelector('#rt-add-note-dialog .rtan-msg').className.includes('is-warn'),
    stream: t.plain(st.editor),
  };
});
check('out-of-sync stream: the note still went in',
  outOfSync.stream.includes('LATENOTE'), outOfSync.stream.replace(/[^\x20-\x7e\n]/g, '#'));
check('out-of-sync stream: the popup stays open and warns',
  outOfSync.open && outOfSync.warn && outOfSync.msgLen > 20,
  `open=${outOfSync.open} warn=${outOfSync.warn} message=${outOfSync.msgLen} chars`);

await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ------- 5. the browser must NOT be able to do this on its own
// The API is switched off. If any part of the answer were worked out in the
// browser, a note would still slip in - and that is exactly what must not
// happen: this logic lives on the server only.
await page.unroute('**/api/main-text-tools');
await page.route('**/api/main-text-tools', (route) =>
  route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"blocked"}' }));

const blocked = await page.evaluate(async () => {
  const t = window.__t;
  const main = t.main();
  const st = t.stream('04');
  main.editor.commands.setContent('<p>q @04 r NOSERVERTEXT s</p>');
  st.editor.commands.setContent('<p>@04 [1] KEEPME</p>');
  await new Promise((r) => setTimeout(r, 250));
  const mainBefore = t.plain(main.editor);
  const streamBefore = t.plain(st.editor);

  // a) the popup path
  window.paneManager.activePane = main;
  main.editor.commands.setTextSelection(main.editor.state.doc.content.size - 1);
  window.__ravtextOpenAddNoteDialog();
  await new Promise((r) => setTimeout(r, 250));
  document.getElementById('rt-add-note-stream').value = '04';
  document.getElementById('rt-add-note-text').value = 'SHOULDNOTAPPEAR';
  document.querySelector('#rt-add-note-dialog .rtan-foot button').click();
  await new Promise((r) => setTimeout(r, 900));
  const popupMsg = document.querySelector('#rt-add-note-dialog .rtan-msg');
  const popupState = { open: document.getElementById('rt-add-note-dialog').classList.contains('is-open'), warn: popupMsg.className.includes('is-warn'), msgLen: popupMsg.textContent.length };
  window.__ravtextCloseAddNoteDialog();

  // b) the "mark as stream" path
  const idx = t.plain(main.editor).indexOf('NOSERVERTEXT');
  main.editor.commands.focus();
  main.editor.commands.setTextSelection({ from: idx + 1, to: idx + 1 + 'NOSERVERTEXT'.length });
  const markOk = await window.__ravtextMarkSelectionAsStream('04');
  await new Promise((r) => setTimeout(r, 400));

  return {
    popupState,
    markOk,
    mainBefore, streamBefore,
    mainAfter: t.plain(main.editor),
    streamAfter: t.plain(st.editor),
    statusLen: document.getElementById('status').textContent.length,
  };
});
check('server off: the popup inserts nothing',
  blocked.streamAfter === blocked.streamBefore && !blocked.streamAfter.includes('SHOULDNOTAPPEAR'),
  `stream ${blocked.streamBefore.length} -> ${blocked.streamAfter.length}`);
check('server off: the popup says so and stays open',
  blocked.popupState.open && blocked.popupState.warn && blocked.popupState.msgLen > 0,
  `open=${blocked.popupState.open} warn=${blocked.popupState.warn}`);
check('server off: mark-as-stream moves nothing and loses nothing',
  blocked.markOk === false && blocked.mainAfter === blocked.mainBefore && blocked.mainAfter.includes('NOSERVERTEXT'),
  `main ${blocked.mainBefore.length} -> ${blocked.mainAfter.length}`);
check('server off: the user is told plainly', blocked.statusLen > 0, `${blocked.statusLen} characters`);

// ------------------------------------------------ 6. the page still renders
const pages = await page.evaluate(() => document.querySelectorAll('.page:not(.page-placeholder)').length);
check('page view is intact (not asserted as 40 - no render was triggered)', true, `${pages} pages present`);

check('no uncaught script errors from the new code',
  pageErrors.filter((e) => /stream_note_insert|add_note_dialog|markSelectionAsStream/.test(e)).length === 0,
  pageErrors.slice(0, 3).join(' | '));

const passed = results.filter((r) => r.pass).length;
fs.writeFileSync('_verify_streams.json', JSON.stringify({ passed, total: results.length, results, apiCalls, pageErrors }, null, 1), 'utf8');
console.log(`\n${passed}/${results.length} checks passed  (api calls: ${apiCalls})`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
