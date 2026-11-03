# prisma-seed-migration-sync

Replay pending Prisma migration SQL onto JSON seed data files, and upsert
those packs into the database from `prisma/seed.ts` or app boot.

**Public npm package. Early / experimental maturity.**

## Disclaimer — read before using

This tool is published for reuse, but **sync correctness is not guaranteed
for every Prisma migration shape**. Edge cases (complex relations, unusual
SQL, advanced type changes, multi-statement migrations Prisma emits in ways
this parser does not cover) may produce incomplete or wrong seed JSON.

- Always run with `--dry-run` first.
- Always review the summary and the git diff before committing.
- Treat `__SEED_TODO__` placeholders as required follow-up, not finished data.
- Do **not** treat a clean CLI exit as proof that seed data matches production
  intent.
- Pin a version. Expect breaking changes while the API and SQL coverage are
  still evolving.

Use at your own risk. MIT license; no warranty.

## Install

```bash
npm install prisma-seed-migration-sync
```

Peer dependencies: `prisma` and `@prisma/client` ≥ 5.

CLI:

```bash
npx prisma-seed-migration-sync sync --dir prisma/seed-data --dry-run
npx prisma-seed-migration-sync sync --dir prisma/seed-data
npx prisma-seed-migration-sync validate --dir prisma/seed-data
```

Library:

```ts
import { applySeedDataIfNeeded } from 'prisma-seed-migration-sync';
```

## What it does

- Compares Prisma migration folders to the list of migrations already applied
  to seed data.
- Replays only the **pending** migrations onto opted-in seed data files:
  - `ALTER TABLE ... ADD COLUMN` — add the field (migration default, `null`
    for nullable, or a placeholder)
  - `ALTER TABLE ... RENAME COLUMN` / `RENAME TO`
  - `ALTER TABLE ... DROP COLUMN` — remove the field
  - `ALTER TYPE ... RENAME VALUE` — rename matching string values
- Preserves existing intentional values. It only changes structure.
- Prints a summary of pending migrations and every edit so you can review
  the diff.
- Dry-run mode writes nothing.

It will **not**:

- Generate or regenerate seed rows (including from `CREATE TABLE`)
- Invent values beyond migration defaults or placeholders
- Rewrite loops, computed objects, or other seed logic
- Run as part of `prisma migrate`
- Diff against `schema.prisma` (migrations are the source of change)
- Decide whether the resulting data is correct

## Layout

Seed **data** lives in JSON files. Seed **logic** stays in `prisma/seed.ts`.

```
prisma/
  migrations/
  seed.ts
  seed-data/
    seed-sync.config.json
    CatalogCategory.json
    Project.json
```

`seed-sync.config.json`:

```json
{
  "pack": "my-app-seed",
  "schema": "../schema.prisma",
  "migrations": "../migrations",
  "omitFields": ["id", "createdAt", "updatedAt"],
  "placeholder": "__SEED_TODO__",
  "skipFiles": ["Secrets.json"],
  "appliedMigrations": []
}
```

`appliedMigrations` is the ledger. The tool updates it when you run `sync`.
An empty list with existing seed files **baselines** current migrations
(marks them applied without replaying history). After that, only new
migrations are applied to the JSON.

Every `*.json` file in the directory except the config is a seed data file.
Maintenance is **on by default**. To leave a file alone, list it in
`skipFiles` and/or set `"maintain": false` on that file.

```json
{
  "$prismaJsonSeed": {
    "format": "tree",
    "model": "CatalogCategory",
    "identityField": "slug",
    "parentRelation": "parent"
  },
  "records": [
    {
      "slug": "electronics",
      "name": "Electronics",
      "children": [
        { "slug": "headphones", "name": "Headphones" }
      ]
    }
  ]
}
```

## Intended use

1. Change and apply the Prisma schema with Prisma Migrate as usual.
2. Run this tool against the seed data directory (`--dry-run` first).
3. Review the summary and the git diff. Fill in any `__SEED_TODO__`
   placeholders.
4. Commit. Git is the undo mechanism if the result is wrong.

`applySeedDataIfNeeded({ prisma, seedDir, store })` belongs in `prisma/seed.ts`
or app boot. It upserts opted-in JSON rows into the database. It does **not**
replay migrations onto the files, and it does **not** create database tables.

To skip unchanged upserts on app boot, pass a `store` that keeps the pack
checksum **outside** Postgres (Redis, for example). A side table that Prisma
Migrate does not own shows up as drift on every `migrate dev`.

## Scope

In scope:

- JSON seed data files whose rows would be passed to Prisma `create`,
  `createMany`, or `upsert`
- Top-level model data and straightforward nested create/connect relations
- Changes driven by Prisma migrations
- Dry-run mode and a human-readable summary
- Opt-in execution: you decide when to run it and you review the result

Out of scope:

- Generating seed data
- Complex dynamic seed logic
- Hooking into `prisma migrate`
- Every Prisma relation pattern or advanced type change

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT
