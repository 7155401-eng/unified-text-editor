export const FREE_LIMIT_TORAH_OR = 500;

export function getAuthState() {
  return window.__RAVTEXT_AUTH__ || {};
}

export function isFreeUser() {
  const auth = getAuthState();
  return !!auth.loggedIn && !auth.paid;
}

export function trimTorahOrTextForFreeUser(text, { notify = true } = {}) {
  const value = String(text || "");
  if (!isFreeUser() || value.length <= FREE_LIMIT_TORAH_OR) {
    return { text: value, truncated: false, originalLength: value.length };
  }
  if (notify) {
    window.alert("הטקסט נחתך לאחר 500 תוים עקב הגבלת 500 תוים למשתמש חינמי");
  }
  return {
    text: value.slice(0, FREE_LIMIT_TORAH_OR),
    truncated: true,
    originalLength: value.length,
  };
}
