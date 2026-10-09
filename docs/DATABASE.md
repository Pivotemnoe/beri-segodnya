# Database

Current storage: server-side JSON.

File:

```text
data/db.json
```

The file is ignored by Git. Seed/migration scripts are committed.

## Collections

- `customers`
- `customerSessions`
- `customerLoginChallenges`
- `customerAuthLimits`
- `partners`
- `partnerUsers`
- `partnerAddresses`
- `offers`
- `offerTemplates`
- `bookings`
- `partnerApplications`
- `contactRequests`
- `sessions`
- `auditLog`

## Relations

- partner -> partnerAddresses
- partner -> partnerUsers
- partner -> offers
- partner -> offerTemplates
- offer -> bookings
- partner -> bookings

Partner photos are binary server data in `data/uploads/<partner-id>/`. Offers keep one to three relative URLs in `image_urls`; `image_url` remains the primary-image compatibility field. `photo_captured_at` and `source_type` distinguish a current photo publication from a reusable template.

`data/db.json` and `data/uploads/` must be backed up and restored together. `npm run backup:data` creates a timestamp-matched database file and photo directory under `backups/`.

## Commands

```bash
node backend/db/migrate.mjs
node backend/db/seed.mjs
node backend/db/reset.mjs
```

## Booking contract (2026-10-03)

New `bookings` include `terms_snapshot` version 1: immutable price/title/contents/allergens/weight/description, partner name, address/title, date/window, and capture time. Public/staff projections and issued amounts use that snapshot. No bulk rewrite of legacy records occurs: absent snapshots are marked unverified with `price=null`, excluded from amount totals, and counted separately.

Optional `request_key_hash` and `request_fingerprint` deduplicate a UUID-labelled creation retry inside the same atomic JSON mutation; projections exclude these internal values. Codes are generated with cryptographic randomness, checked against every stored code, and expand after four-digit exhaustion. This still assumes exactly one writer/process.

Optional `customer_id` links a new authenticated booking to a buyer. Legacy/guest rows remain unchanged and are never associated by phone. Customer DTOs expose only that account's history; private booking capability links remain an independent way to view/cancel a booking. Profile fields: normalized email, name, contact phone, active status and consent receipt. Separate session/challenge collections contain HMAC hashes, expiries and attempts, not raw credentials. Persistent rate-limit rows store hashed budget keys and reset times. Missing collections are added on read without resetting existing data. All four collections are part of the ordinary database backup. The future SQL schema still requires a dedicated migration before replacing JSON.

`status_changed_at`, `issued_at` support reporting. Cancellation stores whether it actually returned stock. `corrections` records administrator-only terminal corrections with reason, identity, time and stock delta; `auditLog` keeps an additional trace. Ordinary terminal transitions remain prohibited.

Backups contain a matching database, photo tree and SHA-256 manifest. Restore validates the full pair and its staged copy before replacement, requires the operator's explicit stopped-server declaration and preserves pre-restore data. A legacy manifest-less restore remains possible with a warning. Off-server replication is not configured by these code changes.

## SQLite/PostgreSQL migration

Replace `backend/storage/jsonStore.mjs` and repository internals. Keep service and API contracts stable. Use `backend/db/schema.sql` as the future schema entry point.
