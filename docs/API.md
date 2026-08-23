# API

All responses use:

```json
{ "ok": true, "data": {} }
```

Errors:

```json
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Message" } }
```

## Public

- `GET /api/public/health` — storage-backed readiness probe; returns only `{ "status": "ready" }`.
- `GET /api/public/offers`
- `GET /api/public/offers/:id`
- `POST /api/public/bookings`
- `GET /api/public/bookings/:publicToken`
- `POST /api/public/bookings/:publicToken/cancel`
- `POST /api/public/partner-applications`
- `POST /api/public/contact-requests`

Public API is behind preview Basic Auth when `SITE_ACCESS_ENABLED=true`. The live boundary must be checked separately from this code default.

Only offers for the current Moscow date, before pickup end, with an active partner/address and positive remaining quantity are public. Booking cancellation is a terminal status and restores one unit only while the offer is still available.

JSON request bodies are limited to 32 KiB, except the authenticated partner photo upload endpoint, which accepts up to 16 MiB for one to three compressed images. Public forms and login routes are rate-limited per process. A state-changing request with an `Origin` outside `APP_BASE_URL`/current host receives `ORIGIN_NOT_ALLOWED`.

## Admin

Requires an admin app session unless the endpoint is login. Optional admin Basic Auth is disabled by default.

- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `POST /api/admin/auth/change-password`
- `POST /api/admin/auth/logout`
- `GET /api/admin/dashboard`
- `GET/POST/PATCH/DELETE /api/admin/partners`
- `POST /api/admin/partners/onboard` (partner + first address + owner account)
- `GET/POST/PATCH/DELETE /api/admin/partners/:partnerId/addresses`
- `GET/POST/PATCH/DELETE /api/admin/partners/:partnerId/users`
- `GET/POST/PATCH/DELETE /api/admin/offers`
- `GET /api/admin/bookings`
- `PATCH /api/admin/bookings/:id/status`
- `GET /api/admin/partner-applications`
- `PATCH /api/admin/partner-applications/:id/status`
- `POST /api/admin/partner-applications/:id/create-partner`
- `DELETE /api/admin/partner-applications/:id`
- `GET /api/admin/contact-requests`
- `PATCH /api/admin/contact-requests/:id/status`
- `DELETE /api/admin/contact-requests/:id`
- `GET /api/admin/audit-log`

## Partner

Requires a partner app session unless the endpoint is login. Optional partner Basic Auth is disabled by default.

- `POST /api/partner/auth/login`
- `GET /api/partner/auth/me`
- `POST /api/partner/auth/change-password`
- `POST /api/partner/auth/logout`
- `GET /api/partner/dashboard`
- `GET/PATCH /api/partner/profile`
- `GET/POST/PATCH/DELETE /api/partner/addresses`
- `GET/POST/PATCH/DELETE /api/partner/offers`
- `POST /api/partner/uploads`
- `GET/POST/PATCH/DELETE /api/partner/offer-templates`
- `POST /api/partner/offers/:id/duplicate`
- `PATCH /api/partner/offers/:id/status`
- `GET /api/partner/bookings`
- `PATCH /api/partner/bookings/:id/status`

Partner endpoints are scoped by `session.partner_id`.

When `passwordChangeRequired=true`, all protected admin or partner data endpoints return `PASSWORD_CHANGE_REQUIRED` until the authenticated user changes the temporary password. The password-change endpoint verifies the current password, requires a different replacement of 12–120 characters, revokes old sessions and returns a new session cookie.

`PATCH /api/admin/partners/:id` with `status=archived` disables that partner's users and addresses, pauses active offers and revokes partner sessions while preserving history. `DELETE /api/admin/partners/:id` requires the exact partner name in `confirmation` and refuses permanent deletion when offers, templates or bookings exist.

`POST /api/partner/uploads` accepts `{ "images": [{ "dataUrl": "data:image/jpeg;base64,...", "capturedAt": "ISO date" }] }`. It allows JPEG, PNG and WebP, at most three files and 4 MiB per decoded image. Files are written to `data/uploads/<partner-id>/`; an offer created by a partner may reference only that partner's upload folder.

Admin/partner mutations use validated allowlists. Ownership fields cannot be changed by partner PATCH requests. Booking statuses only transition from `created` to `issued`, `no_show` or `cancelled`.
