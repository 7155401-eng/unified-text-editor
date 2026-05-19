import fs from 'node:fs';

const TARGET = 'src/vilna_v9.js';

function patchFile(path) {
  const beforeRaw = fs.readFileSync(path, 'utf8');
  const before = beforeRaw.replace(/\r\n/g, "\n");

  // V9 has two continuation markers:
  // 1. _v9ContinuesFromSplit / _v9OpeningWordAllowed=false — created by the V9 split guard.
  // 2. _continues — created by generic page/paragraph continuation flow.
  //
  // Opening words must be blocked for both. If _continues is not copied into mainParagraphs.continues,
  // the opening-word model may treat a mid-paragraph cut as a new paragraph.
  const from = 'continues: !!(p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),';
  const to = 'continues: !!(p._continues || p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),';

  if (before.includes(to)) {
    console.log(`[v9-continuation-opw-guard] no changes needed for ${path}`);
    return;
  }

  if (!before.includes(from)) {
    throw new Error(`[v9-continuation-opw-guard] anchor not found in ${path}`);
  }

  const after = before.replace(from, to);
  fs.writeFileSync(path, after);
  console.log(`[v9-continuation-opw-guard] patched ${path}`);
}

patchFile(TARGET);
