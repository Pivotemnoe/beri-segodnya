# Runbook

## Create partner

1. Open `/admin`.
2. Login with admin credentials.
3. Open `Партнёры`.
4. Fill the organization, first address and owner login in the onboarding form.
5. Click `Создать партнёра и кабинет`.

## Create offer

Use admin or partner dashboard. Active offers appear on `/`.

## Process booking

1. Open admin or partner dashboard.
2. Find booking by code.
3. Mark as `issued`, `no_show`, or `cancelled`.

## Process partner application

1. Open admin dashboard.
2. Find application.
3. Click create partner or change status.

## Backup JSON DB

Use the script:

```bash
npm run backup:data
```

Direct Node:

```bash
node scripts/backup-data.mjs
```

The backup is written to:

```text
backups/db-YYYY-MM-DD-HH-mm-ss.json
backups/uploads-YYYY-MM-DD-HH-mm-ss/
```

The matching uploads directory contains partner photos from `data/uploads/`. Keep the JSON file and its uploads directory together.

Do not commit backups with real data.

## Restore JSON DB

Restore from a backup:

```bash
npm run restore:data -- backups/db-YYYY-MM-DD-HH-mm-ss.json
```

Direct Node:

```bash
node scripts/restore-data.mjs backups/db-YYYY-MM-DD-HH-mm-ss.json
```

The restore script creates backups of the current `data/db.json` and `data/uploads/` before replacing them. If a matching uploads backup is absent, the current photo directory is preserved.

## Manual pre-deploy scenarios

### Admin

1. Open `http://localhost:3010/admin`.
2. Login with admin credentials.
4. Check overview stats.
5. Check partners list.
6. Create a test partner, first address and owner account in one operation.
9. Create offer for that partner/address.
10. Open `/` and check that the offer appears.

### Partner

1. Open `http://localhost:3010/partner/login`.
2. Login as seed partner user.
4. Open dashboard.
5. Add address.
6. Add offer.
7. Open `/` and check the offer.
8. Book the offer on the public page.
9. Return to partner dashboard.
10. Find the booking code.
11. Mark it `issued`, `no_show`, or `cancelled`.
12. Check the updated status in admin.

### Partner application

1. Open `/partners`.
2. Submit a test partner application.
3. Open `/admin`.
4. Check that the application appears.
5. Create partner from application.

### Contact request

1. Open `/contacts`.
2. Submit a test contact request.
3. Open `/admin`.
4. Check that the request appears.
5. Change status to `in_progress` or `closed`.
