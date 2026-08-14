# Node 24 runtime migration

This runbook changes only the `beri-segodnya` application runtime. It does not
replace `/usr/bin/node`, reinstall the system PM2 daemon, or change another
service on the VPS.

## Pinned runtime

- Node.js: `24.19.0` (24.x Active LTS at the time of this release).
- Linux artifact: `node-v24.19.0-linux-x64.tar.xz`.
- Expected SHA-256:
  `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647`.
- Application path:
  `/opt/beri-segodnya/node-v24.19.0-linux-x64/bin/node`.

Verify the checksum against the official `SHASUMS256.txt` from
`https://nodejs.org/dist/v24.19.0/` before extraction. Keep the extracted
runtime owned by `root:root` and read-only for the `deploy` user.

## Compatibility gate

Run the release in a separate directory before touching the live process:

```bash
export BERI_NODE_ROOT=/opt/beri-segodnya/node-v24.19.0-linux-x64
export PATH="$BERI_NODE_ROOT/bin:/usr/bin:/bin"
node --version
npm ci
npm run build
npm run test:security
npm run test:backup
npm run test:api
npm audit --omit=dev
```

The API smoke test uses an isolated temporary database and a fixed midday test
clock, so its offer-availability assertions do not depend on the wall-clock
time at which CI or deployment runs.

Rehearse the PM2 definition with a separate temporary `PM2_HOME`, an unused
loopback port, `BERI_SEGODNYA_CWD` pointing to the staged release, and temporary
database/upload paths. Confirm `pm2 describe beri-segodnya` reports the pinned
interpreter and Node version, then delete the probe process and its temporary
PM2 home. This rehearsal must not attach to the live PM2 daemon.

## Pre-switch evidence

Before the restart, create a root-only backup containing at least:

- the current stateless application archive;
- `.env.local`, `data/db.json`, and `data/uploads/`;
- the `deploy` PM2 dump and crontab;
- the current `.release.json` marker;
- collection counts and SHA-256 manifests.

Verify the manifest and unpack the archive in a temporary directory. Record the
current PM2 interpreter, process status, restart count, log sizes, application
health, and collection counts.

## Switch only this process

The application reads its protected configuration from `.env.local`. The PM2
definition therefore contains no credentials.

```bash
cd /var/www/beri-segodnya
BERI_SEGODNYA_NODE=/opt/beri-segodnya/node-v24.19.0-linux-x64/bin/node \
  pm2 startOrReload ecosystem.config.cjs --only beri-segodnya --update-env
pm2 save
pm2 describe beri-segodnya
```

The description must show the pinned interpreter and Node `24.19.0`. Confirm
that the process still listens only on `127.0.0.1:3010` and repeat the public,
admin, partner, legal-gate, and security-negative checks through HTTPS.

Update only the `deploy` user's two application cron entries to use:

```text
/opt/beri-segodnya/node-v24.19.0-linux-x64/bin/node
```

Run one manual backup and prune dry-run equivalent after the cron change, then
check the backup manifest and permissions.

## Rollback

If health, logs, role checks, or data counts diverge, return only this process
and its cron entries to the previous interpreter:

```bash
cd /var/www/beri-segodnya
BERI_SEGODNYA_NODE=/usr/bin/node \
  pm2 startOrReload ecosystem.config.cjs --only beri-segodnya --update-env
pm2 save
```

Restore the backed-up `deploy` crontab, confirm `/usr/bin/node` in `pm2
describe`, and repeat health and data-integrity checks. Do not restore an older
database merely to roll back the runtime. The app-specific Node directory can
remain in place until the incident is reviewed.
