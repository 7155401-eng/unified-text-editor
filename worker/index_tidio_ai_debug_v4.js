import app from './index_tidio_ai_debug_v3.js';

function clarifyAiKeyText(html) {
  const oldPrimary = 'ניתן לשמור מפתחות של כמה ספקים בו זמנית. כל מפתח נשמר אצלך בדפדפן בלבד (לא נשלח לשרת שלנו). ספק ברירת המחדל הוא הספק שייעשה בו שימוש כשלא מוגדר אחר.';
  const newPrimary = 'ניתן לשמור מפתחות של כמה ספקים בו זמנית. המפתח נשמר אצלך בדפדפן, ובזמן הפעלת כלי AI הוא נשלח דרך השרת רק לצורך הקריאה לספק ואינו נשמר אצלנו. ספק ברירת המחדל הוא הספק שייעשה בו שימוש כשלא מוגדר אחר.';

  const oldFooter = 'המפתחות נשמרים אצלך בלבד. המנוי לרב טקסט אינו כולל גישה למודלי AI — את המפתחות יש להוציא ישירות מהספקים.';
  const newFooter = 'המפתחות נשמרים בדפדפן שלך, ונשלחים דרך השרת רק בזמן הפעלת כלי AI לצורך הקריאה לספק. המפתח אינו נשמר אצלנו. המנוי לרב טקסט אינו כולל גישה למודלי AI — את המפתחות יש להוציא ישירות מהספקים.';

  return String(html || '')
    .replace(oldPrimary, newPrimary)
    .replace(
      /כל מפתח נשמר אצלך בדפדפן\s*בלבד\s*\(לא נשלח לשרת שלנו\)\.\s*ספק ברירת המחדל הוא הספק שייעשה בו שימוש\s*כשלא מוגדר אחר\./g,
      'המפתח נשמר אצלך בדפדפן, ובזמן הפעלת כלי AI הוא נשלח דרך השרת רק לצורך הקריאה לספק ואינו נשמר אצלנו. ספק ברירת המחדל הוא הספק שייעשה בו שימוש כשלא מוגדר אחר.'
    )
    .replace(oldFooter, newFooter)
    .replace(
      /המפתחות נשמרים אצלך בלבד\.\s*המנוי לרב טקסט אינו כולל גישה למודלי AI\s*—\s*את המפתחות יש להוציא ישירות מהספקים\./g,
      newFooter
    );
}

async function clarifyHtmlResponse(response) {
  const headers = new Headers(response.headers);
  const contentType = headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html') || response.status >= 400) {
    return response;
  }

  const html = await response.text();
  const nextHtml = clarifyAiKeyText(html);
  if (nextHtml === html) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(nextHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    return clarifyHtmlResponse(response);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
