-- Logins und Passwörter liegen in den Konten (D1)
DROP TABLE IF EXISTS auth_tokens;
ALTER TABLE members DROP COLUMN password;
