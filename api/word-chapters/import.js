import { importDocxBuffer, readRequestBuffer, sendError, sendJson } from "../_word_chapter_import_server.js";

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
    const imported = await importDocxBuffer(buffer);
    return sendJson(res, 200, {
      ok: true,
      serverSide: true,
      importedAt: Date.now(),
      ...imported.manifest,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
