# Architecture

`beri-segodnya` is a closed MVP for limited same-day food offers in Armavir.

## Parts

- Public website: `/`, `/how-it-works`, `/partners`, `/contacts`, `/privacy`.
- Backend API: `/api/public/*`, `/api/admin/*`, `/api/partner/*`.
- Admin panel: `/admin`.
- Partner dashboard: `/partner/login`, `/partner/dashboard`.
- Storage: server-side JSON in `data/db.json` and partner media in `data/uploads/`.
- Auth: Basic Auth preview gate plus HttpOnly `bs_session` cookie for admin/partner API.

## Main files

- `server.mjs`: HTTP server, HTML rendering, security gate, static assets, API mount.
- `backend/storage/jsonStore.mjs`: atomic server-side JSON storage.
- `backend/repositories/*`: data access layer.
- `backend/services/*`: auth, booking, admin, partner logic.
- `backend/routes/apiRouter.mjs`: API routing.
- `backend/utils/*`: validation, password hashing, ids, dates, JSON responses.

## Data flow

Public pages are rendered by `server.mjs` from the backend repository/storage layer. Interactive public actions call backend API with `fetch`.

- Offers are available through `GET /api/public/offers`, filtered by Moscow date, pickup end, partner/address state and remaining quantity, then rendered server-side.
- Booking modal calls `POST /api/public/bookings`.
- A booking receives a capability URL `/booking/:publicToken`; the page can read status and cancel an active booking.
- Partner application form calls `POST /api/public/partner-applications`.
- Contact form calls `POST /api/public/contact-requests`.
- Admin and partner dashboards read/write through role-protected APIs.
- The quick partner flow compresses one to three photos in the browser, strips metadata through canvas re-encoding, uploads them to a partner-scoped server folder, and creates the offer through the existing repository/service/API layers.
- Reusable offer templates are server entities. The browser may keep only an unfinished wizard draft as a UI convenience; the published offer, quantity, status and media paths remain server-side truth.

localStorage is no longer the source of truth. Old browser demo data is ignored.

## Storage choice

JSON storage is an intentional dependency-free choice for a closed single-process pilot. Writes use a temporary file plus atomic rename. It is isolated behind repositories and must be replaced by PostgreSQL before multi-process operation or material growth.

The browser may store the latest booking URL and an unfinished quick-publication draft as UI conveniences. Offers, photos, quantities, statuses, sessions and applications remain server-side truth.
