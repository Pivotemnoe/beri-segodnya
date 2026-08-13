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

DB_DRIVER=json
DB_FILE=data/db.json

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

Put `hash` into `ADMIN_APP_PASSWORD_HASH` and `salt` into `ADMIN_APP_PASSWORD_SALT`.

## Server Setup

- Put env values in a protected `.env.local` or process manager env.
- Keep `HOST=127.0.0.1` when Node is reachable only through Caddy/Nginx.
- Set `TRUST_PROXY=true` only when the app is behind that trusted reverse proxy; direct local runs should use `false`.
- Restrict file permissions.
- Never print secrets in logs.
- Never commit `.env.local`.

## Smoke Test Variables

Smoke tests need plain test passwords only in local/staging env, not production logs:

```text
TEST_SITE_ACCESS_USER=demo
TEST_SITE_ACCESS_PASSWORD=demo-preview
TEST_ADMIN_APP_LOGIN=admin
TEST_ADMIN_APP_PASSWORD=admin-preview
TEST_PARTNER_LOGIN=partner1
TEST_PARTNER_PASSWORD=partner1-preview
```

Do not publish real production passwords.
