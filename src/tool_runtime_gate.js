import { canUseTool, showToolBlocked } from "./premium/daily_quota_gate.js";

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

async function postGate(payload, { silent = false } = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const reason = res.status === 401
      ? "login"
      : (data?.reason || (res.status === 429 ? "quota" : (res.status === 409 ? "in_progress" : "error")));
    if (!silent && (reason === "login" || reason === "quota" || reason === "in_progress")) {
      showToolBlocked(payload.toolName, payload.niceName || payload.toolName, reason, data);
    }
    const err = new Error(
      reason === "login" ? "LOGIN_REQUIRED"
        : reason === "quota" ? "TOOL_QUOTA_EXCEEDED"
          : reason === "in_progress" ? "TOOL_QUOTA_IN_PROGRESS"
            : `Tool gate failed: HTTP ${res.status}`
    );
    err.code = reason;
    err.details = data;
    err.status = res.status;
    throw err;
  }

  return data || {};
}

function assertLocalLogin(toolName) {
  const localCheck = canUseTool(toolName);
  if (localCheck.allowed) return;
  showToolBlocked(toolName, toolName, localCheck.reason);
  const err = new Error(localCheck.reason === "login" ? "LOGIN_REQUIRED" : "TOOL_NOT_ALLOWED");
  err.code = localCheck.reason;
  throw err;
}

/**
 * Authorize opening a tool. This is non-consuming for desktop-parity policies.
 */
export async function assertToolAllowed(toolName) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");

  assertLocalLogin(key);

  const cached = _tokens.get(key);
  if (cached && cached.expiresAt - CACHE_SKEW_MS > Date.now()) return cached;

  const data = await postGate({
    action: "preflight",
    toolName: key,
    timestamp: Date.now(),
    timeZoneOffsetMinutes: timezoneOffsetMinutes(),
  });

  if (!data?.ok || !data?.token) throw new Error("Tool preflight did not return a token");
  _tokens.set(key, data);
  return data;
}

/**
 * Check a real action immediately before starting it, without consuming quota.
 * amount is used by unit policies such as Torah nikud characters/day.
 */
export async function checkToolAllowance(toolName, { amount = 1, niceName = "", silent = false } = {}) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");
  assertLocalLogin(key);
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
  return checkToolAllowance(toolName, { amount, silent: true });
}

/**
 * Record a successful metered action or session activity.
 * The Worker applies the tool's own policy and Premium bypass.
 */
export async function consumeToolUse(toolName, {
  amount = 1,
  niceName = "",
  kind = "success",
  idempotencyKey = "",
} = {}) {
  const key = String(toolName || "").trim();
  if (!key) throw new Error("Missing tool name");
  assertLocalLogin(key);
  return postGate({
    action: "consume",
    toolName: key,
    niceName,
    amount,
    idempotencyKey: idempotencyKey || newIdempotencyKey(key, kind),
    eventKind: kind,
    timestamp: Date.now(),
    timeZoneOffsetMinutes: timezoneOffsetMinutes(),
  });
}

export async function guardToolAction(toolName, action, options = {}) {
  await checkToolAllowance(toolName, options);
  const result = await action();
  await consumeToolUse(toolName, options);
  return result;
}
