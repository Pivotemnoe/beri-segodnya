# Local development

1. Create `.env.local` from `.env.example`.
2. Generate hashes:

```bash
node -e "const crypto = require('crypto'); console.log(crypto.createHash('sha256').update('PASSWORD').digest('hex'))"
```

3. Seed data:

```bash
node backend/db/seed.mjs
```

4. Start:

```bash
node server.mjs
```

5. Open:

```text
http://localhost:3010
```

## Test credentials

See README.

## Reset database

```bash
node backend/db/reset.mjs
```
