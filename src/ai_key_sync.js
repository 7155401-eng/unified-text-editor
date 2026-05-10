const SYSTEM_KEYS = {
  gemini: "ravtext.ai.apiKey.google",
  claude: "ravtext.ai.apiKey.anthropic",
};

function readKey(storageKey) {
  try {
    return (localStorage.getItem(storageKey) || "").trim();
  } catch (e) {
    return "";
  }
}

function writeKey(storageKey, value) {
  try {
    const cleaned = String(value || "").trim();
    if (cleaned) localStorage.setItem(storageKey, cleaned);
    else localStorage.removeItem(storageKey);
  } catch (e) {
    /* noop */
  }
}

export function getSyncedGeminiApiKey(fallback = "") {
  return readKey(SYSTEM_KEYS.gemini) || String(fallback || "").trim();
}

export function getSyncedClaudeApiKey(fallback = "") {
  return readKey(SYSTEM_KEYS.claude) || String(fallback || "").trim();
}

export function saveSyncedGeminiApiKey(value) {
  writeKey(SYSTEM_KEYS.gemini, value);
}

export function saveSyncedClaudeApiKey(value) {
  writeKey(SYSTEM_KEYS.claude, value);
}
