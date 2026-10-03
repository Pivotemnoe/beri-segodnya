# Access

Приложение использует собственную сессию. При первом входе рабочие разделы закрыты до смены временного пароля. Секреты не размещаются в Git. Порядок работы: [Инструкция администратора](ADMIN_WORKFLOW.md).

Local URL:

```text
http://localhost:3010
```

## Routes

Public:

- `/`
- `/how-it-works`
- `/partners`
- `/contacts`
- `/android`
- `/privacy`
- `/personal-data-consent`
- `/terms`
- `/partner-terms`

Hidden:

- `/admin`
- `/partner/login`
- `/partner/dashboard`

Admin direct tabs:

- `/admin?tab=overview`
- `/admin?tab=partners`
- `/admin?tab=offers`
- `/admin?tab=bookings`
- `/admin?tab=partner-applications`
- `/admin?tab=contact-requests`
- `/admin?tab=audit`
- `/admin?tab=settings`

Partner direct tabs:

- `/partner/dashboard?tab=overview`
- `/partner/dashboard?tab=addresses`
- `/partner/dashboard?tab=offers`
- `/partner/dashboard?tab=bookings`
- `/partner/dashboard?tab=profile`
- `/partner/dashboard?tab=security`
- `/partner/dashboard?tab=help`

## Preview Basic Auth

Сайт может быть закрыт Basic Auth. Значения берутся из `.env.local`. Реальные значения `.env.local` не коммитятся и не публикуются.

Public preview variables:

- `SITE_ACCESS_ENABLED`
- `SITE_ACCESS_USER`
- `SITE_ACCESS_PASSWORD_SHA256`

For local visual review public preview can be disabled at process start:

```bash
SITE_ACCESS_ENABLED=false node server.mjs
```

The public preview gate does not intercept `/admin` or `/partner/*`. These sections use their own role sessions. Optional `ADMIN_ACCESS_ENABLED` and `PARTNER_ACCESS_ENABLED` Basic Auth gates remain available for exceptional closed environments, but default to `false`.

## Admin

URL:

```text
http://localhost:3010/admin
```

Access: one internal app login through `POST /api/admin/auth/login`.

Environment variables:

- `ADMIN_APP_LOGIN`
- `ADMIN_APP_PASSWORD_HASH`
- `ADMIN_APP_PASSWORD_SALT`
- `ADMIN_APP_PASSWORD_ITERATIONS`

These variables configure the initial administrator login only. After the required password change, the permanent administrator record is stored in `data/db.json` under `adminUsers`, as PBKDF2 hash, salt and iteration count, never as plain text. Protect the database, backups and environment file with private permissions. Existing permanent credentials take precedence over bootstrap environment credentials.

`GET /api/admin/auth/me` returns only authentication state, own login, role and password-change requirement, not hashes or session tokens. Administrator partner lists include derived `canDelete`; this is a UI hint, not authorization. The deletion endpoint independently rechecks history and exact-name confirmation.

## Partner Cabinet

URL:

```text
http://localhost:3010/partner/login
```

Access: one partner user login checked server-side against `partnerUsers`.

Seed logins may be created for local review, but their passwords must be supplied through the `SEED_PARTNER_*_PASSWORD` environment variables. Never reuse a seed password on the VPS.

Partner user passwords are stored as PBKDF2 `password_hash` + `password_salt`, not as plain text.

To create a partner and partner user:

1. Open `/admin`.
2. Login with admin credentials.
3. Open `Партнёры`.
4. Fill organization, first address and owner login.
5. Click `Создать партнёра и кабинет`.

Partner applications from `/partners` can prefill the same onboarding form. The partner, first address and owner account are created together.

## Troubleshooting Login

- Check `.env.local` exists and has the expected variables.
- Do not print or publish `.env.local` contents.
- Check seed data only in an isolated local test database. Never reset or reseed live storage to troubleshoot a login.
- Check storage exists: `data/db.json`.
- Check server logs from `node server.mjs`.
- Check cookies, especially `__Host-bs_session` on HTTPS or `bs_session` locally.
- Clear cookies for `localhost:3010`.
- Restart the server.
- For local public review, start with `SITE_ACCESS_ENABLED=false node server.mjs`.
