# Access

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
- `/admin?tab=settings`

Partner direct tabs:

- `/partner/dashboard?tab=overview`
- `/partner/dashboard?tab=addresses`
- `/partner/dashboard?tab=offers`
- `/partner/dashboard?tab=bookings`
- `/partner/dashboard?tab=profile`
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

Dev/test values used by local scripts:

- Admin login: `admin` / `admin-preview`

Admin app credentials are read from env. There is no admin password stored in `data/db.json`.

## Partner Cabinet

URL:

```text
http://localhost:3010/partner/login
```

Access: one partner user login checked server-side against `partnerUsers`.

Seed partner users:

- `partner1` / `partner1-preview`
- `partner2` / `partner2-preview`
- `bakery1` / `bakery1-preview`

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
- Check seed data: `node backend/db/seed.mjs`.
- Check storage exists: `data/db.json`.
- Check server logs from `node server.mjs`.
- Check cookies, especially `bs_session`.
- Clear cookies for `localhost:3010`.
- Restart the server.
- For local public review, start with `SITE_ACCESS_ENABLED=false node server.mjs`.
