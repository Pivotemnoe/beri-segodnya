# Runbook

## Create partner

1. Open `/admin`.
2. Pass Admin Basic Auth.
3. Login with admin app credentials.
4. Use the partner form.
5. Add address through API or admin UI.
6. Create partner user through API.

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
```

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

The restore script creates a backup of the current `data/db.json` before replacing it.

## Manual pre-deploy scenarios

### Admin

1. Open `http://localhost:3010/admin`.
2. Pass Admin Basic Auth.
3. Login with admin app credentials.
4. Check overview stats.
5. Check partners list.
6. Create a test partner.
7. Add partner address.
8. Create partner user.
9. Create offer for that partner/address.
10. Open `/` and check that the offer appears.

### Partner

1. Open `http://localhost:3010/partner/login`.
2. Pass Partner Basic Auth.
3. Login as seed partner user.
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
