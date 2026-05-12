import { getUserFromRequest } from './session.js';

const KEYS = ['CARICATURE_GAS_URL','CARICATURE_USE_GAS_FALLBACK','CARICATURE_IMAGE_MODEL','CARICATURE_SYSTEM_PROMPT','CARICATURE_HARD_RULES','CARICATURE_NEGATIVE_DEFAULT','CARICATURE_REFERENCE_IMAGE_MIME','CARICATURE_REFERENCE_IMAGE_B64','CARICATURE_DEBUG'];
const DEFAULTS = { CARICATURE_USE_GAS_FALLBACK: '1', CARICATURE_IMAGE_MODEL: 'gemini-3-pro-image-preview', CARICATURE_REFERENCE_IMAGE_MIME: 'image/jpeg', CARICATURE_DEBUG: '0' };

function json(obj, status = 200) { return Response.json(obj, { status, headers: { 'cache-control': 'no-store' } }); }
async function adminOnly(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: json({ error: 'Not logged in' }, 401) };
  if (!user.is_admin) return { error: json({ error: 'Forbidden' }, 403) };
  return { user };
}
function clip(v, n) { const s = String(v == null ? '' : v); return s.length > n ? s.slice(0, n) : s; }
function clean(key, value) {
  const s = String(value == null ? '' : value);
  if (key === 'CARICATURE_REFERENCE_IMAGE_B64') return s.replace(/\s+/g, '').slice(0, 2500000);
  if (key === 'CARICATURE_SYSTEM_PROMPT' || key === 'CARICATURE_HARD_RULES') return clip(s, 30000);
  if (key === 'CARICATURE_NEGATIVE_DEFAULT') return clip(s, 5000);
  if (key === 'CARICATURE_GAS_URL') return clip(s.trim(), 1500);
  if (key === 'CARICATURE_IMAGE_MODEL') return clip(s.trim(), 160);
  if (key === 'CARICATURE_REFERENCE_IMAGE_MIME') return clip(s.trim() || 'image/jpeg', 100);
  if (key === 'CARICATURE_USE_GAS_FALLBACK' || key === 'CARICATURE_DEBUG') return ['1','true','yes','on','enabled'].includes(s.trim().toLowerCase()) ? '1' : '0';
  return clip(s, 5000);
}
async function readDb(env) {
  if (!env.DB) return {};
  const placeholders = KEYS.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`).bind(...KEYS).all();
  const out = {};
  for (const r of rows.results || []) out[r.key] = r.value;
  return out;
}
function expose(key, value) {
  if (key === 'CARICATURE_REFERENCE_IMAGE_B64') {
    const s = String(value || '');
    return { present: !!s, length: s.length, preview: s ? s.slice(0, 32) + '…' : '' };
  }
  return value == null ? '' : String(value);
}
async function getSettings(env) {
  const db = await readDb(env);
  const settings = {};
  for (const key of KEYS) {
    const envValue = env?.[key] != null ? String(env[key]) : '';
    const dbValue = db[key] != null ? String(db[key]) : '';
    const value = envValue || dbValue || DEFAULTS[key] || '';
    settings[key] = { value: expose(key, value), source: envValue ? 'env' : (dbValue ? 'db' : 'default'), editable: !envValue };
  }
  return json({ ok: true, gemini_api_key: { configured: !!env?.GEMINI_API_KEY, source: env?.GEMINI_API_KEY ? 'secret/env' : 'missing', editable_here: false }, settings });
}
async function saveSettings(request, env, user) {
  if (!env.DB) return json({ error: 'DB is not configured' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const input = body?.settings && typeof body.settings === 'object' ? body.settings : body || {};
  const now = Math.floor(Date.now() / 1000);
  const saved = [];
  for (const key of KEYS) {
    if (!(key in input)) continue;
    if (env?.[key] != null) continue;
    const value = clean(key, input[key]);
    await env.DB.prepare(`INSERT INTO app_settings (key,value,updated_at,updated_by_user_id) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by_user_id=excluded.updated_by_user_id`).bind(key, value, now, user.id || null).run();
    saved.push(key);
  }
  return json({ ok: true, saved });
}
export async function handleCaricatureAdmin(request, env, url) {
  const auth = await adminOnly(request, env);
  if (auth.error) return auth.error;
  if (url.pathname !== '/api/admin/caricature-settings') return json({ error: 'Not found' }, 404);
  if (request.method === 'GET') return getSettings(env);
  if (request.method === 'POST') return saveSettings(request, env, auth.user);
  return json({ error: 'method_not_allowed' }, 405);
}
