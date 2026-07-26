// תרגום שגיאות תמלול להודעות ידידותיות.
// שומר פירוט מלא כאשר השרת מחזיר ai_tool_detailed_error/debug_id.

function asText(value) {
  return value == null ? '' : String(value);
}

function withDebugSuffix(message, errText) {
  const debugMatch = asText(errText).match(/debug_id=([a-zA-Z0-9._:-]+)/) || asText(errText).match(/"debug_id"\s*:\s*"([^"]+)"/);
  const debugId = debugMatch ? debugMatch[1] : '';
  if (!debugId || message.includes(debugId)) return message;
  return `${message}\n\nמזהה שגיאה לבדיקה: ${debugId}`;
}

export function friendlyError(errText) {
  const raw = asText(errText);
  const s = raw.toLowerCase();

  // חשוב: לא להסתיר שגיאות מפורטות שהשרת כבר הכין.
  // בעבר הן נבלעו תחת "מפתח API לא תקין" בגלל 401/403.
  if (
    s.includes('ai_tool_detailed_error') ||
    s.includes('detailed ai error log') ||
    s.includes('debug_id=') ||
    s.includes('"debug_id"') ||
    s.includes('error_details') ||
    s.includes('x-ravtext-debug-id')
  ) {
    return {
      title: 'שגיאת כלי AI מפורטת',
      message: raw,
    };
  }

  if (
    (s.includes('elevenlabs') || s.includes('eleven labs')) &&
    (
      s.includes('invalid_api_key') || s.includes('invalid api key') || s.includes('api_key_invalid') ||
      s.includes('401') || s.includes('403') || s.includes('unauthorized')
    )
  ) {
    return {
      title: 'מפתח ElevenLabs חסר או לא תקין',
      message:
        'השירות הנוסף של ElevenLabs הופעל, אבל מפתח ElevenLabs חסר, שגוי או חסום.\n\n' +
        'מה לעשות:\n' +
        '• ודא שהוזן מפתח ElevenLabs תקין בשדה ElevenLabs.\n' +
        '• ודא שהחשבון ב־ElevenLabs פעיל וכולל הרשאה לשירות הנדרש.\n' +
        '• שים לב: מפתח Gemini לא מתאים לשירות ElevenLabs.',
    };
  }

  if (s.includes('credit balance is too low') || s.includes('purchase credits')) {
    return {
      title: 'נגמרה היתרה ב־Claude',
      message:
        'החשבון של Anthropic מחזיר שאין יתרת קרדיטים.\n\n' +
        'יש לבדוק חיוב/קרדיטים בחשבון Anthropic או לבחור Gemini בלבד.',
    };
  }

  if (s.includes('insufficient_balance')) {
    return {
      title: 'אין מספיק נקודות בחשבון',
      message:
        'נגמרו הנקודות בחשבון הפנימי.\n\n' +
        'פנה לרכישת נקודות נוספות.',
    };
  }

  if (s.includes('invalid_access_code') || s.includes('invalid access code')) {
    return {
      title: 'קוד גישה לא תקין',
      message:
        'קוד הגישה שהוזן לא תקין או חסום.\n\n' +
        'בדוק שהקוד הועתק במלואו ללא רווחים.',
    };
  }

  if (s.includes('invalid_api_key') || s.includes('invalid api key') || s.includes('api_key_invalid')) {
    return {
      title: 'מפתח API לא תקין',
      message:
        'המפתח שהוזן לא תקין או לא מתאים לספק שנבחר.\n\n' +
        'בדוק שהמפתח נשמר בשדה הנכון: Gemini / Claude / ElevenLabs, ושאין רווחים מיותרים.',
    };
  }

  if (s.includes('rate limit') || s.includes('429') || s.includes('ai_quota_exceeded') || s.includes('quota') || s.includes('resource_exhausted')) {
    return {
      title: 'חרגת ממכסה זמנית',
      message:
        'הספק החזיר מגבלת שימוש או מכסה זמנית.\n\n' +
        'המתן כמה דקות ונסה שוב, או בדוק את המכסה/החיוב אצל ספק ה־AI.',
    };
  }

  if (s.includes('timeout') || s.includes('deadline exceeded') || s.includes('504')) {
    return {
      title: 'הזמן הסתיים',
      message:
        'השרת לא הספיק לסיים את הפעולה בזמן.\n\n' +
        'נסה קובץ קטן יותר, המרה ל־MP3, או פחות מחזורים.',
    };
  }

  if (s.includes('too large') || s.includes('413')) {
    return {
      title: 'הקובץ גדול מדי',
      message:
        'הבקשה גדולה מדי לשליחה.\n\n' +
        'הקטן את הקובץ או המר אותו לפורמט דחוס יותר.',
    };
  }

  if (
    s.includes('connection') || s.includes('network') || s.includes('dns') ||
    s.includes('proxy_fetch_failed') || s.includes('failed to fetch') ||
    s.includes('fetch failed') || s.includes('load failed') ||
    s.includes('getaddrinfo') || s.includes('err_internet') ||
    s.includes('err_connection') || s.includes('err_name_not_resolved') ||
    s.includes('err_network') || s.includes('err_timed_out') ||
    s.includes('שגיאת חיבור')
  ) {
    return {
      title: 'תקלה ברשת',
      message:
        'לא הצלחנו להגיע לשרת או לספק.\n\n' +
        'בדוק חיבור אינטרנט. אם אתה מאחורי סינון, ייתכן שהסינון חוסם את הקריאה. נסה שוב, ואם זה חוזר שלח את מזהה השגיאה.',
    };
  }

  if (s.includes('500') || s.includes('502') || s.includes('503') || s.includes('504')) {
    return {
      title: 'שרת לא זמין כרגע',
      message: withDebugSuffix('השרת או ספק ה־AI החזיר שגיאה זמנית. נסה שוב בעוד כמה דקות.', raw),
    };
  }

  if (s.includes('401') || s.includes('unauthorized') || s.includes('403') || s.includes('permission_denied')) {
    return {
      title: 'אין הרשאה',
      message: withDebugSuffix('המפתח או החשבון לא הורשו לבצע את הפעולה הזו.', raw),
    };
  }

  return {
    title: 'שגיאה',
    message: raw || 'אירעה שגיאה לא ידועה.',
  };
}
