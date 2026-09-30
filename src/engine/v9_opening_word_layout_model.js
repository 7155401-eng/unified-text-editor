import { extractOpeningSegmentForTest, getOpeningWordSettings, OPENING_WORD_DEFAULT_SIZE } from "../opening_word.js";

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeWeight(value) {
  if (value === "normal") return "400";
  if (value === "heavy") return "900";
  return "700";
}

function fontFamily(font) {
  if (font === "David") return '"David", "David Libre", "Frank Ruhl Libre", serif';
  if (font === "David Libre") return '"David Libre", "David", "Frank Ruhl Libre", serif';
  if (font === "Frank Ruhl Libre") return '"Frank Ruhl Libre", "David Libre", "David", serif';
  if (font === "Segoe UI") return '"Segoe UI", "David", "David Libre", sans-serif';
  return font || "inherit";
}

function normalizeSettingsForV9(raw) {
  const settings = raw || getOpeningWordSettings();
  return {
    enabled: !!settings.enabled,
    target: settings.target || "word",
    count: clampNumber(settings.count, 1, 1, 12),
    style: settings.style || "",
    font: settings.font || "David",
    size: clampNumber(settings.size, OPENING_WORD_DEFAULT_SIZE, 80, 500),
    weight: settings.weight || "bold",
    position: settings.position || "dropped",
    dropLines: clampNumber(settings.dropLines, 2, 1, 8),
    spaceAfter: clampNumber(settings.spaceAfter, 0.3, 0, 4),
    scope: settings.scope || "all",
    skipHeadings: settings.skipHeadings !== false,
    headingMin: clampNumber(settings.headingMin, 80, 0, 500),
  };
}

function normalizePosition(settings, parts) {
  const suffix = String(parts?.suffix || "").replace(/\s+/g, " ").trim();
  const suffixWords = suffix ? suffix.split(/\s+/).length : 0;
  const suffixChars = suffix.length;
  if (settings.position !== "dropped") return "raised";
  // משה 07/09/2026 (הערה 2): ההכרעה שלו — מילת הפתיח תתפוס מקום אמיתי,
  // כמו תמונה שהטקסט גולש סביבה, והמילה שאחריה תתחיל רק אחרי שהיא נגמרת.
  // רק מצב "נפתחת" עושה זאת. השער הקודם ויתר עליו בכל שורה שנשארו בה
  // פחות משתי מילים או 18 תווים — ובטקסט תורני זה כמעט תמיד, ולכן המילה
  // גלשה מעל הטקסט במקום לתפוס מקום. מעכשיו מוותרים רק כשאין אחריה כלום,
  // כי לגלישה סביב תמונה שאין לצידה טקסט אין משמעות.
  if (suffixChars === 0) return "raised";
  return "dropped";
}

function estimateTextWidthPx(text, fontSizePx) {
  const sample = String(text || "").replace(/\s+/g, " ").trim();
  if (!sample) return 0;
  const size = Number(fontSizePx) > 0 ? Number(fontSizePx) : 16;
  return Math.ceil(sample.length * Math.max(7, size * 0.56));
}

