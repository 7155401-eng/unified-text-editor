// תרגום שגיאות טכניות מהשרת לעברית פשוטה.

export function friendlyError(errText) {
  // מקבל טקסט שגיאה ומחזיר {title, message} בעברית.
  const s = (errText || "").toLowerCase();

  if (
    (s.includes("elevenlabs") || s.includes("eleven labs")) &&
    (s.includes("invalid_api_key") || s.includes("invalid api key") || s.includes("api_key_invalid") ||
     s.includes("401") || s.includes("403") || s.includes("unauthorized"))
  ) {
    return {
      title: "מפתח ElevenLabs חסר או לא תקין",
      message:
        "השירות הנוסף של ElevenLabs הופעל, אבל מפתח ElevenLabs חסר, שגוי או חסום.\n\n" +
        "מה לעשות:\n" +
        "• חזור לשלב 'חשבון' והזן מפתח ElevenLabs תקין.\n" +
        "• או חזור לשלב ההגדרות והסר את השירות הנוסף של ElevenLabs.\n\n" +
        "התמלול הרגיל דרך Gemini לא דורש מפתח ElevenLabs.",
    };
  }

  if (s.includes("credit balance is too low") || s.includes("purchase credits")) {
    return {
      title: "נגמרה היתרה ב-Claude",
      message:
        "החשבון שלך אצל Anthropic נגמרו בו הקרדיטים.\n\n" +
        "מה לעשות:\n" +
        "• היכנס ל-https://console.anthropic.com/settings/billing\n" +
        "• הוסף אמצעי תשלום או טען קרדיטים\n" +
        "• ואז נסה שוב",
    };
  }
  if (s.includes("insufficient_balance")) {
    return {
      title: "אין מספיק נקודות בחשבון",
      message:
        "נגמרו הנקודות בחשבון הפרמיום שלך.\n\n" +
        "פנה לרכישת נקודות נוספות.",
    };
  }

  if (s.includes("invalid_access_code") || s.includes("invalid access code")) {
    return {
      title: "קוד גישה לא תקין",
      message:
        "הקוד שהזנת לא תקין או חסום.\n\n" +
        "בדוק שהוא הועתק במלואו ללא רווחים.",
    };
  }

  if (s.includes("invalid_api_key") || s.includes("invalid api key") || s.includes("api_key_invalid")) {
    return {
      title: "מפתח API לא תקין",
      message:
        "המפתח שהזנת לא תקין או פג תוקפו.\n\nצור מפתח חדש והזן אותו במסך 'חשבון'.",
    };
  }

  if (s.includes("rate limit") || s.includes("429") || s.includes("ai_quota_exceeded")) {
    return {
      title: "חרגת ממכסה זמנית",
      message:
        "המתן 1–2 דקות ונסה שוב.\n\nאם זה חוזר — שדרג את החשבון אצל הספק.",
    };
  }
  if (s.includes("timeout") || s.includes("deadline exceeded")) {
    return {
      title: "זמן ההמתנה תם",
      message:
        "השרת לא הגיב בזמן.\n\n" +
        "בדוק את חיבור האינטרנט.\n" +
        "אם הקובץ גדול מאוד — נסה לפצל אותו.",
    };
  }
  // תקלת רשת — כולל הודעות הכשל של הדפדפנים השונים ושל ה-proxy בשרת.
  // כרום: "Failed to fetch"; ספארי: "Load failed"; פיירפוקס: "NetworkError";
  // ה-worker שלנו מחזיר "proxy_fetch_failed" כשלא הצליח להגיע ל-Apps Script;
  // ו-GasNetworkError שלנו מוסיף את הקידומת "שגיאת חיבור".
  if (
    s.includes("connection") || s.includes("network") || s.includes("dns") ||
    s.includes("proxy_fetch_failed") || s.includes("failed to fetch") ||
    s.includes("fetch failed") || s.includes("load failed") ||
    s.includes("getaddrinfo") || s.includes("err_internet") ||
    s.includes("err_connection") || s.includes("err_name_not_resolved") ||
    s.includes("err_network") || s.includes("err_timed_out") ||
    s.includes("שגיאת חיבור")
  ) {
    return {
      title: "תקלת רשת",
      message:
        "לא הצלחנו להגיע לשרת.\n\n" +
        "• בדוק שיש חיבור אינטרנט תקין.\n" +
        "• אם אתה מחובר דרך סינון (כמו נטפרי) — ייתכן שהסינון חוסם את השרת. " +
        "נסה שוב פעם-פעמיים; אם זה חוזר, פנה אלינו כדי שנבדוק.\n" +
        "• אם הקובץ גדול מאוד — נסה לפצל אותו לחלקים קטנים יותר.",
    };
  }
  if (s.includes("500") || s.includes("502") || s.includes("503") || s.includes("504")) {
    return { title: "שרת לא זמין כרגע", message: "המתן כמה דקות ונסה שוב." };
  }

  if (s.includes("too large") || s.includes("413")) {
    return {
      title: "הקובץ גדול מדי",
      message: "פצל את הקובץ לחלקים קטנים יותר ונסה שוב.",
    };
  }
  if (s.includes("401") || s.includes("unauthorized") || s.includes("403") || s.includes("permission_denied")) {
    return { title: "אין הרשאה", message: "המפתח לא הורשה לפעולה הזאת." };
  }

  return { title: "שגיאה", message: errText };
}
