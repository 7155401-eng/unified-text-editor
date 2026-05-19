import fs from 'node:fs';

const TARGET = 'src/vilna_v9.js';

function patchFile(path) {
  const beforeRaw = fs.readFileSync(path, 'utf8');
  const before = beforeRaw.replace(/\r\n/g, "\n");

  // Important:
  // `_continues` is a generic pagination/layout marker. V9 uses it in several flows,
  // including first halves pulled into the current page by gap/rescue logic. Those
  // halves can still be real logical paragraph starts and must be allowed to receive
  // an opening word.
  //
  // Opening words should be blocked only by explicit V9 split-continuation markers:
  // `_v9ContinuesFromSplit` or `_v9OpeningWordAllowed === false`.
  //
  // This script also repairs a working tree where the older broad guard was already
  // applied, by reverting it back to the explicit V9-only condition.
  const broadGuard = 'continues: !!(p._continues || p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),';
  const explicitGuard = 'continues: !!(p._v9ContinuesFromSplit || p._v9OpeningWordAllowed === false),';

  if (before.includes(explicitGuard) && !before.includes(broadGuard)) {
    console.log(`[v9-continuation-opw-guard] explicit V9 guard already present in ${path}`);
    return;
  }

  if (!before.includes(broadGuard)) {
    throw new Error(`[v9-continuation-opw-guard] broad guard anchor not found in ${path}`);
  }

  const after = before.replace(broadGuard, explicitGuard);
  fs.writeFileSync(path, after);
  console.log(`[v9-continuation-opw-guard] restored explicit V9 guard in ${path}`);
}

patchFile(TARGET);
