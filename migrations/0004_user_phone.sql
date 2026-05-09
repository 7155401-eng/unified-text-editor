-- משה 2026-05-09: טלפון חובה למשתמש (ברירת מחדל ישראל +972, ניתן לשינוי).
-- שמור גם את קוד המדינה כדי להציג חזרה במסך ההגדרות בלי ניחוש.
--
-- מורצת ידנית: wrangler d1 execute ravtext-subscribers --file=migrations/0003_user_phone.sql

ALTER TABLE users ADD COLUMN phone TEXT;          -- במספרים בלבד, ללא רווחים/מקפים. דוגמה: 0521234567 (מקומי) או 972521234567 (E.164 ללא +)
ALTER TABLE users ADD COLUMN phone_country TEXT;  -- ISO 3166-1 alpha-2 (IL, US, GB, ...)
ALTER TABLE users ADD COLUMN phone_e164 TEXT;     -- מנורמל למבנה E.164 ללא + (לחיפוש/השוואה)
