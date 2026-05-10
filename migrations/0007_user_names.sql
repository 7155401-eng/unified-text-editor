-- משה 2026-05-10: שמירת שם פרטי + משפחה מהתחברות גוגל.
-- יעד שריג דורשים את אחד מהם בעמוד התשלום שלהם (errMsg "חובה להזין שם פרטי או משפחה (401)").
-- אנחנו שולפים מ-Google userinfo (given_name + family_name) ושולחים ב-ClientName/ClientLName.
--
-- הרצה: wrangler d1 execute ravtext-subscribers --file=migrations/0007_user_names.sql --remote

ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