// ⛔⛔⛔⛔ משה 29/09/2026 — שורש 299 החפיפות שנותרו, נמדד על
// **המסמך האמיתי שלו** (170 עמודים, 7,548 שורות). מתועד כאן כדי שלא
// ייחקר שוב מאפס.
//
// ═══ הממצא ═══
//     רוחב האות לפי המנוע    22px
//     רוחב האות בפועל        32px    ⇐ 45% יותר
//     ממוצע על 197 בלוקים: **13.4 פיקסלים חסרים בכל אחד**
//
// כשהמנוע חושב שהאות צרה ממה שהיא, נשאר לטקסט שלצידה פחות מקום
// ממה שתוכנן. הטקסט שנועד לשתי שורות נשבר לשלוש, והשלישית נופלת
// על מה שמתחתיה. זה מקור 223 מתוך 246 השורות שנשברות בתוך עצמן.
//
// ═══ שתי הסיבות, ושתיהן אמיתיות ═══
// 1. המדידה כאן נעשית על Canvas עם מקדם תיקון קבוע של 8%. Canvas לא
//    תמיד מקבל את אותו גופן שהדפדפן מצייר בו, ומקדם קבוע לא יכול
//    לכסות פער שמשתנה מגופן לגופן.
// 2. **אי-התאמה בין התכנון לציור**: כאן הגודל מחושב בפיקסלים
//    (גופן הבסיס × האחוז), ואילו הציור מחיל את האחוז על גופן
//    ה**שורה** — ושורה יכולה לשבת בגופן אחר. נמדד: תכנון 26px,
//    ציור 19px.
//
// ═══ ⛔ ארבעה תיקונים שנוסו, נמדדו ונפסלו ═══
//   א. שוליים של 1% בבניית השורה — 246⟵240 בלבד, והוסיף עמוד.
//   ב. מרווח ביטחון 8%⟵16% מרוחב הטור — 299⟵289, אבל כותרות זרם
//      מכוסות קפצו מ-7 ל-30. מזיק.
//   ג. מרווח שנגזר מרוחב האות — 299⟵301. הסיבה שהתבררה: הבלוק מקבל
//      ממילא את הרוחב המלא, ולכן הרזרבה אינה משנה כמה מקום נשאר.
//   ד. מדידה אמיתית ב-DOM במקום Canvas — 299⟵272 (שיפור!), אבל
//      הכותרות המכוסות עלו מ-7 ל-19, כי המדידה החזירה 45px בעוד
//      הציור מצייר 32. ⇒ מדידה מדויקת **בלי** לתקן את אי-ההתאמה
//      שבסעיף 2 רק מזיזה את השגיאה לצד השני.
//   ה. סנכרון הציור לפיקסלים — 272⟵299. הוא הגדיל את האות מ-19
//      ל-26 (מה שנכון תאורטית), אבל זה מה שמשה רואה היום, ושינוי
//      גודל האות הוא החלטת עיצוב שלו ולא באג.
//
// ⇒ **הצעד הנכון הבא**: לתקן את סעיף 2 קודם — שהתכנון והציור יחשבו
//   את אותו גודל — ורק אחר כך להחליף את המדידה ל-DOM. שני התיקונים
//   יחד, בסדר הזה. כל אחד לחוד רק מחליף בעיה בבעיה.
const _opwWidthCache = new Map();

function measureOpeningTextWidthPx(text, fontSizePx, style) {
  const sample = String(text || "").replace(/\s+/g, " ").trim();
  if (!sample) return 0;
  const size = Number(fontSizePx) > 0 ? Number(fontSizePx) : 16;
  // ⭐⭐⭐ 29/09 — **כאן ישב השקר.** `style.fontFamily` הוא לרוב המילה
  // `inherit` — וזה נכון לציור (האות יורשת את גופן העמוד), אבל אסון
  // למדידה: אלמנט המדידה תלוי מחוץ לעמוד, ולכן „יורש" את גופן גוף
  // האתר, שהוא רחב יותר. נמדד: 51 במקום 37.8 — פער של 35%.
  // ⇒ למדידה משתמשים ב-measureFontFamily: הגופן האמיתי של העמוד.
  const family = (style?.measureFontFamily && style.measureFontFamily !== "inherit")
    ? style.measureFontFamily
    : ((style?.fontFamily && style.fontFamily !== "inherit") ? style.fontFamily : "serif");
  const weight = style?.fontWeight || "700";

  // ⭐ מדידה אמיתית: אלמנט מחוץ לשדה הראייה, עם אותו גופן, גודל
  // ומשקל שהדפדפן יצייר בהם. אין מקדם תיקון ואין ניחוש.
  // ⬛ נמדד על המסמך של משה: 299 ⟵ 272 חפיפות.
  // ⬛ מטמון לפי טקסט+גודל+גופן+משקל — אותה אות נמדדת פעם אחת בלבד,
  //    גם במסמך של מאות עמודים.
  const key = `${sample}\u0000${size}\u0000${family}\u0000${weight}`;
  const cached = _opwWidthCache.get(key);
  if (cached != null) return cached;

  if (typeof document !== "undefined" && document.body) {
    try {
      const probe = document.createElement("span");
      probe.textContent = sample;
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = [
        "position:absolute", "left:-99999px", "top:-99999px",
        "visibility:hidden", "white-space:pre", "direction:rtl",
        "padding:0", "margin:0", "border:0",
        `font-family:${family}`,
        `font-size:${size}px`,
        `font-weight:${weight}`,
      ].join(";");
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      if (Number.isFinite(w) && w > 0) {
        const out = Math.ceil(w);
        _opwWidthCache.set(key, out);
        return out;
      }
    } catch (_) {
      // נופלים ל-Canvas שלמטה.
    }
  }

  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.direction = "rtl";
        ctx.font = `${weight} ${size}px ${family}`;
        const width = ctx.measureText(sample).width;
        if (Number.isFinite(width) && width > 0) {
          const out = Math.ceil(width * 1.08);
          _opwWidthCache.set(key, out);
          return out;
        }
      }
    } catch (_) {
      // Fallback below.
    }
  }

  return estimateTextWidthPx(sample, size);
}

