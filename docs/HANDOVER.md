# Developer Handover

## Project

`beri-segodnya` is an MVP for local same-day food offers. Customers reserve an offer, receive a `BS-XXXX` code, pay at the partner venue, and the partner marks the code status.

The service is not an aggregator, does not process online payments, and does not provide delivery.

## Local Run

```bash
npm run dev
```

Without npm:

```bash
node server.mjs
```

Local URL:

```text
http://localhost:3010
```

For local UI review without external Basic Auth prompts:

```bash
SITE_ACCESS_ENABLED=false ADMIN_ACCESS_ENABLED=false PARTNER_ACCESS_ENABLED=false node server.mjs
```

## Main Files

- `server.mjs` - HTTP server, page rendering, static CSS/JS, security gate.
- `backend/routes/apiRouter.mjs` - API routing.
- `backend/repositories/` - data access contracts.
- `backend/storage/jsonStore.mjs` - server-side JSON storage layer.
- `backend/services/` - auth and business logic.
- `data/db.json` - local MVP data storage, not committed.
- `scripts/smoke-test.mjs` - API smoke test.
- `scripts/backup-data.mjs` - data backup.
- `scripts/restore-data.mjs` - data restore.

## Pages

Public:

- `/`
- `/how-it-works`
- `/partners`
- `/contacts`
- `/privacy`
- `/personal-data-consent`
- `/terms`
- `/partner-terms`

Admin:

- `/admin`
- direct tabs via `/admin?tab=overview`, `partners`, `offers`, `bookings`, `partner-applications`, `contact-requests`, `settings`.

Partner:

- `/partner/login`
- `/partner/dashboard`
- direct tabs via `/partner/dashboard?tab=overview`, `addresses`, `offers`, `bookings`, `profile`, `help`.

## API

API documentation is in `docs/API.md`.

Key groups:

- `/api/public/*`
- `/api/admin/*`
- `/api/partner/*`

Responses use:

```json
{ "ok": true, "data": {} }
```

or:

```json
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Message" } }
```

## Env

See `.env.example` and `docs/ENVIRONMENT.md`.

Never commit `.env.local`.

Important variables:

- `PORT`
- `SESSION_SECRET`
- `SITE_ACCESS_ENABLED`
- `SITE_ACCESS_USER`
- `SITE_ACCESS_PASSWORD_SHA256`
- `ADMIN_ACCESS_ENABLED`
- `ADMIN_ACCESS_USER`
- `ADMIN_ACCESS_PASSWORD_SHA256`
- `ADMIN_APP_LOGIN`
- `ADMIN_APP_PASSWORD_HASH`
- `ADMIN_APP_PASSWORD_SALT`
- `PARTNER_ACCESS_ENABLED`
- `PARTNER_ACCESS_USER`
- `PARTNER_ACCESS_PASSWORD_SHA256`
- `DB_DRIVER`
- `DB_FILE`

## Commands

```bash
npm run check:server
npm run db:seed
npm run db:reset
npm run test:smoke
npm run backup:data
npm run restore:data -- backups/db-YYYY-MM-DD-HH-mm-ss.json
```

Direct Node equivalents:

```bash
node --check server.mjs
node backend/db/seed.mjs
node backend/db/reset.mjs
node scripts/smoke-test.mjs
node scripts/backup-data.mjs
node scripts/restore-data.mjs backups/db-YYYY-MM-DD-HH-mm-ss.json
```

## Add Partner

1. Open `/admin`.
2. Login as admin.
3. Open `Partners`.
4. Create partner.
5. Copy partner id from the partners table.
6. Add address with the partner id.
7. Add partner user with the partner id.

Partner user passwords are stored as PBKDF2 hash + salt.

## Add Offer

1. Open `/admin?tab=offers` or partner dashboard `Offers`.
2. Choose partner id and address id.
3. Enter title, category, price, old price, pickup window, total quantity, remaining quantity, and status.
4. Active offers appear on the homepage.

## Check Code Flow

1. Open `/`.
2. Reserve an active offer.
3. Copy the generated `BS-XXXX` code.
4. Open `/admin?tab=bookings` and verify the code.
5. Open `/partner/dashboard?tab=bookings` as the matching partner and verify the code.
6. Mark the code as issued, no-show, or cancelled.
7. Re-check status in admin.

## Deploy

Use `docs/DEPLOYMENT.md`. Current JSON storage requires a VPS or server with persistent disk. Do not use serverless as the primary deployment target without moving storage to an external database.

## Backup

Create backup:

```bash
npm run backup:data
```

Restore:

```bash
npm run restore:data -- backups/db-YYYY-MM-DD-HH-mm-ss.json
```

Restore creates a current backup before replacing `data/db.json`.

## Do Not

- Do not commit `.env.local`.
- Do not add real partner names, addresses, logos, or personal data without explicit permission and legal readiness.
- Do not disable security gates in staging/production without an approved replacement.
- Do not return `localStorage` as the source of truth.
- Do not add delivery, online payment, SMS, or email campaigns without a separate task.
- Do not change the old "Что поесть" site from this project.
