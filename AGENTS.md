# Agent Rules

- Do not use real venue names without explicit approval.
- Do not use real venue addresses without explicit approval.
- Do not use real logos or real partner photos without approval.
- Do not commit `.env.local`.
- Do not return localStorage as the source of truth.
- Do not add delivery, online payment, maps, reviews, ratings, or aggregator behavior without a separate task.
- Do not weaken `server.mjs` security gate.
- Read `docs/` before large changes.
- Update documentation after architecture/API/storage/auth changes.
- Run syntax checks and API smoke tests when possible.
- Keep test data neutral: `Заведение 1`, `Заведение 2`, `Тестовая пекарня`, `Тестовая кулинария`, `Тестовое кафе`.
