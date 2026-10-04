import { buildPages } from '../../src/vilna_v9.js';

export async function runStreamLayoutPositionBrowserChecks(test,{assert,makePage}) {
  await test('single onkelos layoutPosition left reaches the actual left V9 side box', async()=>{
    const host=makePage();
    try {
      const mainText='אחד שניים שלוש ארבע חמש שש שבע שמונה תשע עשר';
      const noteText=Array(10).fill('אלפא בטא גמא דלתא הוז חטי').join(' ');
      const result=await buildPages(host,[{
        id:'layout-position-left-source',
        mainText,
        notes:[{stream:'01',num:1,text:noteText}],
      }],{
        pageWidth:380,
        pageHeight:420,
        padding:12,
        mainFontSize:13,
        sideFontSize:11,
        lineHeightRatio:1.55,
        mainFontFamily:'serif',
        sideFontFamily:'serif',
        talmudStreams:['01'],
        streamSettings:{
          '01':{layoutRole:'onkelos',layoutPosition:'left'},
        },
        crownLines:4,
        maxPages:10,
        openingWordSettings:{enabled:false},
      });
      assert(result.complete,'positioned onkelos fixture did not paginate completely');
      const leftRows=[...host.querySelectorAll('.v9-role-left')];
      const rightRows=[...host.querySelectorAll('.v9-role-right')];
      assert(leftRows.length>0,'positioned onkelos stream produced no left-side rows');
      assert(rightRows.length===0,
        `single left-positioned onkelos leaked ${rightRows.length} rows into the right side`);
      assert(leftRows.some(el=>(el.textContent||'').includes('אלפא')),
        'left-side rows do not contain the positioned onkelos source');
    } finally {
      host.remove();
    }
  });
}
