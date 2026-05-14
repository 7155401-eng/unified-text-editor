// Service worker מינימלי ל-PWA רב טקסט.
// תפקידו היחיד הוא לאפשר התקנה ככרום עצמאי (Chrome מצריך SW פעיל
// כדי להפעיל את אירוע beforeinstallprompt). הוא לא מטמין כלום ולא
// משנה תגובות — כל בקשה עוברת רגיל לרשת.

self.addEventListener("install", (event) => {
  // הפעלה מיידית ללא המתנה לסגירת לשוניות ישנות
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — לא מטמין, רק מאפשר installability.
self.addEventListener("fetch", (event) => {
  // אין דרישה ל-event.respondWith — הדפדפן ימשיך כרגיל ברשת.
});
