// משה 2026-05-09: ניהול מפתחות AI לכמה ספקים בו זמנית.
// כל מפתח נשמר אצל המשתמש בלבד (localStorage), לא נשלח לשרת שלנו.
// תאימות לאחור: אם קיים `ravtext.ai.apiKey` ישן עם ערך, ממירים אותו לסלוט של
// `ravtext.ai.provider` (ברירת המחדל הישנה) ומוחקים את המפתח הישן.
//
// מפתח ה-localStorage לכל ספק: `ravtext.ai.apiKey.<provider>`
// מפתח ספק ברירת המחדל: `ravtext.ai.provider`

const PROVIDERS = ["anthropic", "openai", "google", "mistral", "groq", "deepseek"];
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

  // כפתורי הצג/הסתר
  const toggles = document.querySelectorAll(".ai-key-toggle[data-toggle-for]");
  toggles.forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const provider = btn.getAttribute("data-toggle-for");
      const input = document.querySelector(`.ai-key-input[data-provider="${provider}"]`);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
    });
  });
}
