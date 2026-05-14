# Auth

## Preview gate

The whole MVP can be closed with Basic Auth:

- `SITE_ACCESS_ENABLED=true`
- `SITE_ACCESS_USER`
- `SITE_ACCESS_PASSWORD_SHA256`

## Admin

Admin has two layers:

1. Admin Basic Auth for `/admin` and `/api/admin/*`.
2. App login through `POST /api/admin/auth/login`.

Admin app password is PBKDF2:

- `ADMIN_APP_LOGIN`
- `ADMIN_APP_PASSWORD_HASH`
- `ADMIN_APP_PASSWORD_SALT`

## Partner

Partner has two layers:

1. Partner Basic Auth for `/partner/*` and `/api/partner/*`.
2. Partner user login from `partnerUsers`.

Seed users:

- `partner1` / `partner1-preview`
- `partner2` / `partner2-preview`
- `bakery1` / `bakery1-preview`

## Sessions

Session cookie:

```text
bs_session
```

Flags:

- HttpOnly
- SameSite=Lax
- Path=/
- Secure in production

## Rate limit

Login endpoints use an in-memory rate limit: 10 attempts per 10 minutes per IP/route.
