import{getUserFromRequest}from'./session.js';
import{
  ensureGiftMinuteUsageSchema,
  expireAllGiftBalances,
  expireUserGiftBalance,
  giftMonthKey,
  recordCurrentGiftUsage,
}from'./gift_expiry.js';
const GIFT_MINUTES_PER_MONTH=20,GIFT_SECONDS_PER_MONTH=GIFT_MINUTES_PER_MONTH*60,MAX_USAGE_TICK_SECONDS=60,UNPAID_STATUS='unauthorized';
const j=(o,i={})=>new Response(JSON.stringify(o,(_k,v)=>typeof v==='bigint'?Number(v):v),{status:i.status||200,headers:{'content-type':'application/json','cache-control':'no-store',...(i.headers||{})}});
const e=(m,s=400,x={})=>j({error:m,...x},{status:s});
const em=x=>x?.message||String(x||'unknown_error');
const read=async r=>{try{return await r.json()}catch{return{}}};
const now=()=>Math.floor(Date.now()/1000);
const pos=v=>{const n=Number(v||0);return Number.isFinite(n)&&n>0?Math.floor(n):0};
const storedExp=(r,n=now())=>{const x=Number(r?.expires_at||0);return Number.isFinite(x)&&x>0?Math.max(Math.floor(x),n):n};
const sub=(r,n=now())=>r?.status==='active'&&r?.plan_type==='subscription'&&(!r?.expires_at||Number(r.expires_at)>=n);
const vis=(r,n=now())=>sub(r,n)&&r?.expires_at?Number(r.expires_at)*1000:null;
const row=async(env,id)=>await env.DB.prepare('SELECT id, email, status, expires_at, is_admin, plan_type, balance_seconds FROM users WHERE id = ?').bind(id).first();
async function user(req,env){const u=await getUserFromRequest(req,env);return u?{user:u}:{error:e('login_required',401)}}
async function admin(req,env){const u=await getUserFromRequest(req,env);if(!u)return{error:e('Not logged in',401)};if(!u.is_admin)return{error:e('Forbidden',403)};return{user:u}}
async function setState(env,id,b,r,n=now()){const keep=sub(r,n),st=keep||b>0?'active':UNPAID_STATUS,pt=keep?'subscription':(b>0?'hours':null),ex=storedExp(r,n);await env.DB.prepare('UPDATE users SET balance_seconds = ?, status = ?, plan_type = ?, expires_at = ? WHERE id = ?').bind(b,st,pt,ex,id).run();return{nextStatus:st,nextPlanType:pt,nextExpiresAt:ex}}
export async function handlePaymentStatus(req,env){const u=await getUserFromRequest(req,env);if(!u)return j({paid:false,planType:null,expiresAt:null,balanceSeconds:0});const r=await row(env,u.id),n=now(),b=pos(r?.balance_seconds),sa=sub(r,n),ma=r?.status==='active'&&b>0,legacy=r?.status==='active'&&r?.plan_type!=='hours'&&r?.plan_type!=='subscription'&&(!r?.expires_at||Number(r.expires_at)>=n),paid=sa||ma||legacy;if(!paid&&r?.status==='active'&&b<=0&&!sa)await setState(env,u.id,0,r,n).catch(()=>null);return j({paid,planType:ma&&!sa?'hours':(r?.plan_type||null),expiresAt:vis(r,n),balanceSeconds:b,email:u.email})}
export async function handleUsageTick(req,env){if(req.method!=='POST')return e('method_not_allowed',405);const a=await user(req,env);if(a.error)return a.error;const body=await read(req),seconds=Math.max(1,Math.min(MAX_USAGE_TICK_SECONDS,Math.round(Number(body?.seconds)||MAX_USAGE_TICK_SECONDS))),r=await row(env,a.user.id);if(!r)return e('user_not_found',404);const n=now(),b=pos(r.balance_seconds);if(sub(r,n))return j({ok:true,consumedSeconds:0,balanceSeconds:b,paid:true,expiresAt:vis(r,n)});if(b<=0||r.status!=='active'){await setState(env,a.user.id,0,r,n).catch(()=>null);return j({ok:true,consumedSeconds:0,balanceSeconds:0,paid:false,expired:true})}const used=Math.min(seconds,b),next=Math.max(0,b-used);await setState(env,a.user.id,next,r,n);const giftUsedRecorded=await recordCurrentGiftUsage(env,a.user.id,used).catch(()=>0);return j({ok:true,consumedSeconds:used,giftUsedRecorded,balanceSeconds:next,paid:next>0,expired:next<=0})}
export async function handleGiftClaim(req,env){if(req.method!=='POST')return e('method_not_allowed',405);try{const a=await user(req,env);if(a.error)return a.error;await ensureGiftMinuteUsageSchema(env,GIFT_SECONDS_PER_MONTH);const key=giftMonthKey(),n=now();try{await env.DB.prepare('INSERT INTO gift_claims (user_id, year_month, claimed_at) VALUES (?, ?, ?)').bind(a.user.id,key,n).run()}catch(_){return j({granted:false,reason:'already_claimed'})}await env.DB.prepare(`INSERT INTO gift_minute_usage (user_id, year_month, seconds_granted, seconds_used, seconds_expired, created_at, claimed_at) VALUES (?, ?, ?, 0, 0, ?, ?) ON CONFLICT(user_id, year_month) DO UPDATE SET seconds_granted = excluded.seconds_granted, created_at = excluded.created_at, claimed_at = COALESCE(gift_minute_usage.claimed_at, excluded.claimed_at)`).bind(a.user.id,key,GIFT_SECONDS_PER_MONTH,n,n).run();const r=await row(env,a.user.id),next=pos(r?.balance_seconds)+GIFT_SECONDS_PER_MONTH,keep=sub(r,n),ex=storedExp(r,n);await env.DB.prepare('UPDATE users SET status = ?, plan_type = ?, balance_seconds = ?, expires_at = ? WHERE id = ?').bind('active',keep?'subscription':'hours',next,ex,a.user.id).run();return j({granted:true,addedSeconds:GIFT_SECONDS_PER_MONTH,newBalance:next,freeMinutes:{grantedSeconds:GIFT_SECONDS_PER_MONTH,usedSeconds:0,expiredSeconds:0,unusedSeconds:GIFT_SECONDS_PER_MONTH}})}catch(x){return e('gift_claim_failed',500,{detail:em(x)})}}
export async function handleAdminMinuteAdjust(req,env,url){if(req.method!=='POST')return e('method_not_allowed',405);try{const a=await admin(req,env);if(a.error)return a.error;const mat=url.pathname.match(/^\/api\/admin\/users\/(\d+)\/minutes$/),id=Number(mat&&mat[1]);if(!Number.isFinite(id)||id<=0)return e('Bad id',400);const body=await read(req),dm=Number(body?.deltaMinutes??body?.minutes??body?.delta);if(!Number.isFinite(dm)||dm===0)return e('Bad deltaMinutes',400);await expireUserGiftBalance(env,id).catch(()=>null);const r=await row(env,id);if(!r)return e('Not found',404);const next=Math.max(0,pos(r.balance_seconds)+Math.round(dm*60)),n=now(),keep=sub(r,n),ex=storedExp(r,n);await env.DB.prepare('UPDATE users SET balance_seconds = ?, expires_at = ?, status = ?, plan_type = ? WHERE id = ?').bind(next,ex,keep||next>0?'active':UNPAID_STATUS,keep?'subscription':(next>0?'hours':null),id).run();await env.DB.prepare('INSERT INTO payments (user_id, provider, amount, plan_code, pack_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id,'admin',0,null,`adjust_${dm>0?'+':''}${dm}min`,`admin_user_${a.user.id}`,n).run().catch(()=>{});return j({ok:true,user:await row(env,id),deltaMinutes:dm,adjustedByUserId:a.user.id})}catch(x){return e('minute_adjust_failed',500,{detail:em(x)})}}
export async function handleAdminMinuteUsage(req,env,url){try{const a=await admin(req,env);if(a.error)return a.error;await expireAllGiftBalances(env).catch(()=>null);await ensureGiftMinuteUsageSchema(env,GIFT_SECONDS_PER_MONTH);const key=giftMonthKey(),p=url.searchParams,search=(p.get('search')||'').trim().toLowerCase(),limit=Math.max(1,Math.min(500,Number(p.get('limit'))||100)),offset=Math.max(0,Number(p.get('offset'))||0),where=[],binds=[];if(search){where.push('LOWER(u.email) LIKE ?');binds.push(`%${search}%`)}const ws=where.length?`WHERE ${where.join(' AND ')}`:'';const cq=await env.DB.prepare(`SELECT COUNT(*) AS c FROM users u ${ws}`).bind(...binds).first(),totalCount=Number(cq?.c||0);const rows=await env.DB.prepare(`WITH gift AS (SELECT user_id,SUM(COALESCE(seconds_granted,0)) AS gift_seconds_granted,SUM(MAX(0,COALESCE(seconds_used,0)-COALESCE(seconds_expired,0))) AS gift_seconds_used,SUM(COALESCE(seconds_expired,0)) AS gift_seconds_expired,SUM(CASE WHEN year_month=? AND COALESCE(seconds_granted,0)>COALESCE(seconds_used,0) THEN COALESCE(seconds_granted,0)-COALESCE(seconds_used,0) ELSE 0 END) AS gift_seconds_unused FROM gift_minute_usage GROUP BY user_id) SELECT u.id,u.email,u.status,u.plan_type,u.balance_seconds,COALESCE(g.gift_seconds_granted,0) AS gift_seconds_granted,COALESCE(g.gift_seconds_used,0) AS gift_seconds_used,COALESCE(g.gift_seconds_expired,0) AS gift_seconds_expired,COALESCE(g.gift_seconds_unused,0) AS gift_seconds_unused FROM users u LEFT JOIN gift g ON g.user_id=u.id ${ws} ORDER BY u.id DESC LIMIT ? OFFSET ?`).bind(key,...binds,limit,offset).all();return j({users:rows?.results||[],totalCount,limit,offset,giftMonth:key})}catch(x){return e('minute_usage_report_failed',500,{detail:em(x)})}}
const RAVTEXT_LARGE_ELEVENLABS_CLIENT_PATCH = `;(function(){
  if (window.__ravtextElevenLabsLargeUploadPatch) return;
  window.__ravtextElevenLabsLargeUploadPatch = true;
  var nativeFetch = window.fetch;
  if (typeof nativeFetch !== "function" || typeof FormData === "undefined" || typeof Blob === "undefined") return;

  function isAiToolsRequest(input) {
    var raw = "";
    try {
      raw = typeof input === "string" ? input : (input && input.url) || "";
      var url = new URL(raw, location.href);
      return url.origin === location.origin && url.pathname === "/api/ai-tools/gas";
    } catch (_) {
      return String(raw || "").indexOf("/api/ai-tools/gas") >= 0;
    }
  }

  function base64ToBlob(base64, mime) {
    var clean = String(base64 || "");
    var comma = clean.indexOf(",");
    if (comma >= 0) clean = clean.slice(comma + 1);
    var binary = atob(clean);
    var size = binary.length;
    var chunkSize = 32768;
    var parts = [];
    for (var offset = 0; offset < size; offset += chunkSize) {
      var slice = binary.slice(offset, offset + chunkSize);
      var bytes = new Uint8Array(slice.length);
      for (var i = 0; i < slice.length; i += 1) bytes[i] = slice.charCodeAt(i);
      parts.push(bytes);
    }
    return new Blob(parts, { type: mime || "application/octet-stream" });
  }

  window.fetch = function(input, init) {
    try {
      var opts = init || {};
      if (!isAiToolsRequest(input) || !opts || typeof opts.body !== "string") return nativeFetch.apply(this, arguments);
      var data = JSON.parse(opts.body);
      var file = data && data.files && data.files[0];
      if (!data || data.prompt_type !== "elevenlabs_transcribe" || !data.api_key || !file || !file.content_base64) {
        return nativeFetch.apply(this, arguments);
      }

      var form = new FormData();
      form.append("prompt_type", "elevenlabs_transcribe");
      form.append("api_key", data.api_key);
      if (data.model) form.append("model", data.model);
      if (data.language_code) form.append("language_code", data.language_code);
      if (data.model_id) form.append("model_id", data.model_id);

      var fileName = file.name || data.file_name || "audio";
      var fileType = file.mime || file.mime_type || file.content_type || file.type || "application/octet-stream";
      form.append("file_name", fileName);
      form.append("file", base64ToBlob(file.content_base64, fileType), fileName);

      var headers = new Headers(opts.headers || {});
      headers.delete("content-type");
      headers.delete("Content-Type");

      var nextInit = {};
      for (var key in opts) nextInit[key] = opts[key];
      nextInit.headers = headers;
      nextInit.body = form;
      return nativeFetch.call(this, input, nextInit);
    } catch (_) {
      return nativeFetch.apply(this, arguments);
    }
  };
})();`;
export function buildMinuteUsageClientScript(){return RAVTEXT_LARGE_ELEVENLABS_CLIENT_PATCH+`;(function(){var state=window.__RAVTEXT_AUTH__||{};if(!state.loggedIn||!(Number(state.balanceSeconds||0)>0))return;var lastActive=0,hasActivity=false,ticking=false;function markActive(){hasActivity=true;lastActive=Date.now()}['keydown','keyup','mousedown','pointerdown','touchstart','click','input','paste','scroll'].forEach(function(n){window.addEventListener(n,markActive,{passive:true,capture:true})});document.addEventListener('visibilitychange',function(){if(!document.hidden)markActive()},{passive:true});function active(){return hasActivity&&!document.hidden&&document.hasFocus&&document.hasFocus()&&Date.now()-lastActive<120000}async function tick(){if(ticking||!active())return;ticking=true;try{var res=await fetch('/api/payments/usage/tick',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({seconds:60})});if(res.ok){var data=await res.json();window.__RAVTEXT_AUTH__=window.__RAVTEXT_AUTH__||{};if(typeof data.balanceSeconds==='number')window.__RAVTEXT_AUTH__.balanceSeconds=data.balanceSeconds;if(typeof data.paid==='boolean')window.__RAVTEXT_AUTH__.paid=data.paid;if(data.expired||data.paid===false){try{localStorage.removeItem('ravtext.demoMode')}catch(e){}try{delete window.__RAVTEXT_DEMO_MODE__}catch(e){window.__RAVTEXT_DEMO_MODE__=true}window.dispatchEvent(new CustomEvent('ravtext:premium-expired',{detail:data}));setTimeout(function(){location.reload()},250)}}}catch(e){}finally{ticking=false}}setInterval(tick,60000)})();`}
