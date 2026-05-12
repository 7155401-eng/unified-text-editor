import { getUserFromRequest } from './session.js';

const PLAYLIST_ID_KEY = 'VIDEO_GALLERY_PLAYLIST_ID';
const PLAYLIST_NAME_KEY = 'VIDEO_GALLERY_PLAYLIST_NAME';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function parsePlaylistId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    return url.searchParams.get('list') || raw;
  } catch {
    const match = raw.match(/[?&]list=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : raw.replace(/^list=/, '').trim();
  }
}

function isValidPlaylistId(value) {
  const id = parsePlaylistId(value);
  return /^[A-Za-z0-9_-]{3,200}$/.test(id);
}

async function readSetting(env, key) {
  try {
    const row = await env.DB.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).bind(key).first();
    return row ? String(row.value || '') : '';
  } catch {
    return '';
  }
}

async function writeSetting(env, key, value, userId) {
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES (?, ?, ?, ?)\n' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id'
  ).bind(key, String(value || ''), nowSec, userId || null).run();
}

async function readServerPlaylist(env) {
  const playlistId =
    parsePlaylistId(await readSetting(env, PLAYLIST_ID_KEY)) ||
    parsePlaylistId(env.VIDEO_GALLERY_PLAYLIST_ID || '');

  const name =
    String(await readSetting(env, PLAYLIST_NAME_KEY) || env.VIDEO_GALLERY_PLAYLIST_NAME || 'סרטוני הדרכה').trim() ||
    'סרטוני הדרכה';

  return {
    configured: !!playlistId,
    name,
    playlistId,
  };
}

async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: json({ error: 'Not logged in' }, 401) };
  if (!user.is_admin) return { error: json({ error: 'Forbidden' }, 403) };
  return { user };
}

export async function handleVideoGallery(request, env, url) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const playlist = await readServerPlaylist(env);
  return json(playlist);
}

export async function handleAdminVideoGallery(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  if (request.method === 'GET') {
    const playlist = await readServerPlaylist(env);
    return json(playlist);
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const playlistId = parsePlaylistId(
    body.playlistId ||
    body.playlist_id ||
    body.playlist ||
    body.list ||
    body.url ||
    ''
  );

  if (!playlistId || !isValidPlaylistId(playlistId)) {
    return json({ error: 'Invalid playlistId' }, 400);
  }

  const name = String(body.name || body.title || 'סרטוני הדרכה').trim() || 'סרטוני הדרכה';

  await writeSetting(env, PLAYLIST_ID_KEY, playlistId, auth.user.id);
  await writeSetting(env, PLAYLIST_NAME_KEY, name, auth.user.id);

  return json({
    ok: true,
    configured: true,
    name,
    playlistId,
  });
}