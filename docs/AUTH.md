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

The environment credential is a bootstrap credential only. On the first successful login, the admin API reports `passwordChangeRequired=true`; all protected admin operations remain blocked until `POST /api/admin/auth/change-password` succeeds. The permanent administrator credential is stored in the server database as PBKDF2 parameters, and the bootstrap credential no longer works for that login.

## Partner

Partner uses individual logins from `partnerUsers`. A successful login creates an HttpOnly session bound to `partner_id`, `user_id` and the current owner/manager/seller role. Every protected request reloads the user and partner status; disabling the user, changing the role/password, or disabling the partner revokes existing sessions.

Owner retains full own-organization access. Manager keeps operational offer/template/upload/booking access and read-only profile/addresses. Seller is limited to dashboard/bookings and `issued`/`no_show`, without contact/capability data. Unknown roles receive no permissions. A browser wizard draft is scoped by partner and user IDs; shared legacy draft data is not loaded.

New partner users and users whose password was reset by an administrator have `must_change_password=true`. They may call only the session probe, logout and password-change endpoints until they replace the temporary password. Transparent PBKDF2 rehashing does not clear this flag.

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

Changing an administrator or partner password revokes the role/user's other active sessions and issues one fresh session to the browser that completed the change.

Cookie parsing preserves one decoding pass, duplicate-name last-wins behavior and `__Host-bs_session` precedence. Any malformed encoded value is rejected with 400, not silently dropped to authenticate using a lower-priority cookie.

## Rate limit

Login endpoints use a bounded process-local rate limit: 10 attempts per 10 minutes per IP/route. A shared limiter is still required before horizontal scaling.
