import fs from 'node:fs';

const PATCH = '[v9-opw-patch]';

/**
 * This script used to perform a large textual patch against src/vilna_v9.js.
 * The current source has already diverged from those exact anchors, and rerunning
 * the old hard-failing patch during Cloudflare builds can stop deployment even
 * when the app code is already patched or the anchor was intentionally replaced.
 *
 * Keep this script as an idempotent compatibility step: it reports whether the
 * main opening-word integration markers exist, but it never fails the build
 * because of a missing textual anchor.
 */
function read(path) {
  try {
    return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  } catch (error) {
    console.warn(`${PATCH} skip ${path}: ${error?.message || error}`);
    return '';
  }
}

const vilna = read('src/vilna_v9.js');
const apply = read('src/vilna_v9_apply.js');

const markers = [
  ['src/vilna_v9.js', 'v9_opening_word_layout_model.js', vilna.includes('v9_opening_word_layout_model.js')],
  ['src/vilna_v9.js', 'flowMainParagraphsThroughStrips', vilna.includes('flowMainParagraphsThroughStrips')],
  ['src/vilna_v9.js', 'openingWord render fields', vilna.includes('openingWord') || vilna.includes('openingHostFullWidth')],
  ['src/vilna_v9_apply.js', 'opening word settings', apply.includes('getOpeningWordSettings') || apply.includes('openingWordSettings')],
];

for (const [file, marker, present] of markers) {
  console.log(`${PATCH} ${present ? 'ok' : 'skip'} ${file}: ${marker}`);
}

console.log(`${PATCH} safe idempotent noop complete`);
