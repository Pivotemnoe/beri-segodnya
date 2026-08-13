# Security

- Do not commit `.env.local`.
- Do not store passwords in plain text.
- Partner passwords use PBKDF2 with salt.
- Preview Basic Auth passwords use SHA-256 hashes in env.
- Sessions are server-side and referenced by HttpOnly cookie.
- Raw session tokens are not stored; storage contains only SHA-256 hashes.
- Role checks happen on protected endpoints.
- Partner API is scoped by `partner_id`.
- Disabled partners are rejected even when an old session cookie exists.
- User input is validated and length-limited.
- JSON bodies are limited to 32 KiB; form/login rate limits are enabled.
- State-changing browser requests validate `Origin` when it is present.
- `robots.txt` disallows indexing.
- Security headers are set in `server.mjs`.

## Residual production work

- JSON storage is single-process only and should be replaced by PostgreSQL before growth.
- Current rate limiting is in-memory; multiple processes need a shared limiter.
- Inline scripts/styles require CSP `unsafe-inline`; a later asset extraction should remove it.
- Production needs final operator details, retention policy, monitoring and a verified restore drill.
- Basic Auth should also be rate-limited at Caddy/Nginx or an upstream security layer.
- Keep the Node listener on `127.0.0.1`; enable `TRUST_PROXY` only behind the trusted local reverse proxy.