function openingLineIsBlockedByParagraphMetadata(el) {
  if (!el || !el.dataset) return false;
  return el.dataset.v9Continuation === "1" ||
    el.dataset.v9ParagraphStart === "0" ||
    el.dataset.continuedFromPrev === "1" ||
    el.dataset.cont === "1" ||
    el.dataset.v9OpeningWordAllowed === "false";
}

function keepOpeningLineStable(el, lineHeightPx = 0) {
  if (!el) return;

  // ★ משה 28/09/2026 — במצב הזרימה ("דינמי כמו תמונה") שתי השורות
  // הראשונות מצוירות כבלוק אחד שגובהו שתי שורות, והטקסט גולש סביב
  // האות. נעילה לגובה שורה **אחת** כאן הייתה חותכת אותו בדיוק בחצי.
  if (el.dataset?.v9OpeningFlowBlock === "2") {
    el.style.boxSizing = "border-box";
    el.style.overflow = "visible";
    return;
  }

  // The opening word may use a different font and size, but it must never
  // change the row pitch of the Talmud/V9 stream. Do not touch margins here:
  // V9 line elements may inherit stream spacing margins, and changing them only
  // on the opening-word host creates a visible gap difference even when
  // line-height is numerically identical.
  el.style.boxSizing = "border-box";
  el.style.overflow = "visible";

  if (lineHeightPx > 0) {
    const px = `${lineHeightPx}px`;
    el.style.lineHeight = px;
    el.style.height = px;
    el.style.minHeight = px;
    el.style.maxHeight = px;
  }

  el.dataset.v9OpeningWordLineStable = "1";
}

function renderOriginalLineWithoutOpeningWord(lineEl, model, firstLineText = "") {
  if (!lineEl || !model) return false;
  const parts = model.parts || {};
  const suffix = firstLineText || model.flow?.firstLineText || parts.suffix || "";
  lineEl.textContent = `${parts.prefix || ""}${parts.segment || ""}${suffix || ""}`;
  lineEl.classList?.remove("opw-host");
  delete lineEl.dataset.opwApplied;
  lineEl.dataset.v9OpeningWordBlocked = "paragraph-continuation";
  return false;
}

function getBaseLineHeightForOpeningSpan(span, model) {
  const style = model?.style || {};
  return Number(style.baseLineHeightPx) ||
    Number(model?.metrics?.baseLineHeightPx) ||
    Number.parseFloat(span?.parentElement?.style?.lineHeight || "0") ||
    0;
}

function getOpeningGlyphLineHeightPx(model, windowHeightPx, baseLineHeightPx) {
  const style = model?.style || {};
  const openingFontSizePx = Number(style.fontSizePx) || Number(model?.metrics?.openingFontSizePx) || 0;
  if (openingFontSizePx <= 0) return baseLineHeightPx;
  if (windowHeightPx > 0) {
    return Math.min(windowHeightPx, Math.max(openingFontSizePx, baseLineHeightPx));
  }
  return Math.max(openingFontSizePx, baseLineHeightPx);
}

