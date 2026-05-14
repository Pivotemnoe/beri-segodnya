# UI Review

Use this document for local visual review of the Beri Segodnya demo. Do not use real venue names, real addresses, real logos, or real customer data during review.

## Local URLs

Public pages:

- http://localhost:3010/
- http://localhost:3010/how-it-works
- http://localhost:3010/partners
- http://localhost:3010/contacts
- http://localhost:3010/privacy

Admin:

- http://localhost:3010/admin
- http://localhost:3010/admin?tab=overview
- http://localhost:3010/admin?tab=partners
- http://localhost:3010/admin?tab=offers
- http://localhost:3010/admin?tab=bookings
- http://localhost:3010/admin?tab=partner-applications
- http://localhost:3010/admin?tab=contact-requests
- http://localhost:3010/admin?tab=settings

Partner cabinet:

- http://localhost:3010/partner/login
- http://localhost:3010/partner/dashboard?tab=overview
- http://localhost:3010/partner/dashboard?tab=addresses
- http://localhost:3010/partner/dashboard?tab=offers
- http://localhost:3010/partner/dashboard?tab=bookings
- http://localhost:3010/partner/dashboard?tab=profile
- http://localhost:3010/partner/dashboard?tab=help

## Test Access

If public preview Basic Auth is enabled:

- Site preview: `demo` / `demo-preview`

Admin:

- Admin Basic Auth: `admin` / `admin-preview`
- Admin app login: `admin` / `admin-app-preview`

Partner area:

- Partner Basic Auth: `partner` / `partner-preview`

Seed partner users:

- `partner1` / `partner1-preview`
- `partner2` / `partner2-preview`
- `bakery1` / `bakery1-preview`

Real `.env.local` values are not committed and must not be published. If local access differs, check `.env.local` on the machine running the server.

For local UI review, the server can be started so the real login pages open without the browser Basic Auth prompt:

```bash
SITE_ACCESS_ENABLED=false ADMIN_ACCESS_ENABLED=false PARTNER_ACCESS_ENABLED=false node server.mjs
```

In that mode `/admin` still requires the admin app login, and `/partner/login` still requires a partner user login. On staging/production, set `ADMIN_ACCESS_ENABLED=true` and `PARTNER_ACCESS_ENABLED=true` if the extra Basic Auth layer is needed.

## Demo Data

The local seed includes a test partner:

- Partner: `Тестовая кулинария`
- Type: `Кулинария`
- Address: `Армавир, ул. Тестовая, 1`
- Partner user: `partner1`
- Offer: `Готовый обед сегодня`
- Price: `299 ₽`
- Old price: `420 ₽`
- Pickup window: `15:30–18:00`
- Initial quantity: `8`
- Status: active

## Admin Review

1. Open http://localhost:3010/admin.
2. Pass Admin Basic Auth if `ADMIN_ACCESS_ENABLED=true`.
3. Login with admin app credentials.
4. Check these tabs:
   - Overview
   - Partners
   - Offers
   - Bookings
   - Partner applications
   - Contact requests
   - Settings
5. In Partners, verify partner list, addresses, and partner users.
6. Create a test partner, then add a test address and partner user.
7. In Offers, create an active test offer and verify that it appears on the homepage.
8. In Bookings, verify booking codes and update a booking status.
9. In Partner applications, verify applications from `/partners` and create a partner from an application.
10. In Contact requests, verify requests from `/contacts` and update status.

## Partner Review

1. Open http://localhost:3010/partner/login.
2. Pass Partner Basic Auth if `PARTNER_ACCESS_ENABLED=true`.
3. Login as `partner1` / `partner1-preview`.
4. Check these tabs:
   - Overview
   - Addresses
   - Offers
   - Bookings
   - Profile
   - Help
5. Verify that the partner sees only `Тестовая кулинария` data.
6. Add a test address.
7. Add a test offer.
8. Open Bookings and verify only this partner's codes are shown.
9. Mark a booking as issued, no-show, or cancelled.

## Code Demo Scenario

1. Open http://localhost:3010/.
2. Click the test offer button and submit a customer name and phone.
3. Copy the generated `BS-XXXX` code.
4. Open http://localhost:3010/admin?tab=bookings and verify the code is visible.
5. Open http://localhost:3010/partner/login and login as `partner1`.
6. Open http://localhost:3010/partner/dashboard?tab=bookings and verify the same code is visible.
7. Mark the code as `Выдан`.
8. Return to http://localhost:3010/admin?tab=bookings and verify the status changed to issued.

## Storage Notes

Current MVP storage is server-side JSON in `data/db.json`. It is the source of truth for partners, addresses, offers, bookings, applications, contacts, sessions, and audit log. Browser `localStorage` is not used as the data source for these entities.
