import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Pane, PaneManager } from '../../src/pane_manager.js';

test('intro pane has a persistent explicit role and is not treated as main',()=>{
  const intro=new Pane({id:'intro-1',paneRole:'intro',label:'הקדמה 1'});
  const main=new Pane({id:'main-1',label:'ראשי'});
  assert.equal(intro.paneRole,'intro');
  assert.equal(main.paneRole,'main');
  assert.equal(intro.serialize().paneRole,'intro');

  const mgr=Object.create(PaneManager.prototype);
  mgr.panes=[intro,main];
  assert.equal(mgr.getMainPane(),main);
  assert.deepEqual(mgr.getIntroPanes(),[intro]);
});

test('pane load path persists paneRole and engine packs introductions before main',()=>{
  const paneSource=fs.readFileSync(new URL('../../src/pane_manager.js',import.meta.url),'utf8');
  const bridge=fs.readFileSync(new URL('../../src/engine_bridge.js',import.meta.url),'utf8');
  assert.match(paneSource,/paneRole:\s*ps\.paneRole/);
  assert.match(bridge,/const introPanes =/);
  const introPos=bridge.indexOf('...introPanes.flatMap');
  const mainPos=bridge.indexOf('...extractMainParagraphs(mainPane');
  assert(introPos>=0&&mainPos>introPos,'intro paragraphs are not packed before main paragraphs');
  assert.match(bridge,/paneRole:\s*info\.paneRole \|\| "main"/);
});

test('UI exposes a dedicated introduction-pane command',()=>{
  const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
  const main=fs.readFileSync(new URL('../../src/main.js',import.meta.url),'utf8');
  assert.match(html,/data-cmd="pane-add-intro"/);
  assert.match(main,/case "pane-add-intro"/);
  assert.match(main,/paneRole:\s*"intro"/);
});
