-- משה 2026-05-09: שמירת טוקני תשלום לחיוב חוזר אחרי כישלון.
--
-- חשוב — לא שומרים מספר כרטיס בעצמנו (PCI-DSS). במקום זה שומרים
-- "Authorization Token" שמסופק על ידי הספק (יעד שריג / פייפאל) ומאפשר
-- לחייב מחדש את אותו אמצעי תשלום בלי שאנחנו מחזיקים את המספר.
--
-- מורצת ידנית: wrangler d1 execute ravtext-subscribers --file=migrations/0002_payment_tokens.sql

ALTER TABLE users ADD COLUMN yaad_token TEXT;       -- Yaad J5 authorization token
ALTER TABLE users ADD COLUMN paypal_payer_id TEXT;  -- PayPal payer id (vault id)
ALTER TABLE users ADD COLUMN last_payment_at INTEGER; -- epoch sec של תשלום מוצלח אחרון
ALTER TABLE users ADD COLUMN last_payment_provider TEXT; -- 'yaad' | 'paypal'
ALTER TABLE users ADD COLUMN failed_charge_count INTEGER NOT NULL DEFAULT 0;
