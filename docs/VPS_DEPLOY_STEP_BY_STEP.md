# VPS Deploy Step by Step

This is a practical staging deploy guide for `beri-segodnya`. It does not open public production. Keep the public preview Basic Auth enabled, keep `noindex`, and do not use real partner data until legal and operational checks are complete.

Recommended staging stack:

- VPS with persistent disk;
- Ubuntu 24.04 LTS;
- Node.js LTS;
- PM2;
- Caddy reverse proxy with automatic HTTPS;
- current server-side JSON storage in `data/db.json`.

For closed staging, this is the simplest safe setup. For public production with real traffic and real personal data, plan a database upgrade to SQLite/PostgreSQL before launch.

## 1. VPS Requirements

Minimum:

- 1 vCPU;
- 1 GB RAM;
- 20 GB SSD;
- Ubuntu 24.04 LTS;
- public IPv4.

Recommended:

- 2 vCPU;
- 2 GB RAM;
- 40 GB SSD;
- Ubuntu 24.04 LTS;
- provider snapshot/backup.

The MVP accepts up to three partner photos per offer and stores them on the VPS. It does not process online payments, delivery, or high-load background jobs. A small VPS is enough for closed staging, but 2 GB RAM is better for image processing in the browser, package updates, PM2, and HTTPS proxy work.

## 2. Prepare Server

SSH as root only for initial setup:

```bash
ssh root@SERVER_IP
apt update
apt upgrade -y
apt install -y curl git ufw fail2ban ca-certificates gnupg
```

Set timezone if needed:

```bash
timedatectl set-timezone Europe/Moscow
```

## 3. Create Deploy User

```bash
adduser deploy
usermod -aG sudo deploy
```

Copy SSH key access:

```bash
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

Then login as deploy:

```bash
ssh deploy@SERVER_IP
```

If key login works, harden SSH:

```bash
sudo nano /etc/ssh/sshd_config
```

Recommended settings:

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Restart SSH:

```bash
sudo systemctl restart ssh
```

Keep the current SSH session open until a new deploy-user SSH session is confirmed.

## 4. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Only ports `22`, `80`, and `443` should be open publicly. The Node app listens on local port `3010` behind Caddy.

## 5. Install Node.js LTS

Use NodeSource LTS repository:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 6. Install Git

```bash
sudo apt install -y git
git --version
```

For a private GitHub repo, configure SSH deploy key or GitHub CLI/token according to the repo policy.

## 7. Install PM2

```bash
sudo npm install -g pm2
pm2 -v
```

## 8. Clone Project

Choose a project directory:

```bash
sudo mkdir -p /var/www
sudo chown deploy:deploy /var/www
cd /var/www
git clone <PRIVATE_REPO_URL> beri-segodnya
cd beri-segodnya
```

Do not clone or edit the old "Что поесть" project from this deploy flow.

## 9. Create `.env.local`

Create the file manually on the server:

```bash
nano .env.local
chmod 600 .env.local
```

Template:

```text
APP_ENV=staging
APP_BASE_URL=https://example.ru
APP_DOMAIN=example.ru
PORT=3010

SESSION_SECRET=replace

SITE_ACCESS_ENABLED=true
SITE_ACCESS_USER=replace
SITE_ACCESS_PASSWORD_SHA256=replace

ADMIN_ACCESS_ENABLED=false
ADMIN_ACCESS_USER=replace
ADMIN_ACCESS_PASSWORD_SHA256=replace

PARTNER_ACCESS_ENABLED=false
PARTNER_ACCESS_USER=replace
PARTNER_ACCESS_PASSWORD_SHA256=replace

ADMIN_APP_LOGIN=replace
ADMIN_APP_PASSWORD_HASH=replace
ADMIN_APP_PASSWORD_SALT=replace

DB_DRIVER=json
DB_FILE=data/db.json

HOST=127.0.0.1
TRUST_PROXY=true

NEXT_PUBLIC_APP_NAME=Бери сегодня
NEXT_PUBLIC_APP_CITY=Армавир
NEXT_PUBLIC_DEMO_MODE=false
```

Do not paste real `.env.local` values into chat or Git.

Generate `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Generate SHA-256 for Basic Auth passwords:

