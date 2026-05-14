# Deployment

Do not deploy directly from a local workstation without reviewing `docs/DEPLOYMENT_READINESS_CHECKLIST.md`.

For a practical closed staging VPS walkthrough, use `docs/VPS_DEPLOY_STEP_BY_STEP.md`. For the short staging gate, use `docs/STAGING_CHECKLIST.md`.

## Scenario A: VPS, Recommended

Current architecture uses `server.mjs` and server-side storage. Use a VPS or server with a persistent disk.

Required:

- VPS or dedicated server
- Node.js LTS
- Git
- PM2 or systemd
- Nginx or Caddy
- Domain
- HTTPS certificate

Upload:

- Project code from a private repository.
- Create `.env.local` manually on the server.
- Create storage on the server with `node backend/db/migrate.mjs` or `node backend/db/seed.mjs`.

Run:

```bash
npm install
node server.mjs
```

PM2 example:

```bash
pm2 start server.mjs --name beri-segodnya
pm2 save
```

systemd can also run `node server.mjs` from the project directory with env loaded from a protected file.

Proxy:

- Nginx or Caddy proxies the domain to `http://127.0.0.1:3010`.
- Keep `/admin` and `/partner/*` behind their Basic Auth gates.

HTTPS:

- Use Certbot/Let's Encrypt with Nginx.
- Or use Caddy auto-HTTPS.

Storage:

- Keep `data/` on a persistent disk.
- Do not store `data/db.json`, SQLite files, or backups in Git.
- Back up `data/db.json` regularly while JSON storage is used.

## Scenario B: Vercel/serverless, Not Recommended Without External DB

If backend uses server-side JSON or local SQLite, Vercel/serverless is not suitable as persistent storage.

For Vercel-like deployment you need:

- External database.
- PostgreSQL/Supabase/Neon/Turso or another persistent database.
- Repository layer rewritten for the external database.
- No JSON/SQLite file used as primary storage in serverless filesystem.

Do not use Vercel/serverless as the primary deployment if data must stay in a local file.

## Domain and DNS

1. Choose hosting/VPS first.
2. Get the server IP.
3. Add DNS records:
   - `A` for root domain to server IP.
   - `A` for `www` to server IP, or `CNAME www` to root if registrar supports it.
4. Configure Nginx or Caddy on the server.
5. Issue HTTPS certificate.
6. Check:
   - `http://domain`
   - `https://domain`
   - `https://www.domain`
7. Add redirects:
   - `http` to `https`
   - `www` to non-`www`, or the opposite.
8. Verify `/admin` and `/partner/*` are closed.
9. Keep `robots noindex` enabled while the project is in test.

Do not hardcode a real domain in code. Use env:

```text
APP_BASE_URL=https://example.ru
APP_DOMAIN=example.ru
PORT=3010
```

## Pre-Deploy Commands

```bash
node --check server.mjs
node backend/db/migrate.mjs
node scripts/smoke-test.mjs
```

If package manager is available:

```bash
npm run check:server
npm run test:smoke
```
