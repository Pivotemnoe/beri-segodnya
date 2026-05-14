# Architecture

`beri-segodnya` is a closed MVP for limited same-day food offers in Armavir.

## Parts

- Public website: `/`, `/how-it-works`, `/partners`, `/contacts`, `/privacy`.
- Backend API: `/api/public/*`, `/api/admin/*`, `/api/partner/*`.
- Admin panel: `/admin`.
- Partner dashboard: `/partner/login`, `/partner/dashboard`.
- Storage: server-side JSON in `data/db.json`.
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

- Offers are available through `GET /api/public/offers` and rendered server-side on the public page.
- Booking modal calls `POST /api/public/bookings`.
- Partner application form calls `POST /api/public/partner-applications`.
- Contact form calls `POST /api/public/contact-requests`.
- Admin and partner dashboards read/write through role-protected APIs.

localStorage is no longer the source of truth. Old browser demo data is ignored.

## Storage choice

JSON storage is a temporary replacement for SQLite because package installation is unavailable in the current environment. It is isolated behind repositories so it can be replaced later.
