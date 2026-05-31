// העתקת סגנונות מהחשבון שלך ב-app.ravtext.com לסביבה המקומית.
//
// שימוש:
//   1) פתח את app.ravtext.com בדפדפן הרגיל (במצב מחובר).
//   2) פתח כלי מפתחים (F12) → לשונית Console.
//   3) הדבק את כל הקוד כאן ו-Enter.
//   4) ייווצר ויירד קובץ "ravtext-styles-from-server.json".
//   5) במחשב המקומי, לחץ על הכפתור "📥 ייבא סגנונות מהשרת" בכותרת
//      העורך והעלה את הקובץ הזה.
//
// הסקריפט אוסף את כל מפתחות ravtext.* מ-localStorage (כולל סגנונות,
// העדפות, רשימות פונטים) — אבל מסנן מפתחות סודיים (API keys וכו'),
// כמו שמנגנון הסנכרון של השרת עושה ממילא.

(function(){
  if (location.hostname.indexOf('ravtext.com') === -1 && location.hostname !== 'app.ravtext.com') {
    if (!confirm('הסקריפט מיועד ל-app.ravtext.com. להמשיך בכל זאת?')) return;
  }

  var BLACKLIST_EXACT = {
    'ravtext.ai.apiKey': 1,
    'ravtext.demo.blockedUntil': 1,
    'ravtext.demoMode': 1,
    'ravtext.caricature.gemini_api_key': 1,
    'ravtext.torah_transcription.config': 1,
  };
  var BLACKLIST_PREFIXES = [
    'ravtext.ai.apiKey.',
    'ravtext.caricature.',
    'ravtext.torah_transcription.',
  ];

  function blocked(k){
    if (BLACKLIST_EXACT[k]) return true;
    for (var i = 0; i < BLACKLIST_PREFIXES.length; i++) {
      if (k.indexOf(BLACKLIST_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  var out = {};
  var n = 0;
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (!k || k.indexOf('ravtext.') !== 0) continue;
    if (blocked(k)) continue;
    out[k] = localStorage.getItem(k);
    n++;
  }

  var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'ravtext-styles-from-server.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);

  console.log('[ravtext] ' + n + ' keys exported into ravtext-styles-from-server.json');
  alert('ירדו ' + n + ' הגדרות / סגנונות. כעת העבר את הקובץ למחשב המקומי שלך וטען אותו בכפתור "📥 ייבא סגנונות מהשרת".');
})();
