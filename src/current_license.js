export function hasCurrentAppLicense() {
  try {
    const auth = typeof window !== "undefined" ? window.__RAVTEXT_AUTH__ : null;
    return !!(auth && auth.paid);
  } catch (e) {
    return false;
  }
}
