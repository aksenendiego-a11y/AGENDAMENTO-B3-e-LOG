CREATE UNIQUE INDEX users_email_case_insensitive_idx ON users (lower(email));
