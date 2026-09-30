import {
  canUseTool,
  isPaidAccount,
  markToolUsed,
  showToolBlocked,
} from "./premium/daily_quota_gate.js";

const ENDPOINT = "/api/tools/preflight";
const CACHE_SKEW_MS = 15000;
const _tokens = new Map();

function timezoneOffsetMinutes() {
  try { return -new Date().getTimezoneOffset(); } catch (_) { return 0; }
}

function newIdempotencyKey(toolName, kind = "success") {
  try {
    if (globalThis.crypto?.randomUUID) return `${toolName}:${kind}:${crypto.randomUUID()}`;
  } catch (_) {}
  return `${toolName}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function assertLocalAccess(toolName) {
  const localCheck = canUseTool(toolName);
  if (localCheck.allowed) return;
  showToolBlocked(toolName, toolName, localCheck.reason);
  const err = new Error(localCheck.reason === "login" ? "LOGIN_REQUIRED" : "TOOL_QUOTA_EXCEEDED");
  err.code = localCheck.reason;
  throw err;
}

async function postGate(payload, { silent = false } = {}) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const err = new Error(error?.message || "TOOL_GATE_NETWORK_ERROR");
    err.code = "network";
    throw err;
  }

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const reason = res.status === 401
      ? "login"
      : (data?.reason || (res.status === 429 ? "quota" : "error"));
    if (!silent && (reason === "login" || reason === "quota" || reason === "in_progress")) {
      showToolBlocked(payload.toolName, payload.niceName || payload.toolName, reason, data);
    }
    const err = new Error(
      reason === "login" ? "LOGIN_REQUIRED"
        : reason === "quota" ? "TOOL_QUOTA_EXCEEDED"
          : `Tool gate failed: HTTP ${res.status}`
    );
    err.code = reason;
    err.details = data;
    err.status = res.status;
    throw err;
  }

  return data || {};
}

/**
 * Authorize opening a tool. Metered migrated tools are checked but not consumed.
 */
export async function assertToolAllowed(toolName) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");

  assertLocalAccess(key);

  const cached = _tokens.get(key);
  if (cached && cached.expiresAt - CACHE_SKEW_MS > Date.now()) {
    return cached;
  }

  const data = await postGate({
    action: "preflight",
    toolName: key,
    timestamp: Date.now(),
    timeZoneOffsetMinutes: timezoneOffsetMinutes(),
  });

  if (!data?.ok || !data?.token) {
    throw new Error("Tool preflight did not return a token");
  }

  _tokens.set(key, data);
  // Legacy daily tools still mirror the server preflight in localStorage for UX.
  // Server-managed tools are no-ops in markToolUsed().
  if (!isPaidAccount()) markToolUsed(key);
  return data;
}

/**
 * Check the tool's real free allowance immediately before expensive work.
 * amount is meaningful for unit policies (Torah nikud characters/day).
 */
export async function checkToolAllowance(toolName, {
  amount = 1,
  niceName = "",
  silent = false,
} = {}) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");
  assertLocalAccess(key);

  return postGate({
    action: "check",
    toolName: key,
    niceName,
    amount,
    timestamp: Date.now(),
    timeZoneOffsetMinutes: timezoneOffsetMinutes(),
  }, { silent });
}

export async function getToolQuotaStatus(toolName, { amount = 1 } = {}) {
  try {
    return await checkToolAllowance(toolName, { amount, silent: true });
  } catch (err) {
    if (err?.details) {
      return {
        ...err.details,
        ok: false,
        reason: err.code || err.details.reason || "quota",
      };
    }
    throw err;
  }
}

/**
 * Atomically record a successful action / first session action.
 * Retries reuse one idempotency key so a lost HTTP response cannot double-charge.
 */
export async function consumeToolUse(toolName, {
  amount = 1,
  niceName = "",
  kind = "success",
  idempotencyKey = "",
} = {}) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");
  assertLocalAccess(key);

  const stableKey = idempotencyKey || newIdempotencyKey(key, kind);
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await postGate({
        action: "consume",
        toolName: key,
        niceName,
        amount,
        idempotencyKey: stableKey,
        eventKind: kind,
        timestamp: Date.now(),
        timeZoneOffsetMinutes: timezoneOffsetMinutes(),
      }, { silent: attempt > 0 });

      // A real consume changes future authorization. Do not reuse a stale
      // preflight token (especially Comparator close+reopen).
      _tokens.delete(key);
      return result;
    } catch (err) {
      lastError = err;
      if (err?.code === "quota" || err?.code === "login") throw err;
      const retryable = err?.code === "network" || (Number(err?.status) >= 500);
      if (!retryable || attempt === 2) throw err;
      await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
    }
  }

  throw lastError || new Error("Tool quota consume failed");
}

export async function guardToolAction(toolName, action, options = {}) {
  await checkToolAllowance(toolName, options);
  const result = await action();
  await consumeToolUse(toolName, options);
  return result;
}
