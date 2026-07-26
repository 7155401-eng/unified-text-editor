
import app from './index_tidio_ai_debug_v5.js';

const PATHS = new Set(['/diagnostics', '/diagnostics/', '/diagnostics/index.html']);

const HTML = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>בדיקות AI</title>
<style>
body{margin:0;background:#f4f7fb;color:#172033;font-family:Arial,"Segoe UI",sans-serif;line-height:1.55}
main{max-width:920px;margin:auto;padding:16px}.box{background:white;border:1px solid #d9e2ef;border-radius:14px;padding:16px;margin:12px 0;box-shadow:0 6px 18px #0001}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
button,label{display:inline-block;border:0;border-radius:10px;padding:10px 14px;margin:4px;background:#1f4fd8;color:white;font-weight:700;cursor:pointer}
button.alt{background:#e9edf5;color:#172033}.st{display:inline-block;padding:4px 10px;border-radius:999px;background:#eef2ff;color:#667085;font-weight:700}.ok{background:#e8f7ee;color:#126b36}.bad{background:#fdecec;color:#9b1c1c}.warn{background:#fff4df;color:#965a00}
pre{direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-word;background:#eef2ff;border:1px solid #d9e2ef;border-radius:12px;padding:12px;max-height:520px;overflow:auto}input[type=file]{display:none}.muted{color:#667085}
</style></head><body><main>
<div class="box"><h1>בדיקות AI ללא Console</h1><p>פתח את העמוד כשאתה מחובר לאתר. המפתח המלא לא מוצג בתוצאות.</p><button id="all">הרץ בדיקות 1-3</button><button id="copy" class="alt">העתק תוצאות</button><button id="down" class="alt">הורד JSON</button><button id="clear" class="alt">נקה</button></div>
<div class="grid">
<div class="box"><h2>1. דפדפן</h2><p>בודק אם המפתח שמור בדפדפן.</p><button data-r="1">הפעל 1</button> <span id="s1" class="st">טרם הורץ</span></div>
<div class="box"><h2>2. מפתח Gemini</h2><p>בודק את המפתח מול Gemini בלי קובץ.</p><button data-r="2">הפעל 2</button> <span id="s2" class="st">טרם הורץ</span></div>
<div class="box"><h2>3. שרת בלי קובץ</h2><p>בודק את /api/ai-tools/gas בקריאה קטנה.</p><button data-r="3">הפעל 3</button> <span id="s3" class="st">טרם הורץ</span></div>
<div class="box"><h2>4. קובץ</h2><p>בחר קובץ קטן לבדיקה.</p><label for="f">בחר קובץ והפעל 4</label><input id="f" type="file" accept="audio/*,image/*,.pdf"><div id="fn" class="muted"></div><span id="s4" class="st">טרם הורץ</span></div>
</div>
<div class="box"><h2>תוצאות לשליחה</h2><pre id="out">אין תוצאות עדיין.</pre></div>
</main><script>
(()=>{const V='20260726-ui07',K='ravtext.torah_transcription.config',S={version:V,page:location.href,started_at:new Date().toISOString(),results:{}};$=id=>document.getElementById(id);
const jj=x=>{try{return JSON.parse(x||'{}')||{}}catch(e){return{}}},cl=x=>String(x??'').replace(/[\\u200B-\\u200D\\uFEFF]/g,'').trim().replace(/\\s+/g,'');
const red=x=>String(x??'').replace(/key=([^&\\s"'<>]+)/gi,'key=[redacted]').replace(/AIza[0-9A-Za-z_\\-]{20,}/g,'[redacted-google-key]').replace(/sk-ant-[0-9A-Za-z_\\-]{20,}/g,'[redacted-anthropic-key]').replace(/sk_[0-9A-Za-z_\\-]{20,}/g,'[redacted-elevenlabs-key]').replace(/Bearer\\s+[0-9A-Za-z._\\-]{20,}/gi,'Bearer [redacted]');
function safe(v,d=0){if(v==null||typeof v=='number'||typeof v=='boolean')return v;if(typeof v=='string')return red(v);if(d>6)return'[deep]';if(Array.isArray(v))return v.slice(0,80).map(a=>safe(a,d+1));let o={};for(const[k,x]of Object.entries(v)){if(/api[_-]?key|access[_-]?code|token|secret|password|authorization/i.test(k))o[k]=x?`[redacted ${String(x).length} chars]`:'';else if(/content[_-]?base64|base64|blob/i.test(k))o[k]=x?`[omitted ${String(x).length} chars]`:'';else o[k]=safe(x,d+1)}return o}
const cfg=()=>jj(localStorage.getItem(K)),model=c=>String(c.model||'gemini-3.1-pro-preview'),gkey=c=>cl(c.gemini_api_key||'');
function kinfo(n,v,p){let r=String(v??''),c=cl(r);return{label:n,has_key:!!c,raw_chars:r.length,cleaned_chars:c.length,removed_chars:r.length-c.length,prefix_hint:!c?'missing':(c.startsWith(p)?n+'_prefix_ok':n+'_prefix_unexpected')}}
function st(i,r){if(!r)return['st','טרם הורץ'];if(r.error||r.original_error||(r.http_status&&(r.http_status<200||r.http_status>=300)))return['st bad','נכשל: '+(r.possible_cause||r.error||r.original_error||r.http_status)];if(i=='1')return r.config_summary?.gemini?.has_key?['st ok','נמצא מפתח Gemini']:['st bad','לא נמצא מפתח Gemini'];if(i=='2')return r.key_valid===false?['st bad','המפתח נדחה']:(r.key_valid===true?['st ok','המפתח עבר בדיקה']:['st warn','לא הושלם']);return['st ok','עבר']}
function render(){for(const i of['1','2','3','4']){let[a,b]=st(i,S.results[i]),e=$('s'+i);e.className=a;e.textContent=b}$('out').textContent=JSON.stringify(safe({timestamp:new Date().toISOString(),user_agent:navigator.userAgent,...S}),null,2)}
async function read(f){return new Promise((ok,no)=>{let r=new FileReader;r.onerror=()=>no(r.error||Error('file_read_failed'));r.onload=()=>ok(String(r.result||'').split(',')[1]||'');r.readAsDataURL(f)})}
function kind(f){let t=String(f.type||'').toLowerCase(),n=String(f.name||'').toLowerCase();if(t.startsWith('audio/')||/\\.(mp3|wav|m4a|ogg|webm|flac)$/i.test(n))return'audio';if(t.startsWith('image/')||/\\.(png|jpg|jpeg|webp)$/i.test(n))return'image';if(t=='application/pdf'||/\\.pdf$/i.test(n))return'pdf';return'unknown'}
async function one(){let c=cfg();return{diagnostic:'01-client-config',version:V,config_found:!!localStorage.getItem(K),auth:{has_auth_object:!!window.__RAVTEXT_AUTH__,paid:!!window.__RAVTEXT_AUTH__?.paid,balance_seconds:Number(window.__RAVTEXT_AUTH__?.balanceSeconds||window.__RAVTEXT_AUTH__?.balance_seconds||0)},config_summary:{model:model(c),use_premium:c.use_premium===true,has_access_code:!!c.access_code,gemini:kinfo('gemini',c.gemini_api_key,'AIza'),claude:kinfo('claude',c.claude_api_key,'sk-ant-'),elevenlabs:kinfo('elevenlabs',c.elevenlabs_api_key,'sk_')}}}
async function post(url,body,type='application/json'){let t=performance.now(),r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'content-type':type},body:JSON.stringify(body)}),d=await r.json().catch(async()=>({error:'non_json_response',raw:await r.text()}));return{http_status:r.status,response_debug_id_header:r.headers.get('x-ravtext-debug-id'),duration_ms:Math.round(performance.now()-t),...d}}
async function two(){let c=cfg();return{diagnostic:'02-gemini-key-isolated',version:V,...await post('/api/ai-tools/diagnose-key',{provider:'gemini',model:model(c),api_key:gkey(c)})}}
async function three(){let c=cfg();return{diagnostic:'03-gas-minimal',version:V,...await post('/api/ai-tools/gas',{diagnostic:true,diagnostic_name:'03-gas-minimal',prompt_type:'printed',model:model(c),api_key:gkey(c),text:'Diagnostic ping. Return only: OK',custom_prompt:'Return only the word OK.'},'text/plain;charset=utf-8')}}
async function four(f){if(!f)return{diagnostic:'04-file-flow',error:'no_file_selected'};let c=cfg(),k=kind(f),b=await read(f);return{diagnostic:'04-file-flow',version:V,file_summary:{name:f.name,mime:f.type,size:f.size,detected_kind:k,base64_chars:b.length},...await post('/api/ai-tools/gas',{diagnostic:true,diagnostic_name:'04-file-flow',prompt_type:k=='audio'?'audio_regular':'printed',model:model(c),api_key:gkey(c),files:[{name:f.name,type:k,mime:f.type||'application/octet-stream',content_base64:b}],text:k=='audio'?'':'Diagnostic file flow.',custom_prompt:'Return a short technical confirmation.'},'text/plain;charset=utf-8')}}
async function run(i,f=null){$('s'+i).className='st';$('s'+i).textContent='מריץ...';try{S.results[i]=i=='1'?await one():i=='2'?await two():i=='3'?await three():await four(f);S.results[i].finished_at=new Date().toISOString()}catch(e){S.results[i]={diagnostic:i+'-client-error',error:'client_run_failed',message:e?.message||String(e),stack:e?.stack||'',finished_at:new Date().toISOString()}}render()}
document.addEventListener('click',e=>{let b=e.target.closest('button[data-r]');if(b)run(b.dataset.r)});
$('f').onchange=e=>{let f=e.target.files&&e.target.files[0];$('fn').textContent=f?`${f.name} (${Math.round(f.size/1024)} KB)`:'';if(f)run('4',f)};
$('all').onclick=async()=>{ $('all').disabled=true; try{await run('1');await run('2');await run('3')}finally{$('all').disabled=false}};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('out').textContent);alert('התוצאות הועתקו')}catch(e){alert('לא הצלחתי להעתיק. נא להעתיק ידנית מהתיבה.')}};
$('down').onclick=()=>{let u=URL.createObjectURL(new Blob([$('out').textContent],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download='ravtext-diagnostics.json';a.click();URL.revokeObjectURL(u)};
$('clear').onclick=()=>{S.results={};render()};render();
})();
</script></body></html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (PATHS.has(url.pathname)) {
      return new Response(HTML, {
        status: 200,
        headers: {
          'content-type': 'text/html;charset=utf-8',
          'cache-control': 'no-store',
          'x-ravtext-diagnostics-page-version': '20260726-ui07'
        }
      });
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