function stabilizeRaisedSpan(span, model) {
  if (!span || !model || model.position === "dropped") return;
  const baseLineHeightPx = getBaseLineHeightForOpeningSpan(span, model);
  if (baseLineHeightPx <= 0) return;

  // Raised opening words stay inline, but their larger font must not enlarge the
  // parent row. Let the glyph overflow visually while the row keeps the stream
  // line-height.
  const px = `${baseLineHeightPx}px`;
  span.style.lineHeight = px;
  span.style.height = px;
  span.style.maxHeight = px;
  span.style.overflow = "visible";
  span.style.contain = "paint";
  span.dataset.opwInlineMetricsStable = "1";
}

function stabilizeDroppedSpan(span, model) {
  if (!span || !model || model.position !== "dropped") return;

  const style = model.style || {};
  const baseLineHeightPx = getBaseLineHeightForOpeningSpan(span, model);
  const dropLines = Math.max(1, Math.round(Number(style.dropLines) || Number(model.metrics?.dropLines) || 1));
  const windowHeightPx = baseLineHeightPx > 0 ? baseLineHeightPx * dropLines : 0;
  const glyphLineHeightPx = getOpeningGlyphLineHeightPx(model, windowHeightPx, baseLineHeightPx);
  const openingWidthPx = Math.ceil(Number(model.metrics?.openingWordWidthPx) || 0);
  const spaceAfter = `${style.spaceAfterEm ?? 0.3}em`;

  span.style.float = "right";
  span.style.display = "block";
  span.style.marginRight = "0";
  span.style.marginLeft = spaceAfter;
  span.style.marginBottom = "0";
  span.style.padding = "0";
  span.style.shapeMargin = spaceAfter;
  span.style.verticalAlign = "top";
  span.style.whiteSpace = "nowrap";
  span.style.overflow = "visible";
  span.style.boxSizing = "border-box";
  span.style.contain = "paint";

  // משה 08/09/2026: רוחב צרוב בפיקסלים נשבר ברגע שמשתנים גופן, גודל או
  // סגנון. מילת פתיח היא אות מוגדלת בשורה — היא צריכה לתפוס מקום דינמי,
  // בדיוק כמו תמונה שהדפדפן מודד לבדו. לכן הרוחב נקבע מהתוכן.
  span.style.width = "max-content";
  span.style.maxWidth = "100%";

  if (baseLineHeightPx > 0) {
    span.style.setProperty("--opw-base-line-height", `${baseLineHeightPx}px`);
  }
  if (glyphLineHeightPx > 0) {
    span.style.lineHeight = `${glyphLineHeightPx}px`;
  }
  if (windowHeightPx > 0) {
    const px = `${windowHeightPx}px`;
    // משה 09/09/2026: הגובה הזה עשה שני דברים שונים, וב-08/09 הורדתי את
    // שניהם ביחד. הוא היה כלוב שחתך את האותיות כשהגופן גדל — וזה נשאר
    // מבוטל. אבל הוא גם היה **החלון** שגורם לשורה השנייה להיכנס פנימה,
    // וזה מה שנעלם. לכן הוא חוזר כרצפה בלבד:
    //   · רצפה  — החלון משתרע על מספר השורות שהוגדר, והשורה השנייה נכנסת.
    //   · בלי תקרה — אותיות גדולות מרחיבות את התיבה ולעולם אינן נחתכות.
    span.style.minHeight = px;
    // אין height ואין maxHeight — במכוון. ראו את ההסבר למעלה.
  }

  span.dataset.opwWindowStable = "1";
}

