# Go-Live Checklist

## Technical

- [x] VPS selected.
- [x] App-specific Node.js `24.19.0` installed, checksum-verified, staged, switched under PM2, backed up, and accepted on live; system Node left unchanged.
- [x] PM2 configured as one fork process under `deploy`.
- [x] Caddy configured.
- [x] HTTPS and HSTS enabled.
- [x] `APP_BASE_URL` and `APP_DOMAIN` set.
- [x] Staging `.env.local` created manually and mode is `0600`.
- [x] `data/` storage on persistent disk.
- [x] Backup procedure tested on live.
- [x] Restore procedure tested four times in temporary directories.
- [x] Android source pins JDK 17, AGP `9.3.1` and official Gradle `9.5.0` with verified wrapper/distribution hashes.

## Security

- [x] Published preview/admin/partner passwords replaced; old values return `401`.
- [x] `SESSION_SECRET` is present and at least 32 characters.
- [ ] SSH key-only access.
- [ ] Root login disabled.
- [x] Firewall and fail2ban enabled.
- [ ] Live access boundary reconciled: Basic Auth is restored or the current public prelaunch mode is formally approved.
- [x] Admin and partner access separated.
- [x] API role checks verified.
- [x] Rate limit and cleanup added for login and forms.
- [x] Security headers verified on live HTTPS.
- [x] `noindex` remains until public launch.
- [x] 53 APK runtime dependencies are locked and OSV-clean; 634 Gradle artifacts require SHA-256 verification without trust bypasses.
- [x] GitHub workflow uses read-only contents permission, immutable action SHAs and no persisted checkout credential.

## Legal

- [x] Operator details are published on live as of 20.08.2026.
- [x] Privacy policy is filled with operator details on live.
- [x] Consent is filled with operator details on live.
- [x] Terms are filled with operator details on live.
- [x] Partner terms are filled with operator details on live.
- [x] Forms have required checkboxes and server-side consent enforcement.
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

- [x] `node --check server.mjs` / full build contract.
- [x] `npm run test:smoke` on isolated storage.
- [x] Customer flow checked locally; live forms are open, but no acceptance-test record was submitted.
- [x] Admin scenario on live with rotated credentials.
- [x] Partner scenario on live with rotated credentials.
- [x] Backup/restore test.
- [x] Public/admin/partner pages checked on mobile and desktop.
- [x] Admin/partner APIs closed without role session.
- [x] Android config/build/security gates and real-key signing preflight passed without installing Android SDK packages or accepting a license.
- [x] Android GitHub Actions run `32641699229` passed `pilot-gate` and `android-source-gate` after merge to `main`.
- [x] Storage-backed `/api/public/health` readiness contract is covered by the isolated smoke test.
- [ ] Real Android/iPhone PWA standalone and camera/background/resume.
- [x] Signed APK build, signature/fingerprint/alignment/manifest verification and SHA-256 publication check.
- [ ] Signed APK install and acceptance on a physical Android device.
