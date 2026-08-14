# Environment

Production/staging `.env.local` is created manually on the server. Do not commit it.

## Required Variables

```text
APP_ENV=production
APP_BASE_URL=https://example.ru
APP_DOMAIN=example.ru
PORT=3010
HOST=127.0.0.1
TRUST_PROXY=true

SESSION_SECRET=replace_with_random_long_secret

SITE_ACCESS_ENABLED=true
SITE_ACCESS_USER=replace
SITE_ACCESS_PASSWORD_SHA256=replace

ADMIN_ACCESS_ENABLED=false
ADMIN_ACCESS_USER=replace
ADMIN_ACCESS_PASSWORD_SHA256=replace

PARTNER_ACCESS_ENABLED=false
PARTNER_ACCESS_USER=replace
PARTNER_ACCESS_PASSWORD_SHA256=replace

ADMIN_APP_LOGIN=replace
ADMIN_APP_PASSWORD_HASH=replace
ADMIN_APP_PASSWORD_SALT=replace
ADMIN_APP_PASSWORD_ITERATIONS=600000

DB_DRIVER=json
DB_FILE=data/db.json
UPLOAD_DIR=data/uploads

LEGAL_OPERATOR_READY=false
LEGAL_OPERATOR_NAME=
LEGAL_OPERATOR_ID=
LEGAL_OPERATOR_ADDRESS=
LEGAL_PRIVACY_EMAIL=
LEGAL_DOCUMENT_VERSION=

NEXT_PUBLIC_APP_NAME=Бери сегодня
NEXT_PUBLIC_APP_CITY=Армавир
NEXT_PUBLIC_DEMO_MODE=false
```

If SQLite is introduced later:

```text
DB_DRIVER=sqlite
DB_FILE=data/beri-segodnya.sqlite
```

## Generate Basic Auth SHA-256

```bash
node -e "const crypto=require('crypto'); console.log(crypto.createHash('sha256').update('PASSWORD').digest('hex'))"
```

Store the result in:

- `SITE_ACCESS_PASSWORD_SHA256`
- `ADMIN_ACCESS_PASSWORD_SHA256`
- `PARTNER_ACCESS_PASSWORD_SHA256`

`ADMIN_ACCESS_ENABLED=false` and `PARTNER_ACCESS_ENABLED=false` are the normal settings: each role uses one app login and a role-protected HttpOnly session. These Basic Auth gates remain optional for an exceptional extra staging layer.

## Generate SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Generate Admin App PBKDF2

Use the same PBKDF2 format as `backend/utils/password.mjs`. A short local helper can call `createPasswordHash()`.

Example:

```bash
node --input-type=module -e "import { createPasswordHash } from './backend/utils/password.mjs'; console.log(createPasswordHash('PASSWORD'))"
```

Put `hash`, `salt` and `iterations` into the matching `ADMIN_APP_PASSWORD_*` variables.

## Server Setup

- Put env values in a protected `.env.local` or process manager env.
- Keep `HOST=127.0.0.1` when Node is reachable only through Caddy/Nginx.
- Set `TRUST_PROXY=true` only when the app is behind that trusted reverse proxy; direct local runs should use `false`.
- Restrict file permissions.
- Never print secrets in logs.
- Never commit `.env.local`.

## Seed and smoke-test secrets

The isolated smoke test generates its own random seed passwords and never touches `data/db.json`. Manual demo seeding requires `SEED_PARTNER_1_PASSWORD`, `SEED_PARTNER_2_PASSWORD` and `SEED_PARTNER_3_PASSWORD`; keep them local and unique. Do not publish or reuse production passwords.