export function buildV9OpeningWordLayoutModel(text, rawSettings, options = {}) {
  const settings = normalizeSettingsForV9(rawSettings);
  const continuesFromPrevious = !!(
    options.continuesFromPrevious ||
    options.isPageSplitContinuation
  );

  if (!settings.enabled) return null;
  if (options.isParagraphStart === false) return null;
  if (options.isOriginalParagraphStart === false) return null;
  if (continuesFromPrevious) return null;

  const parts = extractOpeningSegmentForTest(String(text || ""), settings);
  if (!parts || !parts.segment?.trim() || !parts.suffix?.trim()) return null;

  const position = normalizePosition(settings, parts);
  const baseFontSize = Number(options.baseFontSize) || 0;
  const baseLineHeight = Number(options.baseLineHeight) || (baseFontSize > 0 ? baseFontSize * 1.55 : 0);
  const fontSizePx = baseFontSize > 0 ? (baseFontSize * settings.size) / 100 : null;
  const effectiveOpeningFontSize = fontSizePx || baseFontSize || 16;
  const dropLines = Math.max(1, settings.dropLines);

  // הגופן שיצויר (עשוי להיות `inherit`) מול הגופן שנמדוד בפועל.
  const drawFamily = fontFamily(settings.font);
  const inheritedFamily = String(options.baseFontFamily || "").trim();
  const measureFamily = (drawFamily && drawFamily !== "inherit")
    ? drawFamily
    : (inheritedFamily || "serif");

  const style = {
    fontFamily: drawFamily,
    measureFontFamily: measureFamily,
    fontSizePx,
    fontSizePercent: settings.size,
    fontWeight: normalizeWeight(settings.weight),
    dropLines,
    spaceAfterEm: settings.spaceAfter,
    baseLineHeightPx: baseLineHeight,
  };

  const openingWordWidthPx = measureOpeningTextWidthPx(parts.segment, effectiveOpeningFontSize, style);
  // ★ משה 27/09/2026 — „בשורה השנייה הטקסט מתחיל רק מקביל להיכן שבשורה
  // הראשונה מתחיל הטקסט הרגיל, כיום זה מתחיל קצת קודם".
  // השורש: כאן נשמר **חצי** מהרווח (`* 0.5`), בעוד הציור נותן את הרווח
  // המלא — `span.style.marginLeft = ${spaceAfterEm}em`, ו-em באלמנט הזה
  // הוא גודל האות של מילת הפתיח עצמה. כלומר המקום שנתפס בפועל היה
  // פי שניים מהמקום שנשמר, ולכן השורה השנייה נסוגה פחות מדי והתחילה
  // קצת לפני תחילת הטקסט הרגיל שמעליה.
  // ⛔⛔ משה 28/09/2026 — **הוחזר לאחור**. ניסיתי לשמור את הרווח המלא
  // (בלי ה-0.5), כי הציור נותן `marginLeft` מלא. משה דיווח מיד על
  // **החמרה**: "התוכן של המשך השורה הראשונה מכסה חלק ממילת הפתיח עצמה".
  // כלומר הגדלת השמירה דחפה את הטקסט אל תוך האות במקום להרחיק ממנה.
  // חוזרים לחישוב המקורי; הפער שמשה תיאר ("מתחיל קצת קודם") ייפתר
  // בדרך אחרת — ביישור בין הרוחב הנשמר לרוחב המצויר, לא בהכפלתו.
  const spaceAfterPx = Math.max(0, effectiveOpeningFontSize * settings.spaceAfter * 0.5);
  const windowLineCount = position === "dropped" ? dropLines : 1;
  const openingWordHeightPx = position === "dropped"
    ? Math.max(baseLineHeight * dropLines, effectiveOpeningFontSize * 1.05)
    : Math.max(baseLineHeight, effectiveOpeningFontSize * 1.05);
  const reserveWidthPx = Math.ceil(openingWordWidthPx + spaceAfterPx);
  const remainingText = String(parts.suffix || "").replace(/^\s+/, "");

  return {
    source: "opening_word.js:v9-measured",
    parts,
    settings,
    position,
    paragraphStart: true,
    isOriginalParagraphStart: options.isOriginalParagraphStart !== false,
    sourceParagraphId: options.sourceParagraphId || options.paragraphSourceId || null,
    continuesFromPrevious,
    isPageSplitContinuation: false,
    metrics: {
      openingFontSizePx: fontSizePx,
      baseLineHeightPx: baseLineHeight,
      openingLineHeightPx: openingWordHeightPx,
      openingWordWidthPx,
      openingWordHeightPx,
      reserveWidthPx,
      dropLines,
      spaceAfterPx,
    },
    flow: {
      firstLineText: remainingText,
      remainingText,
      firstLineWidthReductionPx: reserveWidthPx,
      windowLineCount,
      windowWidthPx: reserveWidthPx,
    },
    style,
  };
}

