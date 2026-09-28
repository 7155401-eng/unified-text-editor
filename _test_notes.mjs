import { ensureDOMParser, _parseXml, findAll, _plain, getAttrW } from './src/word_extractor/word_extractor_engine.js';

const xml = \<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="1">
    <w:p>
      <w:r><w:t>@1 note text</w:t></w:r>
    </w:p>
  </w:footnote>
</w:footnotes>\;

async function run() {
  await ensureDOMParser();
  const root = _parseXml(xml);
  const notes = findAll(root, 'footnote');
  console.log('Notes found:', notes.length);
  for (const n of notes) {
    console.log('ID:', getAttrW(n, 'id'));
    console.log('Text:', _plain(n));
  }
}
run().catch(console.error);

