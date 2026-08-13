# Database

Current storage: server-side JSON.

File:

```text
data/db.json
```

The file is ignored by Git. Seed/migration scripts are committed.

## Collections

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

## SQLite/PostgreSQL migration

Replace `backend/storage/jsonStore.mjs` and repository internals. Keep service and API contracts stable. Use `backend/db/schema.sql` as the future schema entry point.
