// Service worker self-cleanup.
//
// משה 2026-05-14: ה-SW הזה גרם לתוכן מטמון להישאר אצל משתמשים גם כשהקוד
// בשרת התעדכן. במקום להמשיך לרשום SW דביק, אנחנו עושים cleanup חד-פעמי:
// - על install: מדלגים על המתנה (skipWaiting) כדי שיופעל מיד
// - על activate: מוחקים את כל ה-Caches API entries, מבטלים את הרישום של
//   עצמנו, ושולחים לכל ה-clients הודעת reload כדי שיטענו קוד טרי מהשרת.
//
// אחרי שכל המשתמשים עברו דרך זה פעם אחת, הם לא יחזרו ל-SW דביק. אם בעתיד
// נרצה PWA installability נוסיף SW על כתובת חדשה (/sw-v2.js וכו') שלא
// מתנגש עם ה-cleanup הזה.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // 1. מחיקת כל הקאשים מ-Cache Storage API.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}

    // 2. תפיסת בעלות על clients פתוחים כדי שנוכל לשלוח להם הודעה.
    try { await self.clients.claim(); } catch (_) {}

    // 3. ביטול הרישום של ה-SW הזה. החל מהבקשה הבאה, הדפדפן לא יעבור דרכו.
    try { await self.registration.unregister(); } catch (_) {}

    // 4. שליחת הודעת reload לכל ה-clients כדי שיטענו קוד טרי בלי SW.
    try {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        try { client.postMessage({ type: "ravtext-sw-cleanup-reload" }); } catch (_) {}
      }
    } catch (_) {}
  })());
});

// Pass-through fetch — לא מטמין כלום, ומאפשר ל-cleanup הזה לרוץ.
self.addEventListener("fetch", (event) => {
  // אין respondWith — הדפדפן ממשיך לרשת כרגיל.
});
