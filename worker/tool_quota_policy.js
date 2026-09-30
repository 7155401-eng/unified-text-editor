// Canonical Free/Premium policy registry for RavText tools.
//
// This file describes the PRODUCT policy copied/translated from the older
// desktop project. Runtime migration is deliberately explicit: tools that
// still rely on the old once/day preflight gate stay on legacyPreflight=true
// until their real successful action is wired to the server quota store.
//
// Premium/admin bypass is handled by the caller, not duplicated here.

export const DAY_SEC = 24 * 60 * 60;
export const WEEK_SEC = 7 * DAY_SEC;
export const FIFTEEN_MIN_SEC = 15 * 60;

const POLICIES = Object.freeze({
  "word-extractor": Object.freeze({
    mode: "unmetered",
    chargeOn: "none",
    legacyPreflight: false,
    source: "core-import",
  }),
  "torah-transcription": Object.freeze({
    mode: "unmetered",
    chargeOn: "none",
    legacyPreflight: false,
    source: "desktop-free-always",
  }),
  // No quota check was found in the old Text Compare Pro launcher/tool during
  // the initial parity audit. Keep its target policy explicit, but do not flip
  // runtime behavior until the deeper tool audit is completed.
  "text-compare-pro": Object.freeze({
    mode: "unmetered",
    chargeOn: "none",
    legacyPreflight: true,
    source: "desktop-no-quota-found-pending-final-audit",
  }),
  "comparator-tool": Object.freeze({
    mode: "session",
    limit: 1,
    windowSeconds: WEEK_SEC,
    sessionIdleSeconds: FIFTEEN_MIN_SEC,
    chargeOn: "action",
    legacyPreflight: true,
    source: "desktop-comparator-use",
  }),
  "nikud-merger": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: WEEK_SEC,
    chargeOn: "success",
    legacyPreflight: false,
    source: "desktop-weekly-merge",
  }),
  "sefaria-downloader": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: WEEK_SEC,
    chargeOn: "success",
    legacyPreflight: true,
    source: "desktop-weekly-book-export",
  }),
  "sefaria-live": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: WEEK_SEC,
    chargeOn: "success",
    legacyPreflight: true,
    source: "desktop-weekly-fetch",
  }),
  "torah-nikud": Object.freeze({
    mode: "units",
    limit: 500,
    unit: "chars",
    windowSeconds: DAY_SEC,
    chargeOn: "success",
    legacyPreflight: true,
    source: "desktop-500-chars-day",
  }),
  "haredi-caricature": Object.freeze({
    mode: "cooldown",
    cooldownSeconds: DAY_SEC,
    chargeOn: "success",
    legacyPreflight: true,
    source: "desktop-quota-module-24h",
  }),
  // Existing public tools that do not yet have a verified old-product policy.
  // Preserve current once/day behavior until they receive a source audit.
  "css-ai": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: DAY_SEC,
    chargeOn: "preflight",
    legacyPreflight: true,
    source: "web-legacy-default",
  }),
  "torah-tools": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: DAY_SEC,
    chargeOn: "preflight",
    legacyPreflight: true,
    source: "web-legacy-default",
  }),
});

export const PUBLIC_TOOL_NAMES = Object.freeze(Object.keys(POLICIES));

export function getToolQuotaPolicy(toolName) {
  const key = String(toolName || "").trim();
  return POLICIES[key] || null;
}

export function isKnownPublicTool(toolName) {
  return !!getToolQuotaPolicy(toolName);
}

export function isPolicyUnmetered(toolName) {
  return getToolQuotaPolicy(toolName)?.mode === "unmetered";
}

export function usesLegacyPreflightQuota(toolName) {
  const p = getToolQuotaPolicy(toolName);
  return !!p?.legacyPreflight;
}

export function policyPublicView(toolName) {
  const p = getToolQuotaPolicy(toolName);
  if (!p) return null;
  return {
    toolName: String(toolName),
    mode: p.mode,
    limit: Number.isFinite(p.limit) ? p.limit : null,
    unit: p.unit || null,
    windowSeconds: Number.isFinite(p.windowSeconds) ? p.windowSeconds : null,
    sessionIdleSeconds: Number.isFinite(p.sessionIdleSeconds) ? p.sessionIdleSeconds : null,
    cooldownSeconds: Number.isFinite(p.cooldownSeconds) ? p.cooldownSeconds : null,
    chargeOn: p.chargeOn,
    migrated: !p.legacyPreflight,
  };
}
