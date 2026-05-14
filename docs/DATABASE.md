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
- `bookings`
- `partnerApplications`
- `contactRequests`
- `sessions`
- `auditLog`

## Relations

- partner -> partnerAddresses
- partner -> partnerUsers
- partner -> offers
- offer -> bookings
- partner -> bookings

## Commands

```bash
node backend/db/migrate.mjs
node backend/db/seed.mjs
node backend/db/reset.mjs
```

## SQLite/PostgreSQL migration

Replace `backend/storage/jsonStore.mjs` and repository internals. Keep service and API contracts stable. Use `backend/db/schema.sql` as the future schema entry point.