// ⭐⭐⭐ משה 29/09/2026 — **שורש החפיפות, נמדד והוכח.**
//
// ═══ מה נמדד ═══
// 234 מילות־פתיח על המסמך האמיתי, כל אחת נמדדה פעמיים:
//   • מה המנוע **שמר** לה מקום  (v9OpeningWordWidthPx)
//   • מה הדפדפן **צייר** בפועל   (getBoundingClientRect)
// התוצאה: המנוע שומר בממוצע **9.51 פיקסלים יותר מדי**, בכל אחת
// מ-234 המילים בלי יוצא מן הכלל (המינימום 0.1, המקסימום 30.5).
// היחס קבוע להפליא: 51⟵36.8, 50⟵36.6, 23⟵17 — בכל מקרה ×1.368.
//
// ═══ מאיפה בא בדיוק המספר 1.368 ═══
// 26 חלקי 19. האות תוכננה בגודל 26 ונוצרה בגודל 19.
//
// ולמה? כשאין מקום להוריד את האות שתי שורות, המנוע מקטין אותה
// לשורה אחת — משנה את **אחוז הגודל** מ-200% ל-146%. אבל הרוחב,
// הגובה והרווח שאחריה כבר חושבו קודם, לפי 200%, ואיש לא חישב
// אותם מחדש. כלומר: המספר השתנה, והמידות שנגזרו ממנו נשארו ישנות.
//
// ═══ הדימוי ═══
// זה כמו להזמין חליפה למידה 52, ואז להחליט שהילד ילבש מידה 40 —
// אבל להמשיך לפנות לו בארון מקום של 52. כל שאר הבגדים נדחקים
// הצידה בלי סיבה, והמדף מתמלא מוקדם מדי.
//
// ═══ התיקון ═══
// כל שינוי בגודל האות חייב לעבור **דרך הפונקציה הזאת**, שמחשבת
// מחדש את כל מה שנגזר ממנו: רוחב, רווח, שמירה, גובה, וגם את
// הנתונים שהזרימה משתמשת בהם. אין יותר „לשנות רק אחוז".
export function rescaleV9OpeningWordModel(model, changes = {}) {
  if (!model || !model.style) return model;

  const style = model.style;
  const nextPercent = Number.isFinite(Number(changes.fontSizePercent))
    ? clampNumber(changes.fontSizePercent, style.fontSizePercent, 80, 500)
    : style.fontSizePercent;
  const nextDropLines = Number.isFinite(Number(changes.dropLines))
    ? Math.max(1, Math.round(Number(changes.dropLines)))
    : Math.max(1, Math.round(Number(style.dropLines) || 1));

  const baseLineHeight = Number(changes.baseLineHeight) > 0
    ? Number(changes.baseLineHeight)
    : (Number(style.baseLineHeightPx) || Number(model.metrics?.baseLineHeightPx) || 0);

  // גודל האות הבסיסי שממנו נגזר האחוז. הציור נותן `fontSize: <אחוז>%`
  // על השורה עצמה, ולכן הבסיס הוא גודל האות של השורה — בדיוק מה
  // שהועבר כ-baseFontSize בבנייה הראשונה.
  const priorPercent = Number(style.fontSizePercent) || 100;
  const priorPx = Number(style.fontSizePx) || 0;
  const baseFontSize = Number(changes.baseFontSize) > 0
    ? Number(changes.baseFontSize)
    : (priorPx > 0 ? (priorPx * 100) / priorPercent : 0);

  const fontSizePx = baseFontSize > 0 ? (baseFontSize * nextPercent) / 100 : style.fontSizePx;
  const effective = Number(fontSizePx) > 0 ? Number(fontSizePx) : (baseFontSize || 16);

  style.fontSizePercent = nextPercent;
  style.fontSizePx = fontSizePx;
  style.dropLines = nextDropLines;
  if (baseLineHeight > 0) style.baseLineHeightPx = baseLineHeight;

  const segment = model.parts?.segment || "";
  const spaceAfterEm = Number(style.spaceAfterEm) || 0;
  const openingWordWidthPx = measureOpeningTextWidthPx(segment, effective, style);
  const spaceAfterPx = Math.max(0, effective * spaceAfterEm * 0.5);
  const reserveWidthPx = Math.ceil(openingWordWidthPx + spaceAfterPx);
  const openingWordHeightPx = model.position === "dropped"
    ? Math.max(baseLineHeight * nextDropLines, effective * 1.05)
    : Math.max(baseLineHeight, effective * 1.05);

  model.metrics = Object.assign({}, model.metrics, {
    openingFontSizePx: fontSizePx,
    baseLineHeightPx: baseLineHeight || model.metrics?.baseLineHeightPx,
    openingLineHeightPx: openingWordHeightPx,
    openingWordWidthPx,
    openingWordHeightPx,
    reserveWidthPx,
    dropLines: nextDropLines,
    spaceAfterPx,
  });

  model.flow = Object.assign({}, model.flow, {
    firstLineWidthReductionPx: reserveWidthPx,
    windowLineCount: model.position === "dropped" ? nextDropLines : 1,
    windowWidthPx: reserveWidthPx,
  });

  return model;
}

