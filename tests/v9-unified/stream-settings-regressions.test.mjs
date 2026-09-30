import test from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
globalThis.localStorage = {
  getItem: key => data.has(key) ? data.get(key) : null,
  setItem: (key, value) => data.set(String(key), String(value)),
  removeItem: key => data.delete(String(key)),
  clear: () => data.clear(),
  key: i => [...data.keys()][i] ?? null,
  get length(){ return data.size; },
};
globalThis.window = {
  __STREAM_SETTINGS__: {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  localStorage: globalThis.localStorage,
};
globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

const settingsMod = await import('../../src/original_stream_columns.js');
const noteMod = await import('../../src/engine/note_content_builder.js');
const { getStreamSettings, lemmaSplitIndex } = settingsMod;
const { buildNoteContentNodes } = noteMod;

function withStream01(patch, fn) {
  const settings = getStreamSettings();
  const saved = settings['01'];
  settings['01'] = { ...(saved || {}), ...patch };
  try { return fn(settings['01']); }
  finally {
    if (saved === undefined) delete settings['01'];
    else settings['01'] = saved;
  }
}

test('B41: terminal dot does not turn an entire short note into the bold lemma', () => {
  withStream01({ lemmaUntilDot:true, lemmaBold:true, noteNumEnabled:false, boldOverrideEnabled:false }, () => {
    const text = 'מילה שנייה.';
    assert.equal(lemmaSplitIndex('01', text), text.indexOf(' '));
    const nodes = buildNoteContentNodes('01', 1, text, [], { place:'note' });
    const lemma = nodes.find(n => n.kind === 'lemma');
    const rest = nodes.find(n => n.kind === 'rest');
    assert.equal(lemma?.text, 'מילה');
    assert.equal(lemma?.bold, true);
    assert.equal(rest?.text, ' שנייה.');
    assert(!nodes.some(n => n.kind === 'body' && n.bold === true),
      'whole note was incorrectly promoted to a bold body');
  });
});

test('lemma-until-dot still works when substantial body text follows the dot', () => {
  withStream01({ lemmaUntilDot:true, lemmaBold:true, noteNumEnabled:false, boldOverrideEnabled:false }, () => {
    const text = 'דיבור קצר. זהו גוף ארוך מספיק שממשיך אחרי הנקודה הראשונה בלי להסתיים מיד';
    const cut = lemmaSplitIndex('01', text);
    assert.equal(text.slice(0, cut), 'דיבור קצר.');
    const nodes = buildNoteContentNodes('01', 1, text, [], { place:'note' });
    assert.equal(nodes.find(n => n.kind === 'lemma')?.text, 'דיבור קצר.');
    assert(nodes.find(n => n.kind === 'rest')?.text.trim().length >= 12);
  });
});
