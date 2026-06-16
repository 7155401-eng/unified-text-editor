import { readFileSync, writeFileSync } from 'node:fs';

const file = 'worker/index.js';
const marker = 'legacy-docx-google-redirect-20260616';
const anchor = '    const url = new URL(request.url);\n';

const snippet = `
    // ${marker}: Google may still index this inactive legacy DOCX route; send it home.
    if (
      url.pathname === '/api/docx-google-' ||
      url.pathname === '/api/docx-google-/' ||
      url.pathname === '/api/docx-google' ||
      url.pathname === '/api/docx-google/'
    ) {
      const homeUrl = new URL('/', url.origin);
      return new Response(null, {
        status: 301,
        headers: {
          location: homeUrl.toString(),
          'cache-control': 'public, max-age=86400',
        },
      });
    }
`;

const source = readFileSync(file, 'utf8');
if (!source.includes(marker)) {
  if (!source.includes(anchor)) {
    throw new Error('legacy DOCX Google redirect patch anchor not found');
  }
  writeFileSync(file, source.replace(anchor, anchor + snippet), 'utf8');
}
