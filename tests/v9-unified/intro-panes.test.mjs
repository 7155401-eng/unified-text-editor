import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const paneSource=fs.readFileSync(new URL('../../src/pane_manager.js',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../../src/engine_bridge.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../../src/main.js',import.meta.url),'utf8');

test('intro pane role is explicit, persistent, and excluded from main lookup',()=>{
  assert.match(paneSource,/this\.paneRole = streamCode \? "stream" : \(paneRole === "intro" \? "intro" : "main"\)/);
  assert.match(paneSource,/paneRole: this\.paneRole/);
  assert.match(paneSource,/paneRole: ps\.paneRole/);
  assert.match(paneSource,/getMainPane\(\)[\s\S]*?p\.paneRole === "main"/);
  assert.match(paneSource,/getIntroPanes\(\)[\s\S]*?p\.paneRole === "intro"/);
  assert.match(paneSource,/if \(pane\.paneRole === "main"\)/);
});

test('engine packs all introduction panes before the main pane',()=>{
  assert.match(bridge,/p\.paneRole \|\| \(p\.streamCode \? "stream" : "main"\)/);
  assert.match(bridge,/const introPanes =/);
  const introPos=bridge.indexOf('...introPanes.flatMap');
  const mainPos=bridge.indexOf('...extractMainParagraphs(mainPane');
  assert(introPos>=0&&mainPos>introPos,'intro paragraphs are not packed before main paragraphs');
  assert.match(bridge,/paneRole: info\.paneRole \|\| "main"/);
});

test('UI exposes a dedicated introduction-pane command',()=>{
  assert.match(html,/data-cmd="pane-add-intro"/);
  assert.match(main,/case "pane-add-intro"/);
  assert.match(main,/paneRole:\s*"intro"/);
  assert.match(main,/label: `הקדמה \$\{count \+ 1\}`/);
});
