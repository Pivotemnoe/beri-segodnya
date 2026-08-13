# Staging Checklist

## Before Staging

- [ ] VPS created.
- [ ] SSH key access works.
- [ ] Root SSH login disabled where possible.
- [ ] Firewall enabled.
- [ ] Only `22`, `80`, `443` are publicly open.
- [ ] Node.js LTS installed.
- [ ] Git installed.
- [ ] PM2 installed.
- [ ] Caddy or Nginx installed.
- [ ] Private repo cloned.
- [ ] `.env.local` created manually on server.
- [ ] Test/default passwords replaced.
- [ ] `SESSION_SECRET` generated.
- [ ] `SITE_ACCESS_ENABLED=true`.
- [ ] `ADMIN_ACCESS_ENABLED=false` for the normal one-login admin flow.
- [ ] `PARTNER_ACCESS_ENABLED=false` for the normal one-login partner flow.
- [ ] `data/db.json` created.
- [ ] Seed executed for closed demo data.
- [ ] `data/db.json` not in Git.
- [ ] `backups/` not in Git.
- [ ] Backup works.
- [ ] Restore tested on a test copy.
- [ ] Smoke test passes.
- [ ] Domain points to VPS.
- [ ] HTTPS works.
- [ ] `X-Robots-Tag: noindex, nofollow` present.
- [ ] `/admin` data closed by the admin app session and role check.
- [ ] `/partner/*` data closed by the partner app session, role and `partner_id` scope.

## After Staging

- [ ] Main page opens after site Basic Auth.
- [ ] Offers render.
- [ ] Customer can get booking code.
- [ ] Remaining quantity decreases.
- [ ] Admin sees booking code.
- [ ] Partner sees only its own booking code.
- [ ] Partner can mark code as issued.
- [ ] Admin sees updated booking status.
- [ ] Partner application from `/partners` appears in admin.
- [ ] Contact request from `/contacts` appears in admin.
- [ ] Legal pages open.
- [ ] Consent checkboxes are visible and required.
- [ ] Backup cron writes to `logs/backup.log`.
- [ ] PM2 logs are checked.
- [ ] Disk usage checked.
- [ ] Restore tested on a copy, not on live data unless rollback is needed.

## Do Not Do on Staging

- [ ] Do not remove the public preview Basic Auth.
- [ ] Do not remove `noindex`.
- [ ] Do not use real partner data unless approved.
- [ ] Do not configure online payment.
- [ ] Do not configure delivery.
- [ ] Do not connect SMS/email campaigns.
- [ ] Do not edit the old "Что поесть" project.
