# Deployment Readiness Checklist

- [x] Backend works locally.
- [x] Public API works.
- [x] Admin API works.
- [x] Partner API works.
- [x] Admin panel opens after one admin app login.
- [x] Partner cabinet opens after one partner app login.
- [x] Test admin access is documented.
- [x] Test partner access is documented.
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
- [ ] Production VPS/staging server is provisioned.
- [ ] Production `.env.local` is created on the server.
- [ ] Production storage backup process is configured.
- [ ] Domain DNS is configured.
- [ ] HTTPS certificate is issued.

Result before DNS/server work: ready for VPS/staging transfer, not yet deployed.

Public production remains blocked by the items in `docs/PILOT_READINESS.md`.