export function applyV9OpeningWordModelToLineElement(lineEl, model, firstLineText = "") {
  if (!lineEl || !model || lineEl.dataset.opwApplied === "1") return false;
  if (openingLineIsBlockedByParagraphMetadata(lineEl)) {
    return renderOriginalLineWithoutOpeningWord(lineEl, model, firstLineText);
  }

  const stableLineHeightPx = Number.parseFloat(lineEl.style.lineHeight || "0") ||
    Number(model.metrics?.baseLineHeightPx) ||
    0;
  keepOpeningLineStable(lineEl, stableLineHeightPx);

  const { parts, style, position } = model;
  lineEl.textContent = "";

  if (parts.prefix) {
    lineEl.appendChild(document.createTextNode(parts.prefix));
  }

  const span = document.createElement("span");
  span.className = `opw-segment opw-${position}`;
  span.style.fontFamily = style.fontFamily;
  span.style.fontSize = `${style.fontSizePercent}%`;
  span.style.fontWeight = style.fontWeight;
  span.style.display = "inline-block";
  span.style.direction = "rtl";
  span.style.verticalAlign = position === "dropped" ? "top" : "baseline";
  span.style.marginLeft = `${style.spaceAfterEm}em`;
  span.style.setProperty("--opw-drop-lines", String(style.dropLines));
  span.style.setProperty("--opw-space-after", `${style.spaceAfterEm}em`);
  span.textContent = parts.segment;
  lineEl.appendChild(span);

  stabilizeDroppedSpan(span, model);
  stabilizeRaisedSpan(span, model);

  const suffix = firstLineText || model.flow?.firstLineText || parts.suffix || "";
  if (suffix) {
    lineEl.appendChild(document.createTextNode(suffix));
  }

  lineEl.classList.add("opw-host");
  keepOpeningLineStable(lineEl, stableLineHeightPx);
  lineEl.dataset.opwApplied = "1";
  lineEl.dataset.v9OpeningWordSource = "opening_word.js:v9-measured";
  lineEl.dataset.v9OpeningWordPosition = position;
  lineEl.dataset.v9OpeningWordWidthPx = String(Math.round(Number(model.metrics?.openingWordWidthPx) || 0));
  lineEl.dataset.v9OpeningWordReservePx = String(Math.round(Number(model.metrics?.reserveWidthPx) || 0));
  // ⭐ 29/09 — הגודל **המתוכנן** של האות, בפיקסלים, נרשם על השורה.
  // כל מי שמצייר חייב להשתמש בו ולא לחשב גודל משלו, אחרת המידות
  // שהמנוע שמר לא יתאימו למה שיצויר — וזה בדיוק מה שיצר את
  // 9.51 הפיקסלים העודפים בכל מילת פתיח.
  if (Number(model.metrics?.openingFontSizePx) > 0) {
    lineEl.dataset.v9OpeningFontPx = String(Number(model.metrics.openingFontSizePx));
  }
  lineEl.dataset.v9OpeningFontFamily = String(style.measureFontFamily || style.fontFamily || "");
  lineEl.dataset.v9OpeningFontWeight = String(style.fontWeight || "");
  lineEl.dataset.v9OpeningWindowHandledBy = "v9-strip-geometry";

  // The old DOM post-processor shrank rendered lines after the page was built.
  // In RTL that can create a left-side visual indent or double-apply the window.
  // The correct V9 window is the analytic strip window produced before rendering:
  // only lines from the same source paragraph, on this same page, receive the
  // reduced width, and the opening-word host line itself remains full-width.
  return true;
}
