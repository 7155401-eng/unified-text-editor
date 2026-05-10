// תרגום שגיאות טכניות מהשרת לעברית פשוטה.

export function friendlyError(errText) {
  // מקבל טקסט שגיאה ומחזיר {title, message} בעברית.
  const s = (errText || "").toLowerCase();

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

  if (s.includes("connection") || s.includes("network") || s.includes("dns")) {
    return { title: "תקלת רשת", message: "לא הצלחנו להגיע לשרת. בדוק את חיבור האינטרנט." };
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
