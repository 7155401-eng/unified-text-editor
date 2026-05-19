import fs from 'node:fs';

const TARGET = 'src/vilna_v9.js';

function patchFile(path) {
  const beforeRaw = fs.readFileSync(path, 'utf8');
  let source = beforeRaw.replace(/\r\n/g, "\n");

  // `_continues` is a generic pagination/layout marker. V9 uses it in several
  // flows, including first halves pulled into the current page by gap/rescue
  // logic. Those halves can still be real logical paragraph starts and must be
  // allowed to receive an opening word.
  //
  // Opening words should be blocked only by explicit V9 split-continuation
  // markers: `_v9ContinuesFromSplit`, `_v9OpeningWordAllowed === false`, or the
  // derived `entry.continues` field when it was created from those explicit
  // markers.
  //
  // This script also repairs a working tree where the older broad guard was
  // already applied, by reverting it back to explicit V9-only conditions.

  const replacements = [
    {
      label: 'aggregate mainParagraphs.continues',
      broad: 'continues: !!(p._continues || p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),',
      explicit: 'continues: !!(p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),',
    },
    {
      label: 'flowMainParagraphs continued check',
      broad: 'const continued = !!(entry.continues || entry._continues || entry._v9ContinuesFromSplit || entry._v9OpeningWordAllowed === false);',
      explicit: 'const continued = !!(entry.continues || entry._v9ContinuesFromSplit || entry._v9OpeningWordAllowed === false);',
    },
  ];

  let changed = false;

  for (const { label, broad, explicit } of replacements) {
    if (source.includes(broad)) {
      source = source.replace(broad, explicit);
      changed = true;
      console.log(`[v9-continuation-opw-guard] restored explicit V9 guard: ${label}`);
      continue;
    }

    if (source.includes(explicit)) {
      console.log(`[v9-continuation-opw-guard] explicit V9 guard already present: ${label}`);
      continue;
    }

    throw new Error(`[v9-continuation-opw-guard] anchor not found for ${label} in ${path}`);
  }

  if (changed) {
    fs.writeFileSync(path, source);
    console.log(`[v9-continuation-opw-guard] patched ${path}`);
  } else {
    console.log(`[v9-continuation-opw-guard] no changes needed for ${path}`);
  }
}

patchFile(TARGET);
