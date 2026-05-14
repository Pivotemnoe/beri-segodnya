# Go-Live Checklist

## Technical

- [ ] VPS selected.
- [ ] Node.js LTS installed.
- [ ] PM2 or systemd configured.
- [ ] Caddy or Nginx configured.
- [ ] HTTPS enabled.
- [ ] `APP_BASE_URL` and `APP_DOMAIN` set.
- [ ] Production `.env.local` created manually.
- [ ] `data/` storage on persistent disk.
- [ ] Backup procedure tested.
- [ ] Restore procedure tested on staging.

## Security

- [ ] Test passwords replaced.
- [ ] `SESSION_SECRET` unique.
- [ ] SSH key-only access.
- [ ] Root login disabled.
- [ ] Firewall enabled.
- [ ] Basic Auth enabled on staging.
- [ ] Admin and partner access separated.
- [ ] API role checks verified.
- [ ] Rate limit plan added for login and forms.
- [ ] Security headers verified.
- [ ] `noindex` remains until public launch.

## Legal

- [ ] Operator defined.
- [ ] Privacy policy filled with operator details.
- [ ] Consent filled with operator details.
- [ ] Terms filled with operator details.
- [ ] Partner terms filled with operator details.
- [ ] Forms have required checkboxes.
- [ ] RKN notification checked or submitted.
- [ ] Personal data storage location in Russia confirmed.
- [ ] Hosting/provider agreement checked.
- [ ] Lawyer review complete.

## Content

- [ ] Real partners added only with permission.
- [ ] Real addresses verified.
- [ ] Real offers agreed with partners.
- [ ] Real photos/logos used only with permission.
- [ ] Test data removed or clearly marked.

## Verification

- [ ] `node --check server.mjs`.
- [ ] `npm run test:smoke`.
- [ ] Customer booking scenario.
- [ ] Admin scenario.
- [ ] Partner scenario.
- [ ] Backup/restore test.
- [ ] Public pages checked on mobile and desktop.
- [ ] Admin/partner pages closed from public access.
