# Deployment Readiness Checklist

- [x] Backend works locally.
- [x] Public API works.
- [x] Admin API works.
- [x] Partner API works.
- [x] Admin panel opens after one admin app login.
- [x] Partner cabinet opens after one partner app login.
- [x] Admin access is handed off outside Git in a `0600` credential file.
- [x] Partner access is handed off outside Git in a `0600` credential file.
- [x] Admin can see partner applications.
- [x] Admin can see contact requests.
- [x] Admin can see bookings.
- [x] Partner can see own bookings.
- [x] Partner API is scoped to own partner data.
- [x] Client can get a booking code.
- [x] Offer remaining quantity decreases after booking.
- [x] Booking cancellation restores quantity while the offer is available.
- [x] Old/expired offers are excluded from the public API.
- [x] Smoke test uses isolated temporary storage and does not mutate staging data.
- [x] Raw app session tokens are not stored.
- [x] Data is stored server-side and survives server restart when `data/` persists.
- [x] `.env.local` is ignored by Git.
- [x] No real venue names are used.
- [x] No real venue addresses are used.
- [x] No real logos are used.
- [x] Robots noindex is enabled.
- [x] Security headers are enabled.
- [x] README is updated with deploy docs.
- [x] `docs/ACCESS.md` exists.
- [x] `docs/DEPLOYMENT.md` exists.
- [x] `docs/ENVIRONMENT.md` exists.
- [x] Smoke test exists.
- [x] Site runs on `http://localhost:3010`.
- [x] Old site "Что поесть" was not changed.
- [x] VPS/staging server is provisioned.
- [x] Staging `.env.local` exists on the server with `0600` mode.
- [x] Storage backup process and cron are configured and tested.
- [x] Domain DNS is configured.
- [x] HTTPS certificate and HSTS are active.
- [x] Release `1aee6d2` passed the full Node `24.19.0` gate and isolated PM2 rehearsal on the VPS before synchronization.
- [x] Pre-deploy and post-deploy backups passed temporary restore rehearsals.
- [x] Live client/admin/partner desktop and mobile acceptance passed.
- [x] Previously published credentials were rotated and old values return `401`.
- [x] PWA manifest, service worker, icons and Digital Asset Links are live.
- [x] App-specific Node `24.19.0`, PM2 interpreter, backup cron, rollback evidence and 36-check HTTPS role acceptance are verified.
- [x] Source release `569b4da` pins AGP `9.3.1`/Gradle `9.5.0`, 53 release dependencies and SHA-256 verification for 633 artifacts.
- [x] Android release dependency OSV gate, offline Gradle configuration and real-key signing preflight passed.
- [x] GitHub PR #1 merged into `main`; remote `main` and tag `pilot-web-2026-08-23` resolve to `569b4da`.
- [x] GitHub Actions run `32641699229` passed both `pilot-gate` and `android-source-gate`, including strict dependency verification, `lintRelease` and `assembleRelease`.
- [ ] Legal/operator configuration is complete and `LEGAL_OPERATOR_READY=true` is approved.
- [ ] Signed APK is built, verified and installed on an Android target.
- [ ] Dedicated `deploy` SSH key and app-specific alert delivery are verified.

Result: the deployed web/PWA is ready for an internal technical rehearsal without real personal data, and the integrated source/CI gate is green. The signed APK/device acceptance, legal/operator configuration and external operating gates remain open. Source changes after `569b4da` must pass a new PR before deployment.

Public production remains blocked by the items in `docs/PILOT_READINESS.md`.
