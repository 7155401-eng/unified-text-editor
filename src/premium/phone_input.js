// משה 2026-05-09: קומפוננט טלפון עם בורר מדינות. ברירת מחדל = ישראל.
// קלט מקובל: 0521234567 (מקומי לישראל). המערכת מנרמלת ל-E.164 בשרת.
// אפשר לבחור מדינה אחרת מתוך רשימה — דגל + שם + dial code.

export const COUNTRIES = [
  { code: "IL", name: "ישראל",        flag: "🇮🇱", dial: "972" },
  { code: "US", name: "ארה״ב",        flag: "🇺🇸", dial: "1"   },
  { code: "CA", name: "קנדה",         flag: "🇨🇦", dial: "1"   },
  { code: "GB", name: "בריטניה",      flag: "🇬🇧", dial: "44"  },
  { code: "FR", name: "צרפת",         flag: "🇫🇷", dial: "33"  },
  { code: "BE", name: "בלגיה",        flag: "🇧🇪", dial: "32"  },
  { code: "DE", name: "גרמניה",       flag: "🇩🇪", dial: "49"  },
  { code: "CH", name: "שוויץ",        flag: "🇨🇭", dial: "41"  },
  { code: "AT", name: "אוסטריה",      flag: "🇦🇹", dial: "43"  },
  { code: "NL", name: "הולנד",        flag: "🇳🇱", dial: "31"  },
  { code: "IT", name: "איטליה",       flag: "🇮🇹", dial: "39"  },
  { code: "ES", name: "ספרד",         flag: "🇪🇸", dial: "34"  },
  { code: "AU", name: "אוסטרליה",     flag: "🇦🇺", dial: "61"  },
  { code: "NZ", name: "ניו זילנד",    flag: "🇳🇿", dial: "64"  },
  { code: "AR", name: "ארגנטינה",     flag: "🇦🇷", dial: "54"  },
  { code: "BR", name: "ברזיל",        flag: "🇧🇷", dial: "55"  },
  { code: "MX", name: "מקסיקו",       flag: "🇲🇽", dial: "52"  },
  { code: "ZA", name: "דרום אפריקה",  flag: "🇿🇦", dial: "27"  },
  { code: "RU", name: "רוסיה",        flag: "🇷🇺", dial: "7"   },
  { code: "UA", name: "אוקראינה",     flag: "🇺🇦", dial: "380" },
  { code: "CZ", name: "צ׳כיה",        flag: "🇨🇿", dial: "420" },
  { code: "PL", name: "פולין",        flag: "🇵🇱", dial: "48"  },
  { code: "HU", name: "הונגריה",      flag: "🇭🇺", dial: "36"  },
  { code: "RO", name: "רומניה",       flag: "🇷🇴", dial: "40"  },
  { code: "TR", name: "טורקיה",       flag: "🇹🇷", dial: "90"  },
  { code: "AE", name: "איחוד האמירויות", flag: "🇦🇪", dial: "971" },
  { code: "JO", name: "ירדן",         flag: "🇯🇴", dial: "962" },
  { code: "EG", name: "מצרים",        flag: "🇪🇬", dial: "20"  },
];

export function findCountry(code) {
  return COUNTRIES.find((c) => c.code === code) || COUNTRIES[0];
}

/**
 * Build a phone input element (returns { wrap, getValue, setValue }).
 * @param {object} opts
 *   - country: initial country code (default IL)
 *   - phone: initial phone digits (raw, as user entered)
 *   - onChange: callback fired on every change with { country, phone, valid }
 */
export function buildPhoneInput(opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "rt-phone-input";
  wrap.dir = "ltr"; // המספר עצמו ב-LTR לקריאות

  const select = document.createElement("select");
  select.className = "rt-phone-country";
  for (const c of COUNTRIES) {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = `${c.flag} ${c.code} +${c.dial}`;
    opt.title = c.name;
    select.appendChild(opt);
  }
  const initialCountry = (opts.country && findCountry(opts.country).code) || "IL";
  select.value = initialCountry;

  const input = document.createElement("input");
  input.type = "tel";
  input.inputMode = "tel";
  input.className = "rt-phone-number";
  input.placeholder = initialCountry === "IL" ? "050-1234567" : "מספר טלפון";
  input.autocomplete = "tel";
  input.value = opts.phone || "";

  wrap.appendChild(select);
  wrap.appendChild(input);

  function isValidLocal() {
    const country = findCountry(select.value);
    let digits = (input.value || "").replace(/\D+/g, "");
    if (!digits) return false;
    if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
    if (digits.startsWith(country.dial)) {
      // already E.164
    } else {
      digits = country.dial + digits;
    }
    return digits.length >= 7 && digits.length <= 15;
  }

  function fire() {
    if (typeof opts.onChange === "function") {
      opts.onChange({
        country: select.value,
        phone: input.value,
        valid: isValidLocal(),
      });
    }
  }

  select.addEventListener("change", () => {
    input.placeholder = select.value === "IL" ? "050-1234567" : "מספר טלפון";
    fire();
  });
  input.addEventListener("input", fire);
  input.addEventListener("blur", fire);

  return {
    wrap,
    getValue() { return { country: select.value, phone: input.value, valid: isValidLocal() }; },
    setValue(v) {
      if (v?.country) select.value = findCountry(v.country).code;
      if (v?.phone != null) input.value = v.phone;
      fire();
    },
    focus() { input.focus(); },
    isValid: isValidLocal,
  };
}

// =================================================================
// API לקריאה/שמירה של פרטי הטלפון בשרת
// =================================================================

export async function fetchAccountPhone() {
  try {
    const res = await fetch("/api/account/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function savePhone({ country, phone }) {
  const res = await fetch("/api/account/phone", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country, phone }),
    credentials: "same-origin",
  });
  if (!res.ok) {
    let msg = `שגיאה (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
