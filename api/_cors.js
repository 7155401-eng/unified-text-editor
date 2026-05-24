export function applyCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, x-file-name");
  res.setHeader("access-control-max-age", "86400");
}

export function handleCorsOptions(req, res) {
  applyCors(res);
  if (req?.method === "OPTIONS") {
    res.statusCode = 204;
    res.end("");
    return true;
  }
  return false;
}
