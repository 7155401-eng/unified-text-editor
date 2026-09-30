// משה 2026-05-09: ניהול מפתחות AI לכמה ספקים בו זמנית.
// כל מפתח נשמר אצל המשתמש בלבד (localStorage), לא נשלח לשרת שלנו.
// תאימות לאחור: אם קיים `ravtext.ai.apiKey` ישן עם ערך, ממירים אותו לסלוט של
// `ravtext.ai.provider` (ברירת המחדל הישנה) ומוחקים את המפתח הישן.
//
// מפתח ה-localStorage לכל ספק: `ravtext.ai.apiKey.<provider>`
// מפתח ספק ברירת המחדל: `ravtext.ai.provider`

const PROVIDERS = ["anthropic", "openai", "google", "mistral", "groq", "deepseek"];
const PROVIDER_LABELS = Object.freeze({
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  mistral: "Mistral",
  groq: "Groq",
  deepseek: "DeepSeek",
});
const PROVIDER_KEY = "ravtext.ai.provider";
const LEGACY_KEY = "ravtext.ai.apiKey";

function keyFor(provider) {
  return `ravtext.ai.apiKey.${provider}`;
}

function migrateLegacyKey() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const provider = localStorage.getItem(PROVIDER_KEY) || "anthropic";
    const target = keyFor(provider);
    // העבר רק אם הסלוט הזה ריק — לא לדרוס מפתח קיים
    if (!localStorage.getItem(target)) {
      localStorage.setItem(target, legacy);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
}

export function getActiveAiProvider() {
  return localStorage.getItem(PROVIDER_KEY) || "anthropic";
}

export function getActiveAiKey() {
  const provider = getActiveAiProvider();
  return localStorage.getItem(keyFor(provider)) || "";
}

export function getAiKeyFor(provider) {
  return localStorage.getItem(keyFor(provider)) || "";
}

function safeProviderToken(provider) {
  return String(provider || "ai").replace(/[^a-z0-9_-]/gi, "-");
}

export function syncAiKeyToggleA11y(btn, input, provider) {
  if (!btn || !input) return;
  const providerName = PROVIDER_LABELS[provider] || String(provider || "AI");
  if (!input.id) input.id = `settings-ai-key-${safeProviderToken(provider)}`;
  const visible = input.type === "text";
  const label = `${visible ? "הסתר" : "הצג"} מפתח API של ${providerName}`;
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-controls", input.id);
  btn.setAttribute("title", label);
}

export function toggleAiKeyVisibility(btn, input, provider) {
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
  syncAiKeyToggleA11y(btn, input, provider);
}

export function setupAiKeysSettings() {
  if (typeof document === "undefined") return;
  migrateLegacyKey();

  // ספק ברירת מחדל
  const providerSelect = document.getElementById("settings-ai-provider");
  if (providerSelect) {
    providerSelect.value = getActiveAiProvider();
    providerSelect.addEventListener("change", () => {
      localStorage.setItem(PROVIDER_KEY, providerSelect.value);
    });
  }

  // טעינת ערכים קיימים לכל שדה
  const inputs = document.querySelectorAll(".ai-key-input[data-provider]");
  inputs.forEach((input) => {
    const provider = input.getAttribute("data-provider");
    if (!provider || !PROVIDERS.includes(provider)) return;
    input.value = getAiKeyFor(provider);
    const saveValue = () => {
      const v = (input.value || "").trim();
      if (v) localStorage.setItem(keyFor(provider), v);
      else localStorage.removeItem(keyFor(provider));
    };
    input.addEventListener("change", saveValue);
    input.addEventListener("blur", saveValue);
  });

  // כפתורי הצג/הסתר — accessible name reflects the action available
  // right now, and aria-controls points at the exact key field.
  const toggles = document.querySelectorAll(".ai-key-toggle[data-toggle-for]");
  toggles.forEach((btn) => {
    const provider = btn.getAttribute("data-toggle-for");
    const input = document.querySelector(`.ai-key-input[data-provider="${provider}"]`);
    if (!input) return;
    syncAiKeyToggleA11y(btn, input, provider);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      toggleAiKeyVisibility(btn, input, provider);
    });
  });
}
