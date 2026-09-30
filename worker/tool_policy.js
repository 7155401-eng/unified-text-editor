// Canonical server-side tool access policy registry.
//
// This file describes product policy. Enforcement can migrate tool-by-tool.
// "legacy-preflight-daily" means the current once-per-day preflight gate remains
// authoritative until that tool gets its success/session/unit-based server flow.
// Keeping migrationState explicit prevents a policy declaration from silently
// opening a metered tool before its consume path is ready.

export const TOOL_POLICIES = Object.freeze({
  "word-extractor": Object.freeze({
    freeMode: "unmetered",
    premiumMode: "unlimited",
    chargeOn: "none",
    migrationState: "server-ready",
  }),
  "torah-transcription": Object.freeze({
    freeMode: "unmetered",
    premiumMode: "unlimited",
    chargeOn: "none",
    migrationState: "server-ready",
  }),
  "text-compare-pro": Object.freeze({
    freeMode: "unmetered",
    premiumMode: "unlimited",
    chargeOn: "none",
    migrationState: "server-ready",
  }),

  // Desktop parity targets. These remain on the legacy daily preflight gate
  // until their authoritative success/session/unit/cooldown consume paths land.
  "comparator-tool": Object.freeze({
    freeMode: "session",
    limit: 1,
    windowSeconds: 7 * 24 * 60 * 60,
    sessionIdleSeconds: 15 * 60,
    premiumMode: "unlimited",
    chargeOn: "first-session-action",
    migrationState: "legacy-preflight-daily",
  }),
  "nikud-merger": Object.freeze({
    freeMode: "count",
    limit: 1,
    windowSeconds: 7 * 24 * 60 * 60,
    premiumMode: "unlimited",
    chargeOn: "success",
    migrationState: "legacy-preflight-daily",
  }),
  "sefaria-downloader": Object.freeze({
    freeMode: "count",
    limit: 1,
    windowSeconds: 7 * 24 * 60 * 60,
    premiumMode: "unlimited",
    chargeOn: "success",
    migrationState: "legacy-preflight-daily",
  }),
  "sefaria-live": Object.freeze({
    freeMode: "count",
    limit: 1,
    windowSeconds: 7 * 24 * 60 * 60,
    premiumMode: "unlimited",
    chargeOn: "success",
    migrationState: "legacy-preflight-daily",
  }),
  "torah-nikud": Object.freeze({
    freeMode: "units",
    limit: 500,
    unit: "characters",
    window: "local-day",
    premiumMode: "unlimited",
    chargeOn: "success",
    migrationState: "legacy-preflight-daily",
  }),
  "haredi-caricature": Object.freeze({
    freeMode: "cooldown",
    limit: 1,
    windowSeconds: 24 * 60 * 60,
    premiumMode: "unlimited",
    chargeOn: "success",
    migrationState: "legacy-preflight-daily",
  }),

  // Source policy is not yet audited deeply enough. Preserve current behavior.
  "css-ai": Object.freeze({
    freeMode: "legacy-daily",
    premiumMode: "unlimited",
    chargeOn: "preflight",
    migrationState: "legacy-preflight-daily",
  }),
  "torah-tools": Object.freeze({
    freeMode: "legacy-daily",
    premiumMode: "unlimited",
    chargeOn: "preflight",
    migrationState: "legacy-preflight-daily",
  }),
});

export function getToolPolicy(toolName) {
  return TOOL_POLICIES[String(toolName || "").trim()] || null;
}

export function isToolPublic(toolName) {
  return !!getToolPolicy(toolName);
}

export function isFreePreflightUnmetered(toolName) {
  const p = getToolPolicy(toolName);
  return !!p && p.migrationState === "server-ready" && p.freeMode === "unmetered";
}

export function publicToolNames() {
  return Object.keys(TOOL_POLICIES);
}
