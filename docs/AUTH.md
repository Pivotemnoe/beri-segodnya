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

The native Android candidate keeps partner and admin session tokens in separate encrypted Android Keystore-backed storage. HTTPS responses use only `__Host-bs_session`; no password or browser cookie is imported. Server permission checks are identical for website and Android requests.

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

Password operations (own changes, administrator onboarding, staff creation and staff password reset) share 10 attempts per 10 minutes per initiating role/user and 20 per IP. This includes temporary-password sessions and sellers. User budgets survive session and IP rotation; live budgets are never evicted to admit new keys. Excess attempts return `429 RATE_LIMIT` without changing credentials or sessions; ordinary staff profile edits do not consume password budgets.

Login verification, transparent rehash and all online password hashing use a shared asynchronous PBKDF2 pool: 2 active jobs and at most 8 waiting. Overflow returns `429 RATE_LIMIT`; the 600,000-iteration baseline is unchanged. Synchronous hash exports remain for seed/fixtures; the offline staff-reset command awaits the shared service. After every final authentication await, credentials, active partner/user/role and initiating session (for rotation) are rechecked before synchronous writes, so logout/reset/disable cannot be undone by stale work. Staff reset rechecks both the acting administrator session and target record; an intervening target edit returns `409 RECORD_CHANGED`. Concurrent transparent upgrades reverify the current hash rather than accepting a stale successful comparison.

## Optional customer account (candidate 0.3)

Guest booking remains the default: no account or application installation is required. `/customer` and the native Profile tab offer one-time email login only as a convenience. Saved profile and server-owned history are shared across devices. Phone is contact data, not a verified identity; matching phones never merge history.

Enable only after SMTP and legal configuration checks: `CUSTOMER_AUTH_ENABLED=true`, `SESSION_SECRET` at least 32 characters, and the existing legal gate ready. Nodemailer uses verified TLS on 465 or required STARTTLS on 587, a fixed authenticated sender, no file/URL access, and no provider debug logging. Codes are not returned by API, persisted in plaintext, or written to logs.

Endpoints under `/api/customer/`: `POST auth/request-code` (email and personalDataConsent), `POST auth/verify-code` (challengeId and six-digit code), `GET auth/me`, `POST auth/logout`, `GET/PATCH profile`, `GET bookings`, `POST bookings/claim` (full publicToken), `POST account/deletion-request`. Normal same-origin/X-BS-Request guards apply. Browser/native cookies are separate from staff: `__Host-bs_customer` on HTTPS, `bs_customer` only on local HTTP; HttpOnly, SameSite=Strict, Path=/, 30 days, Secure in production. Duplicate customer cookies are rejected. Native stores the customer token/profile/history separately with Android Keystore and clears that cache on logout/confirmed expiry; codes and passwords are not saved.

Email challenges: six random digits, ten minutes, five guesses, single-use, HMAC hashes with SESSION_SECRET. A new code supersedes the old only after SMTP accepts it. Persistent admission budgets: one per email per minute, three per email per 30 minutes, ten per IP per ten minutes, 200 total per rolling 24-hour window; verification 30 per IP and ten per email per ten minutes. Storage is capped at 1,000 unexpired challenges and 5,000 live budget rows, failing closed at capacity. This is pilot protection, not readiness for a mass campaign or horizontal scaling.

Booking ownership is derived solely from the authenticated cookie when `accountBooking=true`; a caller-supplied customer ID is ignored. An expired account request receives 401 and is never silently retried as a guest. Retry fingerprints include ownership; another account cannot retrieve an earlier result by reusing its request UUID. A guest booking can be transferred explicitly using its full private capability link, never by phone or short pickup code. A deletion request creates one administrator-visible contact request; it does not immediately delete orders or bypass retention decisions.

Tests: `npm run test:customer-auth` uses isolated fixtures and an in-process delivery dependency. No HTTP-controlled test code or mail bypass exists. Published APK 0.2 still has guest-only buyer flows; candidate source 0.3 must be compiled, signed and accepted separately before its download link replaces 0.2.
