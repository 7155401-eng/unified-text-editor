// Compare the shared renderer with native single-run font shaping. A matching
// outer line rectangle is insufficient: detached marks can have identical width.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';

const moduleURL = 'data:text/javascript;base64,' + fs.readFileSync('src/engine/runs_dom.js').toString('base64');
const results = [];
const specimenRows = [];
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport:{width:1500,height:1200},deviceScaleFactor:1});
  await page.setContent('<style>body{margin:0;background:white}.sample{position:absolute;left:20px;direction:rtl;font-size:20px;line-height:1.5;white-space:pre;color:black;font-feature-settings:"mark" 1,"mkmk" 1}#actual{top:20px}#expected{top:150px}#specimen{position:relative;margin:20px;direction:rtl;font-family:serif;color:#111}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.cell{border:1px solid #bbb;padding:10px;min-height:120px;text-align:center}.n{font:700 15px/1 sans-serif;direction:ltr}.g{font-size:42px;line-height:1.45}.meta{font:12px/1.3 sans-serif;direction:ltr}</style><div class="sample" id="actual"></div><div class="sample" id="expected"></div><div id="specimen"></div>');

  const cases=[
    {text:'ךְ',target:true},{text:'ךִ',target:true},{text:'ךֶ',target:true},{text:'ךַ',target:true},{text:'ךָ',target:true},
    {text:'קְ',target:true},{text:'קִ',target:true},{text:'קֶ',target:true},{text:'קַ',target:true},{text:'קָ',target:true},
    {text:'ןִ',target:false},{text:'ףָ',target:false},{text:'ץֵ',target:false},{text:'כָ',target:false},{text:'שָּׁ',target:false},
    {text:'ךֹ',target:false},{text:'קֹ',target:false},{text:'ךָּ',target:false},
  ];
  for (const family of ['serif','sans-serif','monospace']) for (const item of cases) {
    const name = `${family}: ${item.text}`;
    try {
      const diagnostic = await page.evaluate(async ({moduleURL,text,family,target}) => {
        const {appendTextWithRuns,opticalNiqqudProfileForCluster} = await import(moduleURL);
        const actual = document.querySelector('#actual'), expected = document.querySelector('#expected');
        for (const el of [actual,expected]) {el.replaceChildren();el.style.fontFamily=family;}
        appendTextWithRuns(actual,text,[]);
        expected.textContent=text;
        await document.fonts.ready;
        const wrapper=actual.querySelector('.rt-optical-niqqud');
        const mark=actual.querySelector('.rt-optical-niqqud-mark');
        const ar=actual.getBoundingClientRect(),er=expected.getBoundingClientRect();
        const wr=wrapper?.getBoundingClientRect(),mr=mark?.getBoundingClientRect();
        return {
          target, sourcePreserved:actual.textContent===text,
          profile:opticalNiqqudProfileForCluster(text),
          wrapperCount:actual.querySelectorAll('.rt-optical-niqqud').length,
          actualHTML:actual.innerHTML, expectedHTML:expected.innerHTML,
          widthDelta:Math.abs(ar.width-er.width),
          wrapper:wr?{left:wr.left,right:wr.right,top:wr.top,bottom:wr.bottom,width:wr.width,height:wr.height}:null,
          mark:mr?{left:mr.left,right:mr.right,top:mr.top,bottom:mr.bottom,width:mr.width,height:mr.height}:null,
          normalizeEm:wrapper?Number(wrapper.dataset.opticalNiqqudNormalizeEm||0):0,
        };
      },{moduleURL,text:item.text,family,target:item.target});
      assert.ok(diagnostic.sourcePreserved,`${name}: source changed`);
      assert.ok(diagnostic.widthDelta<=0.75,`${name}: optical placement changed advance width by ${diagnostic.widthDelta}`);
      const actualShot = await page.locator('#actual').screenshot({animations:'disabled',scale:'css'});
      const expectedShot = await page.locator('#expected').screenshot({animations:'disabled',scale:'css'});
      if(item.target){
        assert.equal(diagnostic.wrapperCount,1,`${name}: optical wrapper missing`);
        assert.ok(diagnostic.profile,`${name}: target profile missing`);
        assert.ok(!actualShot.equals(expectedShot),`${name}: target still matches native low placement`);
        assert.ok(diagnostic.wrapper&&diagnostic.mark,`${name}: missing measured optical mark`);
        const wc=(diagnostic.wrapper.left+diagnostic.wrapper.right)/2;
        const mc=(diagnostic.mark.left+diagnostic.mark.right)/2;
        if(item.text.startsWith('ך')) assert.ok(mc < wc,`${name}: final-kaf mark did not move into left free pocket`);
        if(item.text.startsWith('ק')) assert.ok(mc > wc,`${name}: qof mark did not move into right free pocket`);
        assert.ok(diagnostic.mark.bottom <= diagnostic.wrapper.bottom + 1,`${name}: lower mark still hangs below the cluster box`);
      }else{
        assert.equal(diagnostic.wrapperCount,0,`${name}: control letter was optically rewritten`);
        assert.ok(actualShot.equals(expectedShot),`${name}: non-target glyph pixels differ from native font anchors`);
      }
      results.push({name,status:'pass',...diagnostic});
    } catch (error) {results.push({name,status:'fail',error:String(error)});}
  }

  // The user's correction is specifically uniformity: patah must move down
  // and qamats up until both share one target. Check the automatic compensation
  // signs in every tested font; no per-mark target table is allowed.
  for(const family of ['serif','sans-serif','monospace']){
    const patah=results.find(r=>r.status==='pass'&&r.name===`${family}: ךַ`);
    const qamats=results.find(r=>r.status==='pass'&&r.name===`${family}: ךָ`);
    assert(patah&&qamats,`${family}: missing final-kaf patah/qamats results`);
    assert(patah.normalizeEm>0,`${family}: patah was not lowered toward the common target`);
    assert(qamats.normalizeEm<0,`${family}: qamats was not raised toward the common target`);
    const p2=results.find(r=>r.status==='pass'&&r.name===`${family}: קַ`);
    const q2=results.find(r=>r.status==='pass'&&r.name===`${family}: קָ`);
    assert(p2&&q2,`${family}: missing qof patah/qamats results`);
    assert(p2.normalizeEm>0,`${family}: qof patah was not lowered toward the common target`);
    assert(q2.normalizeEm<0,`${family}: qof qamats was not raised toward the common target`);
  }

  // Numbered specimen sheet across font families and sizes. This is evidence,
  // not an oracle: assertions above decide correctness.
  const specimen = await page.evaluate(async ({moduleURL}) => {
    const {appendTextWithRuns}=await import(moduleURL);
    const root=document.querySelector('#specimen'); root.replaceChildren();
    const title=document.createElement('h2');title.textContent='Optical Hebrew niqqud proof — final kaf / qof';root.append(title);
    const grid=document.createElement('div');grid.className='grid';root.append(grid);
    let n=1;
    for(const family of ['serif','sans-serif','monospace','David Libre, serif','Frank Ruhl Libre, serif'])
      for(const size of [26,38])
        for(const text of ['ךְ','ךִ','ךֶ','ךַ','ךָ','קְ','קִ','קֶ','קַ','קָ']){
          const cell=document.createElement('div');cell.className='cell';
          const no=document.createElement('div');no.className='n';no.textContent=String(n++);
          const glyph=document.createElement('div');glyph.className='g';glyph.style.fontFamily=family;glyph.style.fontSize=size+'px';
          appendTextWithRuns(glyph,text,[]);
          const meta=document.createElement('div');meta.className='meta';meta.textContent=`${family} / ${size}px / ${text}`;
          cell.append(no,glyph,meta);grid.append(cell);
        }
    await document.fonts.ready;
    return {count:n-1};
  },{moduleURL});
  const specimenImage=await page.locator('#specimen').screenshot({animations:'disabled',scale:'css'});
  fs.mkdirSync('test-results/v9-unified',{recursive:true});
  fs.writeFileSync('test-results/v9-unified/optical-niqqud-specimen.png',specimenImage);

  const report={browserVersion:browser.version(),tests:results.length,passed:results.filter(r=>r.status==='pass').length,
    failed:results.filter(r=>r.status==='fail').length,specimen,results};
  fs.writeFileSync('test-results/v9-unified/combining-marks.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({tests:report.tests,passed:report.passed,failed:report.failed,specimen:report.specimen},null,2));
  if(report.failed)process.exitCode=1;
} finally {await browser.close();}
