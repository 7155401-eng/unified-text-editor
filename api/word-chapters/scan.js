import { readRequestBuffer, scanDocxBuffer, sendError, sendJson } from "../_word_chapter_server.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const buffer = await readRequestBuffer(req);
    const scan = await scanDocxBuffer(buffer);
    return sendJson(res, 200, {
      ok: true,
      serverSide: true,
      ...scan.manifest,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
