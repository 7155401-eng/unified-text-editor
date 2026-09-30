import { canUseTool, isPaidAccount, markToolUsed, showToolBlocked } from "./premium/daily_quota_gate.js";

const ENDPOINT = "/api/tools/preflight";
const CACHE_SKEW_MS = 15000;
const _tokens = new Map();

async function responseJson(res) {
  try { return await res.json(); } catch (_) { return {}; }
}

function quotaError(data = {}) {
  const err = new Error("TOOL_QUOTA_EXCEEDED");
  err.code = "quota";
  err.resetAt = data.resetAt ?? null;
  err.windowSeconds = data.windowSeconds ?? null;
  return err;
}

export function createToolActionIdempotencyKey(prefix = "tool") {
  try {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  } catch (_) {}
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
    const data = await responseJson(res);
    if (res.status === 401) {
      showToolBlocked(key, key, "login", data);
      const err = new Error("LOGIN_REQUIRED");
      err.code = "login";
      throw err;
    }
    if (res.status === 429) {
      showToolBlocked(key, key, "quota", data);
      throw quotaError(data);
    }
    throw new Error(data?.message || `Tool preflight failed: HTTP ${res.status}`);
  }
  const data = await responseJson(res);
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


export async function consumeToolUse(toolName, options = {}) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");

  if (isPaidAccount()) {
    return { ok: true, unlimited: true, remaining: null, resetAt: null };
  }

  const localCheck = canUseTool(key);
  if (!localCheck.allowed) {
    showToolBlocked(key, options.niceName || key, localCheck.reason);
    const err = new Error(localCheck.reason === "login" ? "LOGIN_REQUIRED" : "TOOL_QUOTA_EXCEEDED");
    err.code = localCheck.reason;
    throw err;
  }

  const idempotencyKey = options.idempotencyKey || createToolActionIdempotencyKey(key);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "consume_use",
      toolName: key,
      units: Math.max(1, Number(options.units) || 1),
      idempotencyKey,
    }),
  });
  const data = await responseJson(res);

  if (!res.ok) {
    if (res.status === 401) {
      showToolBlocked(key, options.niceName || key, "login", data);
      const err = new Error("LOGIN_REQUIRED");
      err.code = "login";
      throw err;
    }
    if (res.status === 429) {
      showToolBlocked(key, options.niceName || key, "quota", data);
      throw quotaError(data);
    }
    throw new Error(data?.message || `Tool quota consume failed: HTTP ${res.status}`);
  }

  return { ...data, idempotencyKey };
}


export async function consumeToolSuccess(toolName, options = {}) {
  return consumeToolUse(toolName, options);
}