```bash
node -e "const crypto=require('crypto'); console.log(crypto.createHash('sha256').update('PASSWORD').digest('hex'))"
```

Use the hash for:

- `SITE_ACCESS_PASSWORD_SHA256`;
- `ADMIN_ACCESS_PASSWORD_SHA256`;
- `PARTNER_ACCESS_PASSWORD_SHA256`.

Generate admin app PBKDF2 hash/salt:

```bash
node --input-type=module -e "import { createPasswordHash } from './backend/utils/password.mjs'; console.log(createPasswordHash('PASSWORD'))"
```

Put `hash` into `ADMIN_APP_PASSWORD_HASH` and `salt` into `ADMIN_APP_PASSWORD_SALT`.

## 10. Install Dependencies

Current project has no runtime dependencies, but still run:

```bash
npm install
```

This verifies Node/npm and keeps the workflow ready if dependencies are added later.

## 11. Seed or Verify `data/db.json`

Current storage is server-side JSON:

```text
data/db.json
```

Create storage and seed test data:

```bash
npm run db:seed
```

If you need an empty reset first:

```bash
npm run db:reset
npm run db:seed
```

Important:

- `data/db.json` is not in Git;
- keep it on persistent VPS disk;
- restrict access to the deploy user;
- do not put real partner data into staging until approved.

Recommended permissions:

```bash
chmod 700 data backups logs
chmod 600 data/db.json
```

## 12. Start with PM2

```bash
pm2 start server.mjs --name beri-segodnya
pm2 status
pm2 logs beri-segodnya
```

Check local port:

```bash
curl -I http://127.0.0.1:3010/
```

Save PM2 process list:

```bash
pm2 save
```

## 13. PM2 Autostart

Generate startup command:

```bash
pm2 startup
```

PM2 prints a command. Copy and run it with `sudo`. Then:

```bash
pm2 save
sudo reboot
```

After reboot:

```bash
pm2 status
curl -I http://127.0.0.1:3010/
```

## 14. Install Caddy

Caddy is recommended for this MVP because HTTPS is automatic and config is small.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

## 15. Configure Caddy

Edit:

```bash
sudo nano /etc/caddy/Caddyfile
```

Recommended staging Caddyfile:

```text
example.ru {
  reverse_proxy 127.0.0.1:3010
}

www.example.ru {
  redir https://example.ru{uri}
}
```

Replace `example.ru` with the real staging domain.

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

## 16. Domain and DNS

At the domain registrar:

1. Add `A` record for root domain to VPS IPv4.
2. Add `A` record for `www` to VPS IPv4, or `CNAME www` to root domain if supported.
3. Wait for DNS propagation.

Check from local machine:

```bash
dig example.ru
dig www.example.ru
```

Caddy automatically issues HTTPS certificates after DNS points to the VPS and ports `80/443` are open.

## 17. HTTPS Check

```bash
curl -I https://example.ru/
curl -I https://www.example.ru/
```

Expected:

- HTTPS works;
- `www` redirects if configured;
- responses include `X-Robots-Tag: noindex, nofollow`;
- site is protected by Basic Auth where enabled.

## 18. Backup

Create directories:

```bash
mkdir -p backups logs
```

Manual backup:

```bash
npm run backup:data
```

The command creates both `backups/db-<timestamp>.json` and `backups/uploads-<timestamp>/`. Copy both to a separate protected storage location; a backup on the same VPS is not sufficient by itself.

Restore:

```bash
npm run restore:data -- backups/db-YYYY-MM-DD-HH-mm-ss.json
```

Prune old backups, default 14 days:

```bash
npm run backup:prune
```

Keep 30 days:

```bash
BACKUP_KEEP_DAYS=30 npm run backup:prune
```

Cron example, daily at 03:00:

```bash
crontab -e
```

Add:

```text
0 3 * * * cd /var/www/beri-segodnya && /usr/bin/node scripts/backup-data.mjs >> logs/backup.log 2>&1
30 3 * * * cd /var/www/beri-segodnya && BACKUP_KEEP_DAYS=30 /usr/bin/node scripts/prune-backups.mjs >> logs/backup.log 2>&1
```

