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

Телефоны в публичных формах и бронировании принимаются как `8XXXXXXXXXX`, `7XXXXXXXXXX` или десять национальных цифр и сохраняются единообразно как `+7 (XXX) XXX-XX-XX`. Неполный номер и символы, кроме цифр и знаков форматирования, отклоняются.

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
- `PATCH /api/admin/bookings/:id/correction` - completed status correction with reason and expected status
- `GET /api/admin/partner-applications`
- `PATCH /api/admin/partner-applications/:id/status`
- `POST /api/admin/partner-applications/:id/create-partner`
- `DELETE /api/admin/partner-applications/:id`
- `GET /api/admin/contact-requests`
- `PATCH /api/admin/contact-requests/:id/status`
- `DELETE /api/admin/contact-requests/:id`
- `GET /api/admin/audit-log`

`GET /api/admin/audit-log` возвращает только административной сессии `actorRole`, `action`, нормализованный `entityType`, `createdAt`, `referenceLabel`, `previousStatus`, `status`, `reason`. Контекст выбирается по разрешённым полям: код брони либо текущее название/имя записи, известные статусы и причина только для `correct_booking_status`. Названия не являются историческим снимком; у удалённой записи `referenceLabel` равен `null`. Некорректные старые метаданные игнорируются. Сырые метаданные, внутренние идентификаторы, сеансы, пароли, телефоны и текст обращений не возвращаются этим методом.

`PATCH /api/admin/partners/:partnerId/users/:userId` с полем `password` задаёт временный пароль, отзывает активные сеансы пользователя и устанавливает обязательную смену пароля при следующем входе. Хеш, соль и исходный пароль в ответ не возвращаются.

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

`GET /api/partner/dashboard?period=today|week|month|all` returns period counters using Moscow dates (default API period `all`, UI `today`). Active offers are always counted now; booking/no-show counters follow creation date, issued count/amount follow issue date. Unknown legacy amounts are excluded and reported as `unknownIssuedAmountsCount`. Amounts reflect staff handover flags, not verified payments.

Seller users can read dashboard/bookings and set only `issued`/`no_show`. They cannot read/edit profile, addresses, offers or templates, upload photos or cancel bookings. Seller DTOs omit customer contact data, public capability tokens and consent receipts. The actor's `user_id` is retained in handover audit entries.

Booking creation accepts an optional UUID `requestId`. Repeating the same ID and normalized offer/customer/consent-version data returns the existing booking, even after sold-out/cancellation, without another stock decrement. Reusing it with changed data gives `409 BOOKING_REQUEST_CONFLICT`; malformed IDs give `400 INVALID_REQUEST_ID`. The ID is not an authentication credential; clients must generate an unpredictable UUID for each new intention. Existing clients without an ID remain supported, but lack retry deduplication. The current modal retains its ID after an ambiguous failure, until success/data change; reopening the entire browser/page loses this in-memory attempt and is outside this guarantee.

New bookings expose frozen title, price, contents, allergens, address, partner name and pickup date/window plus `termsVerified=true`. Legacy bookings lacking `terms_snapshot` return `price=null`, `termsVerified=false`, and clearly labelled current-reference details; no original price is fabricated.

When `passwordChangeRequired=true`, all protected admin or partner data endpoints return `PASSWORD_CHANGE_REQUIRED` until the authenticated user changes the temporary password. The password-change endpoint verifies the current password, requires a different replacement of 12–120 characters, revokes old sessions and returns a new session cookie.

`PATCH /api/admin/partners/:id` with `status=archived` disables that partner's users and addresses, pauses active offers and revokes partner sessions while preserving history. `DELETE /api/admin/partners/:id` requires the exact partner name in `confirmation` and refuses permanent deletion when offers, templates or bookings exist.

`POST /api/partner/uploads` accepts `{ "images": [{ "dataUrl": "data:image/jpeg;base64,...", "capturedAt": "ISO date" }] }`. It allows JPEG, PNG and WebP, at most three files and 4 MiB per decoded image. Files are written to `data/uploads/<partner-id>/`; an offer created by a partner may reference only that partner's upload folder.

Admin/partner mutations use validated allowlists. Ownership fields cannot be changed by partner PATCH requests. Booking statuses only transition from `created` to `issued`, `no_show` or `cancelled`.

An administrator can correct a completed status through the dedicated `correction` endpoint with `{status, expectedStatus, reason}` (10-500 characters). Both states must be terminal, differ and match the current stored status. Each correction records reason/actor/time and stock delta. Moving to cancelled here does not imply a physical stock return. Reinstating a cancelled booking decrements stock only if the recorded original cancellation returned it; no stock gives 409, unknown legacy stock history gives `LEGACY_STOCK_UNKNOWN`. No ordinary status endpoint can reopen or rewrite a terminal booking.

Uploads have configurable byte quotas: `UPLOAD_PARTNER_MAX_BYTES` (100 MiB default), `UPLOAD_TOTAL_MAX_BYTES` (2 GiB default). Entire batches are validated before writes; per-partner exhaustion gives 413 and total exhaustion gives 503 without deleting existing media.

Malformed percent encoding in any parsed cookie or booking HTML URL returns controlled 400. All static-file sinks verify ordinary files and handle asynchronous open/read errors; missing/directory targets are not 200, partial responses are closed without killing the worker.
