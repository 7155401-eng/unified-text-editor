import { jsonResponse, methodNotAllowed, optionsResponse, routeNotImplemented } from "../_docx_import_worker.js";

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method === "GET") return jsonResponse({ ok: true, service: "ravtext-cloudflare-docx-api", route: "extract" });
  if (request.method !== "POST") return methodNotAllowed();
  return routeNotImplemented("extract");
}