Confirm Node path:

```bash
which node
```

If Node path is not `/usr/bin/node`, update cron.

## 19. Smoke Test on Server

The smoke test supports `http` and `https` and Basic Auth test credentials from env.

Set test credentials for staging shell only:

```bash
export TEST_SITE_ACCESS_USER=replace
export TEST_SITE_ACCESS_PASSWORD=replace
export TEST_ADMIN_ACCESS_USER=replace
export TEST_ADMIN_ACCESS_PASSWORD=replace
export TEST_ADMIN_APP_LOGIN=replace
export TEST_ADMIN_APP_PASSWORD=replace
export TEST_PARTNER_ACCESS_USER=replace
export TEST_PARTNER_ACCESS_PASSWORD=replace
export TEST_PARTNER_LOGIN=partner1
export TEST_PARTNER_PASSWORD=partner1-preview
```

Run:

```bash
APP_BASE_URL=https://example.ru node scripts/smoke-test.mjs
```

The smoke test checks:

- public offers;
- booking creation;
- remaining quantity decrement;
- partner application creation;
- contact request creation;
- admin app login and dashboard;
- admin partners/offers/bookings/applications/contacts;
- partner login and dashboard/profile/addresses/offers/bookings;
- partner isolation for seed partner data.

Smoke test creates test records in staging storage. Run backup first if you need to preserve a clean state.

## 20. UI Check after Deploy

Open:

- `https://example.ru/`
- `https://example.ru/how-it-works`
- `https://example.ru/partners`
- `https://example.ru/contacts`
- `https://example.ru/privacy`
- `https://example.ru/personal-data-consent`
- `https://example.ru/terms`
- `https://example.ru/partner-terms`
- `https://example.ru/admin`
- `https://example.ru/partner/login`
- `https://example.ru/partner/dashboard`

Checklist:

1. Main page opens after Basic Auth.
2. Offers are visible.
3. Booking code is created.
4. Admin sees the code.
5. Partner sees the code.
6. Partner marks code as `Выдан`.
7. Admin sees updated status.
8. Partner application reaches admin.
9. Contact request reaches admin.
10. Backup works.

## 21. Admin Check

1. Open `https://example.ru/admin`.
2. Login with admin app login.
4. Check tabs:
   - overview;
   - partners;
   - offers;
   - bookings;
   - partner applications;
   - contact requests;
   - settings.
5. Confirm admin sees all partners/offers/bookings/applications/contact requests.

## 22. Partner Check

1. Open `https://example.ru/partner/login`.
2. Login as a seed/test partner user.
4. Open `https://example.ru/partner/dashboard?tab=bookings`.
5. Confirm the partner sees only its own offers and bookings.

## 23. Rollback

Minimal code rollback:

```bash
cd /var/www/beri-segodnya
pm2 stop beri-segodnya
git log --oneline
git checkout <commit>
npm install
pm2 restart beri-segodnya
pm2 logs beri-segodnya
```

Data rollback if needed:

```bash
npm run restore:data -- backups/db-YYYY-MM-DD-HH-mm-ss.json
pm2 restart beri-segodnya
```

Verify:

```bash
APP_BASE_URL=https://example.ru node scripts/smoke-test.mjs
```

If rollback uses a detached commit, create a branch later before making new changes.

## 24. Update Project after New Commits

Before update:

```bash
cd /var/www/beri-segodnya
npm run backup:data
```

Update:

```bash
git status
git pull
npm install
node --check server.mjs
pm2 restart beri-segodnya
pm2 logs beri-segodnya
```

Verify:

```bash
APP_BASE_URL=https://example.ru node scripts/smoke-test.mjs
```

## 25. Notes before Public Production

Closed staging can use current JSON storage if backups are configured. Public production should not rely on local JSON storage for long-term operation unless load and operational risk are explicitly accepted.

Recommended before public production:

- move to SQLite on persistent VPS or PostgreSQL managed DB;
- add rate limiting for login/forms;
- fill legal operator details;
- resolve RKN notification;
- confirm Russian data localization;
- replace all test passwords and test data;
- keep admin/partner access separated;
- remove `noindex` only after legal and content approval.
