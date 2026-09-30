import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENING_WORD_DEFAULT_SIZE,
  STREAM_OPENING_WORD_DEFAULT_SIZE,
  getOpeningWordSettings,
  normalizeStreamOpeningWordSettings,
  openingWordSkipReason,
} from '../../src/opening_word.js';
import { buildV9OpeningWordLayoutModel } from '../../src/engine/v9_opening_word_layout_model.js';

test('opening-word default sizes have one source of truth without changing skip-policy defaults',()=>{
  assert.equal(OPENING_WORD_DEFAULT_SIZE,150);
  assert.equal(STREAM_OPENING_WORD_DEFAULT_SIZE,115);

  const globalDefaults=getOpeningWordSettings();
  assert.equal(globalDefaults.size,OPENING_WORD_DEFAULT_SIZE);
  assert.equal(globalDefaults.skipShortLine,false);
  assert.equal(globalDefaults.skipSingleLine,false);
  assert.equal(globalDefaults.skipFewerThanLines,false);

  const streamDefaults=normalizeStreamOpeningWordSettings({});
  assert.equal(streamDefaults.opwSize,STREAM_OPENING_WORD_DEFAULT_SIZE);

  assert.equal(
    openingWordSkipReason({}, {lineCount:1,complete:true,firstLineFill:0.2}),
    '',
    'smaller size defaults must not implicitly enable skip rules'
  );
});

test('V9 uses the shared global default and respects explicit user size',()=>{
  const base={enabled:true,target:'word',position:'dropped',dropLines:2};
  const auto=buildV9OpeningWordLayoutModel('alpha beta gamma',base,{
    baseFontSize:12,baseLineHeight:18,baseFontFamily:'serif',
    isParagraphStart:true,isOriginalParagraphStart:true,
  });
  assert(auto,'default-size V9 fixture produced no opening model');
  assert.equal(auto.style.fontSizePercent,OPENING_WORD_DEFAULT_SIZE);
  assert.equal(auto.style.fontSizePx,12*OPENING_WORD_DEFAULT_SIZE/100);

  const explicit=buildV9OpeningWordLayoutModel('alpha beta gamma',{...base,size:177},{
    baseFontSize:12,baseLineHeight:18,baseFontFamily:'serif',
    isParagraphStart:true,isOriginalParagraphStart:true,
  });
  assert(explicit,'explicit-size V9 fixture produced no opening model');
  assert.equal(explicit.style.fontSizePercent,177);
  assert.equal(explicit.style.fontSizePx,12*177/100);
});

test('stream opening-word explicit size still overrides the smaller default',()=>{
  assert.equal(normalizeStreamOpeningWordSettings({opwSize:181}).opwSize,181);
});
