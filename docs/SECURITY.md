# Security

- Do not commit `.env.local`.
- Do not store passwords in plain text.
- Partner passwords use PBKDF2 with salt.
- Preview Basic Auth passwords use SHA-256 hashes in env.
- Sessions are server-side and referenced by HttpOnly cookie.
- Role checks happen on protected endpoints.
- Partner API is scoped by `partner_id`.
- User input is validated and length-limited.
- `robots.txt` disallows indexing.
- Security headers are set in `server.mjs`.

## Not production-ready yet

- JSON storage should be replaced by SQLite/PostgreSQL.
- Need final legal privacy policy.
- Need backups and operational monitoring.
- Need stronger audit/reporting before public launch.
