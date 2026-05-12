import { getUserFromRequest } from './session.js';

const PLAYLIST_ID_KEY = 'VIDEO_GALLERY_PLAYLIST_ID';
const PLAYLIST_NAME_KEY = 'VIDEO_GALLERY_PLAYLIST_NAME';
const DEFAULT_GALLERY_NAME = 'סרטוני עזרה והדרכה';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
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

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .trim();
}

function pick(text, regex) {
  const m = String(text || '').match(regex);
  return m ? decodeXml(m[1]) : '';
}

function parseYoutubeFeed(xml) {
  const entries = String(xml || '').match(/<entry\b[\s\S]*?<\/entry>/g) || [];

  return entries.map((entry) => {
    const videoId =
      pick(entry, /<yt:videoId>([\s\S]*?)<\/yt:videoId>/) ||
      pick(entry, /<id>yt:video:([\s\S]*?)<\/id>/);

    const title =
      pick(entry, /<media:title>([\s\S]*?)<\/media:title>/) ||
      pick(entry, /<title>([\s\S]*?)<\/title>/) ||
      'סרטון';

    const published = pick(entry, /<published>([\s\S]*?)<\/published>/);
    const thumbnail = pick(entry, /<media:thumbnail[^>]*url="([^"]+)"/);

    if (!videoId) return null;

    return {
      videoId,
      title,
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      published,
    };
  }).filter(Boolean).slice(0, 80);
}

async function fetchPlaylistVideos(playlistId) {
  if (!playlistId) return [];

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;

  try {
    const res = await fetch(feedUrl, {
      headers: {
        'accept': 'application/atom+xml, application/xml, text/xml',
        'user-agent': 'RavText video gallery',
      },
    });

    if (!res.ok) return [];

    const xml = await res.text();
    return parseYoutubeFeed(xml);
  } catch {
    return [];
  }
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

async function readServerPlaylist(env, includeItems = false) {
  const playlistId =
    parsePlaylistId(await readSetting(env, PLAYLIST_ID_KEY)) ||
    parsePlaylistId(env.VIDEO_GALLERY_PLAYLIST_ID || '');

  const name =
    String(await readSetting(env, PLAYLIST_NAME_KEY) || env.VIDEO_GALLERY_PLAYLIST_NAME || DEFAULT_GALLERY_NAME).trim() ||
    DEFAULT_GALLERY_NAME;

  const data = {
    configured: !!playlistId,
    name,
    playlistId,
  };

  if (includeItems) {
    data.items = await fetchPlaylistVideos(playlistId);
  }

  return data;
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

  const playlist = await readServerPlaylist(env, true);
  return json(playlist);
}

export async function handleAdminVideoGallery(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  if (request.method === 'GET') {
    const playlist = await readServerPlaylist(env, true);
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

  const name = String(body.name || body.title || DEFAULT_GALLERY_NAME).trim() || DEFAULT_GALLERY_NAME;

  await writeSetting(env, PLAYLIST_ID_KEY, playlistId, auth.user.id);
  await writeSetting(env, PLAYLIST_NAME_KEY, name, auth.user.id);

  const items = await fetchPlaylistVideos(playlistId);

  return json({
    ok: true,
    configured: true,
    name,
    playlistId,
    items,
  });
}