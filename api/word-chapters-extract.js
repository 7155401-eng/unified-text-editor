import { handleCorsOptions } from "./_cors.js";
import { extractChapterBuffer, readRequestBuffer, sendError, sendJson } from "./_word_chapter_server.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

function readNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default async function handler(req, res) {
  if (handleCorsOptions(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST, OPTIONS");
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url || "/api/word-chapters-extract", "http://localhost");
    const level = readNumber(url.searchParams.get("level"), 1);
    const chapterIndex = readNumber(url.searchParams.get("index"), 0);

    const buffer = await readRequestBuffer(req);
    const extracted = await extractChapterBuffer(buffer, { level, chapterIndex });

    return sendJson(res, 200, {
      ok: true,
      serverSide: true,
      ...extracted,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
