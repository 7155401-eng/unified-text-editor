import assert from "node:assert";
import { getLang, setLang, toggleLang, t, isRTL } from "./sefaria_i18n.js";

// Mock localStorage
let storage = {};
global.localStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = String(value); },
  removeItem: (key) => { delete storage[key]; },
  clear: () => { storage = {}; }
};

console.log("\n=== Starting sefaria_i18n.js tests ===");

// --- Testing setLang / getLang core ---
localStorage.clear();
assert.strictEqual(getLang(), "he", "getLang should default to 'he'");

setLang("en");
assert.strictEqual(getLang(), "en", "setLang('en') should set lang to 'en'");

setLang("he");
assert.strictEqual(getLang(), "he", "setLang('he') should set lang to 'he'");

setLang("invalid");
assert.strictEqual(getLang(), "he", "setLang('invalid') should default to 'he'");

setLang("EN");
assert.strictEqual(getLang(), "he", "setLang('EN') (uppercase) should default to 'he'");
console.log("  ✓ setLang / getLang core tests passed");

// --- Testing localStorage error handling ---
const originalSetItem = localStorage.setItem;
const originalGetItem = localStorage.getItem;

localStorage.setItem = () => { throw new Error("quota exceeded"); };
// Should not throw
setLang("en");
console.log("  ✓ setLang handles setItem error");

localStorage.getItem = () => { throw new Error("security error"); };
assert.strictEqual(getLang(), "he", "getLang should return 'he' when getItem throws");
console.log("  ✓ getLang handles getItem error");

localStorage.setItem = originalSetItem;
localStorage.getItem = originalGetItem;

// --- Testing toggleLang ---
setLang("he");
assert.strictEqual(toggleLang(), "en", "toggleLang he -> en");
assert.strictEqual(getLang(), "en", "getLang after toggle -> en");

assert.strictEqual(toggleLang(), "he", "toggleLang en -> he");
assert.strictEqual(getLang(), "he", "getLang after toggle -> he");
console.log("  ✓ toggleLang tests passed");

// --- Testing isRTL ---
setLang("he");
assert.strictEqual(isRTL(), true, "isRTL should be true for 'he'");
setLang("en");
assert.strictEqual(isRTL(), false, "isRTL should be false for 'en'");
console.log("  ✓ isRTL tests passed");

// --- Testing t (translation) ---
setLang("he");
const heTitle = t("downloader_title");
assert.ok(heTitle.includes("טעינת ספר"), "t should return Hebrew by default");

setLang("en");
const enTitle = t("downloader_title");
assert.ok(enTitle.includes("Book Loader"), "t should return English when lang is 'en'");

const missingKey = t("non_existent_key");
assert.strictEqual(missingKey, "non_existent_key", "t should return key if missing");

const interpolation = t("status_saved", { path: "/test/path" });
assert.ok(interpolation.includes("/test/path"), "t should handle parameter interpolation");
console.log("  ✓ translation (t) tests passed");

console.log("\nAll sefaria_i18n.js tests passed successfully.");
