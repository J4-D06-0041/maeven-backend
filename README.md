# Maeven Collections — Backend

Simple Node + Express backend for Maeven Collections.

Quick start

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables — copy `.env.example` to `.env` and update values.

3. Test DB connectivity:

```bash
npm run test-db
```

4. Start server:

```bash
npm start
```

The server exposes a health endpoint at `GET /health` which returns the current DB time if connected.

Environment and secrets

- **Do not commit** your `.env` file. It contains database credentials and other secrets.
- Copy `.env.example` to `.env` and fill in the values locally.
- For hosted Postgres (Render, Heroku, etc.) prefer using `DATABASE_URL` with `sslmode=require`.
- If your provider requires TLS but you don't provide a CA bundle, set `DB_SSL=true` and `DB_SSL_REJECT_UNAUTHORIZED=false` (only for development/testing).

Example quick test using your connection string inline:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" DB_SSL=true DB_SSL_REJECT_UNAUTHORIZED=false npm run test-db
```
