// Compare the shared renderer with native single-run font shaping. A matching
// outer line rectangle is insufficient: detached marks can have identical width.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const moduleURL = 'data:text/javascript;base64,' + fs.readFileSync('src/engine/runs_dom.js').toString('base64');
const results = [];
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport:{width:900,height:320},deviceScaleFactor:1});
  await page.setContent('<style>body{margin:0;background:white}.sample{position:absolute;left:20px;direction:rtl;font-size:20px;line-height:1.5;white-space:pre;color:black;font-feature-settings:"mark" 1,"mkmk" 1}#actual{top:20px}#expected{top:150px}</style><div class="sample" id="actual"></div><div class="sample" id="expected"></div>');
  for (const family of ['serif','sans-serif']) for (const text of ['ךְ','ןִ','ףָ','ץֵ','קֻ','שָּׁ','מֶלֶךְ']) {
    const name = `${family}: ${text}`;
    try {
      const diagnostic = await page.evaluate(async ({moduleURL,text,family}) => {
        const {appendTextWithRuns} = await import(moduleURL);
        const start = text === 'מֶלֶךְ' ? 4 : 0;
        const end = start+1;
        let clusterEnd = end;
        while (clusterEnd < text.length && /\p{M}/u.test(text[clusterEnd])) clusterEnd++;
        const actual = document.querySelector('#actual'), expected = document.querySelector('#expected');
        for (const el of [actual,expected]) {el.replaceChildren();el.style.fontFamily=family;}
        appendTextWithRuns(actual,text,[{start,end,marks:{fontFamily:family,fontSize:36}}]);
        expected.append(document.createTextNode(text.slice(0,start)));
        const reference = document.createElement('span');
        reference.style.fontFamily=family;reference.style.fontSize='36px';
        reference.textContent=text.slice(start,clusterEnd);
        expected.append(reference,document.createTextNode(text.slice(clusterEnd)));
        await document.fonts.ready;
        const styled = [...actual.children];
        return {sourcePreserved:actual.textContent===text,
          wholeCluster:styled.length===1&&styled[0].textContent===text.slice(start,clusterEnd),
          actualHTML:actual.innerHTML,expectedHTML:expected.innerHTML};
      },{moduleURL,text,family});
      assert.ok(diagnostic.sourcePreserved,`${name}: source changed`);
      assert.ok(diagnostic.wholeCluster,`${name}: mark detached from base`);
      const actual = await page.locator('#actual').screenshot({animations:'disabled',scale:'css'});
      const expected = await page.locator('#expected').screenshot({animations:'disabled',scale:'css'});
      assert.ok(actual.equals(expected),`${name}: glyph/mark pixels differ from native font anchors: ${JSON.stringify(diagnostic)}`);
      results.push({name,status:'pass'});
    } catch (error) {results.push({name,status:'fail',error:String(error)});}
  }
  const report={browserVersion:browser.version(),tests:results.length,passed:results.filter(r=>r.status==='pass').length,results};
  report.failed=report.tests-report.passed;
  fs.mkdirSync('test-results/v9-unified',{recursive:true});
  fs.writeFileSync('test-results/v9-unified/combining-marks.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.failed)process.exitCode=1;
} finally {await browser.close();}
