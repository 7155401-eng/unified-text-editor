import * as currentPage from '../../src/vilna_v9.js';
import * as currentSettings from '../../src/original_stream_columns.js';

export async function runExactParagraphPaginationChecks(baselinePage,baselineSettings){
 const records=[],words=['אב','גד','הוז','חטיכ','למנ','סעפ','צקר'];const textOf=n=>Array.from({length:n},(_,i)=>words[i%words.length]).join(' ');
 const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
 const source=node=>{const copy=node.cloneNode(true);copy.querySelectorAll('[data-v9-main-ref]').forEach(n=>n.remove());return copy.textContent};
 for(const family of ['serif','sans-serif','monospace'])for(const opening of [false,true])for(const annotated of [false,true]){
  const name=`${family}/${opening}/${annotated}`;
  const input=[{id:'a',mainText:'פתיח '+textOf(22),notes:[]},{id:'b',mainText:'פתיח '+textOf(110),notes:[]},{id:'c',mainText:'פתיח '+textOf(14),notes:[]}];
  if(annotated)for(const [i,p]of input.entries())p.notes=[{stream:'03',num:i+1,uid:'n'+i,anchor:8,anchorAffinity:'backward',text:textOf(4)}];
  const cfg={pageWidth:380,pageHeight:240,padding:12,reservedBottom:15,mainFontSize:13,sideFontSize:10,lineHeightRatio:1.55,mainFontFamily:family,sideFontFamily:family,crownLines:4,mainGap:8,streamHorizontalGap:8,talmudStreams:['01','02'],levels:[['03']],mishnaWrapOn:false,maxPages:30,openingWordSettings:{enabled:opening,target:'word',count:1,font:'inherit',size:150,weight:'bold',position:'dropped',dropLines:2,spaceAfter:.3,scope:'all',skipHeadings:false,skipShortLine:false,skipSingleLine:false,skipFewerThanLines:false},streamSettings:{}};
  const snapshot=JSON.stringify({input,cfg}),outputs=[];
  try{
   for(const [version,api]of [['old',{v:baselinePage,s:baselineSettings}],['now',{v:currentPage,s:currentSettings}]]){
    const settings=api.s.getStreamSettings(),saved=settings['03'];settings['03']={mainRefEnabled:true,noteNumEnabled:false,lemmaBold:false,titleShow:false};
    const host=document.createElement('div');document.body.append(host);
    try{
     const result=await api.v.buildPages(host,input,cfg);assert(result.complete,'pagination incomplete');
     assert(!(result.noteAnchorFallbacks||[]).length,'anchor fallback');
     for(const paragraph of input){
      const rows=[...host.querySelectorAll('[data-v9-paragraph-id]')].filter(n=>n.dataset.v9ParagraphId===paragraph.id);
      assert(rows.map(source).join('')===paragraph.mainText,'paragraph text lost or duplicated');
     }
     const placedNotes=[];
     if(annotated)for(const paragraph of input){for(const note of paragraph.notes){
      const key=`${paragraph.id}:${note.stream}:${note.uid}`;
      const ref=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-main-ref]')].some(n=>n.dataset.uid===note.uid));
      const start=result.pages.findIndex(p=>[...p.querySelectorAll('[data-v9-note-start]')].some(n=>n.dataset.v9NoteStart===key));
      assert(ref>=0&&ref===start,'note and source anchor started on different pages');
      const owned=[...host.querySelectorAll('[data-v9-note-key]')].filter(n=>n.dataset.v9NoteKey===key);
      assert(owned.map(source).join('')===note.text,'individual note text lost or duplicated');
      placedNotes.push({uid:note.uid,page:ref+1});
     }}
     let collisions=0;
     for(const page of result.pages){
      const lines=[...page.querySelectorAll('.v9-final-main-line,.v9-final-stream-line')].map(n=>({x:parseFloat(n.style.left),y:parseFloat(n.style.top),w:parseFloat(n.style.width),h:parseFloat(n.style.height)}));
      for(let i=0;i<lines.length;i++){
       const a=lines[i];assert(a.y+a.h<=213+.02,'line below page');
       for(let j=i+1;j<lines.length;j++){const b=lines[j];if(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.05&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.05)collisions++;}
      }
     }
     assert(collisions===0,'overlapping row boxes');outputs.push({version,pages:result.pages.length,placedNotes,collisions,sourceExact:true});
    }finally{host.remove();if(saved===undefined)delete settings['03'];else settings['03']=saved;}
   }
   assert(JSON.stringify({input,cfg})===snapshot,'input was mutated');records.push({name,pass:true,outputs});
  }catch(error){records.push({name,pass:false,error:String(error),outputs})}
 }
 return{total:records.length,passed:records.filter(r=>r.pass).length,failed:records.filter(r=>!r.pass).length,records};
}
