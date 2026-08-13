# Auth

## Preview gate

The whole MVP can be closed with Basic Auth:

- `SITE_ACCESS_ENABLED=true`
- `SITE_ACCESS_USER`
- `SITE_ACCESS_PASSWORD_SHA256`

## Admin

Admin uses one app login through `POST /api/admin/auth/login`. A successful login creates an HttpOnly `bs_session` with role `admin`; every protected admin endpoint checks that role.

Admin app password is PBKDF2:

- `ADMIN_APP_LOGIN`
- `ADMIN_APP_PASSWORD_HASH`
- `ADMIN_APP_PASSWORD_SALT`

## Partner

Partner uses one login from `partnerUsers`. A successful login creates an HttpOnly `bs_session` with role `partner` and `partner_id`; every partner endpoint uses that `partner_id` to scope data.

`ADMIN_ACCESS_ENABLED` and `PARTNER_ACCESS_ENABLED` default to `false`. Their Basic Auth gates remain optional for an exceptional closed environment, but are not part of the normal login flow.

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
