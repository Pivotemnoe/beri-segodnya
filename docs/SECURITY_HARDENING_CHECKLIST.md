# Security Hardening Checklist

Use this checklist before staging and production launch.

## VPS

- SSH only by key.
- Root login disabled.
- UFW enabled.
- Open only required ports: `22`, `80`, `443`.
- Use `fail2ban` where practical.
- Enable automatic security updates where practical.
- Restrict project directory permissions to the app user.

## HTTPS

- Use Caddy or Nginx + Certbot.
- Redirect `http` to `https`.
- Check certificate renewal.
- Set `APP_BASE_URL` to the public HTTPS URL.

## Environment

- `.env.local` is not in Git.
- Production secrets are unique.
- Replace all test passwords.
- Generate a unique `SESSION_SECRET`.
- Set `APP_ENV=production`.
- Keep `SITE_ACCESS_ENABLED=true` on staging.
- Keep `ADMIN_ACCESS_ENABLED=true` and `PARTNER_ACCESS_ENABLED=true` unless protected by another upstream layer.

## App

- Separate preview, admin, and partner access.
- Role-based API access remains enabled.
- No stack traces in production responses.
- Security headers enabled.
- Robots `noindex` enabled until public launch is approved.
- Add rate limits for login and public forms before broad traffic.
- Keep input validation on server-side routes.

## Data

- `data/db.json` or future DB file is not in Git.
- `backups/` is not in Git.
- Restrict permissions for `data/` and `backups/`.
- Run `npm run backup:data` before deploys and restores.
- Test restore on staging.
- Move from JSON storage to SQLite/PostgreSQL for higher reliability before serious production use.

## Monitoring

- PM2 or systemd process supervision.
- PM2/systemd logs monitored.
- Disk usage monitored.
- Server uptime monitored.
- Backup status checked.
- Alert on repeated login failures where possible.
