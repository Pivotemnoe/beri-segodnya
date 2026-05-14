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

- `GET /api/public/offers`
- `GET /api/public/offers/:id`
- `POST /api/public/bookings`
- `POST /api/public/partner-applications`
- `POST /api/public/contact-requests`

Public API is still behind preview Basic Auth when `SITE_ACCESS_ENABLED=true`.

## Admin

Requires Admin Basic Auth and admin app session unless endpoint is login.

- `POST /api/admin/auth/login`
- `GET /api/admin/auth/me`
- `POST /api/admin/auth/logout`
- `GET /api/admin/dashboard`
- `GET/POST/PATCH/DELETE /api/admin/partners`
- `GET/POST/PATCH/DELETE /api/admin/partners/:partnerId/addresses`
- `GET/POST/PATCH/DELETE /api/admin/partners/:partnerId/users`
- `GET/POST/PATCH/DELETE /api/admin/offers`
- `GET /api/admin/bookings`
- `PATCH /api/admin/bookings/:id/status`
- `GET /api/admin/partner-applications`
- `PATCH /api/admin/partner-applications/:id/status`
- `POST /api/admin/partner-applications/:id/create-partner`
- `GET /api/admin/contact-requests`
- `PATCH /api/admin/contact-requests/:id/status`
- `GET /api/admin/audit-log`

## Partner

Requires Partner Basic Auth and partner session unless endpoint is login.

- `POST /api/partner/auth/login`
- `GET /api/partner/auth/me`
- `POST /api/partner/auth/logout`
- `GET /api/partner/dashboard`
- `GET/PATCH /api/partner/profile`
- `GET/POST/PATCH/DELETE /api/partner/addresses`
- `GET/POST/PATCH/DELETE /api/partner/offers`
- `POST /api/partner/offers/:id/duplicate`
- `PATCH /api/partner/offers/:id/status`
- `GET /api/partner/bookings`
- `PATCH /api/partner/bookings/:id/status`

Partner endpoints are scoped by `session.partner_id`.
