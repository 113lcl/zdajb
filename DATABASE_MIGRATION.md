# SQLite to PostgreSQL migration

Local development uses SQLite:

```env
DATABASE_URL="file:../database.db"
```

Production should use PostgreSQL:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?schema=public"
```

## Schemas

- Local SQLite schema: `prisma/schema.prisma`
- Production PostgreSQL schema: `prisma/schema.postgres.prisma`

## Export local data

Run locally while `.env` points to SQLite:

```bash
npm run prisma:generate
npm run data:export -- database-export.json
```

This exports questions, users, attempts, payments, access grants, progress, difficult questions, and plans.
Sessions and auth tokens are not exported on purpose.

## Prepare PostgreSQL

On the production host, set `DATABASE_URL` to the PostgreSQL connection string, then run:

```bash
npm run prisma:generate:postgres
npm run deploy:db:push
```

## Import data into PostgreSQL

Copy `database-export.json` to the production host and run:

```bash
npm run data:import -- database-export.json
```

Run this import into a clean database. If the same rows already exist, Prisma will stop on unique-key conflicts.

After import, users will need to log in again because sessions are not migrated.

## First production build

```bash
npm run deploy:check
npm run deploy:build:postgres
npm start
```

## Notes

- Use SQLite only locally.
- Do not commit `database.db`.
- Do not commit exported production data.
- If you change the Prisma schema later, update both schema files or switch the whole project to PostgreSQL only.
