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
- `ADMIN_APP_PASSWORD_ITERATIONS`

## Partner

Partner uses one login from `partnerUsers`. A successful login creates an HttpOnly session bound to `partner_id`, `user_id` and the current owner/manager role. Every protected request reloads the user and partner status; disabling the user, changing the role/password, or disabling the partner revokes existing sessions.

`ADMIN_ACCESS_ENABLED` and `PARTNER_ACCESS_ENABLED` default to `false`. Their Basic Auth gates remain optional for an exceptional closed environment, but are not part of the normal login flow.

Seed passwords are never committed. Set the three `SEED_PARTNER_*_PASSWORD` variables only for an intentional local/test seed. Demo seed is blocked in production unless a maintainer explicitly sets `ALLOW_DEMO_SEED=true`.

## Sessions

Session cookie:

```text
__Host-bs_session (production HTTPS) / bs_session (local HTTP)
```

Flags:

- HttpOnly
- SameSite=Strict
- Path=/
- Secure in production

## Rate limit

Login endpoints use a bounded process-local rate limit: 10 attempts per 10 minutes per IP/route. A shared limiter is still required before horizontal scaling.
