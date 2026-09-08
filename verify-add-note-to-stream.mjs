// Unit test for the server-side "add a footnote to a stream" action.
// The API is not reachable from the local dev server, so the worker function is
// exercised directly - same code path the deployed worker runs.
import { handleMainTextTools } from './worker/main_text_tools.js';

const call = async (body) => {
  const res = await handleMainTextTools({ method: 'POST', json: async () => body });
  return { status: res.status, body: await res.json() };
};

const results = [];
const check = (name, cond, detail) => {
  results.push({ name, pass: !!cond, detail });
};

// Two existing notes in stream 01, and a main text with two @01 markers.
const streamText = '@01 [1] AAA\n— —\n@01 [2] BBB';
const mainText = 'one @01 two @01 three four';
const caretAtEnd = mainText.length;

// 1. inserted after both markers -> becomes note 3
{
  const { status, body } = await call({
    action: 'add_note_to_stream', mainText, streamText, code: '01',
    noteText: 'CCC', caretIndex: caretAtEnd,
  });
  check('appends as note 3', status === 200 && body.ordinal === 3, `status=${status} ordinal=${body.ordinal}`);
  check('note count is 3', body.noteCount === 3, `noteCount=${body.noteCount}`);
  check('marker landed at the caret', body.mainText === mainText + '@01', body.mainText);
  check('existing notes kept their order', /\[1\] AAA[\s\S]*\[2\] BBB[\s\S]*\[3\] CCC/.test(body.streamText), body.streamText);
}

// 2. inserted before every marker -> becomes note 1 and the others renumber
{
  const { status, body } = await call({
    action: 'add_note_to_stream', mainText, streamText, code: '01',
    noteText: 'ZZZ', caretIndex: 0,
  });
  check('prepends as note 1', status === 200 && body.ordinal === 1, `ordinal=${body.ordinal}`);
  check('older notes renumbered', /\[1\] ZZZ[\s\S]*\[2\] AAA[\s\S]*\[3\] BBB/.test(body.streamText), body.streamText);
  check('marker at position 0', body.mainText.startsWith('@01one'), body.mainText.slice(0, 12));
}

// 3. inserted between the two markers -> becomes note 2
{
  const at = mainText.indexOf('two') + 3;
  const { body } = await call({
    action: 'add_note_to_stream', mainText, streamText, code: '01',
    noteText: 'MID', caretIndex: at,
  });
  check('middle insert becomes note 2', body.ordinal === 2, `ordinal=${body.ordinal}`);
  check('order is AAA, MID, BBB', /\[1\] AAA[\s\S]*\[2\] MID[\s\S]*\[3\] BBB/.test(body.streamText), body.streamText);
}

// 4. a marker of a DIFFERENT stream must not affect the ordinal
{
  const mixed = 'a @02 b @01 c @02 d';
  const { body } = await call({
    action: 'add_note_to_stream', mainText: mixed, streamText, code: '01',
    noteText: 'AFTER', caretIndex: mixed.length,
  });
  check('other streams ignored when counting', body.ordinal === 2, `ordinal=${body.ordinal}`);
}

// 5. @1 and @01 count as the same stream
{
  const short = 'x @1 y';
  const { body } = await call({
    action: 'add_note_to_stream', mainText: short, streamText: '', code: '01',
    noteText: 'ONE', caretIndex: short.length,
  });
  // the stream holds no notes yet, so the new note can only be note 1 - we do
  // not invent empty notes to close the gap; we report the gap instead.
  check('@1 counts as stream 01', body.markerOrdinal === 2, `markerOrdinal=${body.markerOrdinal}`);
  check('note lands as 1 and the gap is reported', body.ordinal === 1 && body.inSync === false, `ordinal=${body.ordinal} inSync=${body.inSync}`);
}

// 6. an empty stream accepts the first note
{
  const { body } = await call({
    action: 'add_note_to_stream', mainText: 'plain text', streamText: '', code: '03',
    noteText: 'FIRST', caretIndex: 5,
  });
  check('first note into an empty stream', body.ordinal === 1 && /\[1\] FIRST/.test(body.streamText), body.streamText);
}

// 7. refusals
{
  const empty = await call({ action: 'add_note_to_stream', mainText, streamText, code: '01', noteText: '   ', caretIndex: 0 });
  check('empty note refused with 400', empty.status === 400 && empty.body.error === 'empty_note', `status=${empty.status}`);

  const badCode = await call({ action: 'add_note_to_stream', mainText, streamText, code: 'abc', noteText: 'x', caretIndex: 0 });
  check('bad stream code refused with 400', badCode.status === 400 && badCode.body.error === 'bad_stream', `status=${badCode.status}`);

  const tooLong = await call({ action: 'add_note_to_stream', mainText, streamText, code: '01', noteText: 'x'.repeat(20001), caretIndex: 0 });
  check('over-long note refused with 400', tooLong.status === 400 && tooLong.body.error === 'note_too_long', `status=${tooLong.status}`);
}

// 8. a caret past the end is clamped, not an error
{
  const { status, body } = await call({
    action: 'add_note_to_stream', mainText, streamText, code: '01',
    noteText: 'CLAMP', caretIndex: 999999,
  });
  check('out-of-range caret is clamped', status === 200 && body.mainText.endsWith('@01'), body.mainText.slice(-8));
}

// 9. nothing is lost: every original note survives
{
  const { body } = await call({
    action: 'add_note_to_stream', mainText, streamText, code: '01',
    noteText: 'NEW', caretIndex: caretAtEnd,
  });
  check('no content lost', body.streamText.includes('AAA') && body.streamText.includes('BBB') && body.streamText.includes('NEW'), body.streamText);
}

const passed = results.filter((r) => r.pass).length;
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  <- ' + r.detail}`);
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
