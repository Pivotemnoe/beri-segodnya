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

Variables:

- `SITE_ACCESS_ENABLED`
- `SITE_ACCESS_USER`
- `SITE_ACCESS_PASSWORD_SHA256`
- `ADMIN_ACCESS_ENABLED`
- `ADMIN_ACCESS_USER`
- `ADMIN_ACCESS_PASSWORD_SHA256`
- `PARTNER_ACCESS_ENABLED`
- `PARTNER_ACCESS_USER`
- `PARTNER_ACCESS_PASSWORD_SHA256`

For local visual review public preview can be disabled at process start:

```bash
SITE_ACCESS_ENABLED=false node server.mjs
```

Admin and partner Basic Auth stay enabled for `/admin`, `/api/admin/*`, `/partner/*`, and `/api/partner/*`.

For local UI review, when the browser must open the actual admin and partner login pages directly, start with:

```bash
SITE_ACCESS_ENABLED=false ADMIN_ACCESS_ENABLED=false PARTNER_ACCESS_ENABLED=false node server.mjs
```

In this mode `/admin` still requires admin app login and `/partner/login` still requires partner user login. For staging/production, keep `ADMIN_ACCESS_ENABLED=true` and `PARTNER_ACCESS_ENABLED=true` unless another upstream access layer is configured.

## Admin

URL:

```text
http://localhost:3010/admin
```

Access layers:

1. Admin Basic Auth for `/admin` and `/api/admin/*` when `ADMIN_ACCESS_ENABLED=true`.
2. Internal app login through `POST /api/admin/auth/login`.

Environment variables:

- `ADMIN_ACCESS_ENABLED`
- `ADMIN_ACCESS_USER`
- `ADMIN_ACCESS_PASSWORD_SHA256`
- `ADMIN_APP_LOGIN`
- `ADMIN_APP_PASSWORD_HASH`
- `ADMIN_APP_PASSWORD_SALT`

Dev/test values used by local scripts:

- Admin Basic Auth: `admin` / `admin-preview`
- Admin app login: `admin` / `admin-app-preview`

Admin app credentials are read from env. There is no admin password stored in `data/db.json`.

## Partner Cabinet

URL:

```text
http://localhost:3010/partner/login
```

Access layers:

1. Partner Basic Auth for `/partner/*` and `/api/partner/*` when `PARTNER_ACCESS_ENABLED=true`.
2. Partner user login checked server-side against `partnerUsers`.

Partner Basic Auth dev/test value:

- `partner` / `partner-preview`

Seed partner users:

- `partner1` / `partner1-preview`
- `partner2` / `partner2-preview`
- `bakery1` / `bakery1-preview`

Partner user passwords are stored as PBKDF2 `password_hash` + `password_salt`, not as plain text.

To create a partner and partner user:

1. Open `/admin`.
2. Pass Admin Basic Auth.
3. Login with admin app credentials.
4. Create partner.
5. Add partner address.
6. Create partner user.

Partner applications from `/partners` can be converted to partner + address from admin. Create the partner user separately in the admin users block.

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
