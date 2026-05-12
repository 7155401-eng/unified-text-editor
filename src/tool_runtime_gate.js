import { canUseTool, isPaidAccount, markToolUsed, showToolBlocked } from "./premium/daily_quota_gate.js";

const ENDPOINT = "/api/tools/preflight";
const CACHE_SKEW_MS = 15000;
const _tokens = new Map();

export async function assertToolAllowed(toolName) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");

  const cached = _tokens.get(key);
  if (cached && cached.expiresAt - CACHE_SKEW_MS > Date.now()) {
    return cached;
  }

  const localCheck = canUseTool(key);
  if (!localCheck.allowed) {
    showToolBlocked(key, key, localCheck.reason);
    const err = new Error(localCheck.reason === "login" ? "LOGIN_REQUIRED" : "TOOL_QUOTA_EXCEEDED");
    err.code = localCheck.reason;
    throw err;
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ toolName: key, timestamp: Date.now() }),
  });
  if (!res.ok) {
    if (res.status === 401) {
      showToolBlocked(key, key, "login");
      const err = new Error("LOGIN_REQUIRED");
      err.code = "login";
      throw err;
    }
    if (res.status === 429) {
      showToolBlocked(key, key, "quota");
      const err = new Error("TOOL_QUOTA_EXCEEDED");
      err.code = "quota";
      throw err;
    }
    throw new Error(`Tool preflight failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data?.ok || !data?.token) {
    throw new Error("Tool preflight did not return a token");
  }
  _tokens.set(key, data);
  if (!isPaidAccount()) markToolUsed(key);
  return data;
}

export async function guardToolAction(toolName, action) {
  await assertToolAllowed(toolName);
  return action();
}
