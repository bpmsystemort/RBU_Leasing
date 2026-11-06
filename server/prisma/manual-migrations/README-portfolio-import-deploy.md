# Deploying `2026-10-29-import-idempotency.sql`

This migration adds the normalized-key columns and unique indexes that make
Portfolio Import idempotent (`UnitOwner.nameKey`, `Tenant.nameKey`,
`Unit.unitKey`, plus the matching unique indexes, including on `Lease`).

On a **populated** database, applying the whole file top-to-bottom is unsafe:

- Running the `CREATE UNIQUE INDEX` statements before the backfill means
  every existing row still has a `NULL` key. The first import would then
  compute real keys that match nothing, duplicating the entire existing
  portfolio instead of updating it.
- Running the backfill *after* the indexes already exist can crash outright:
  the backfill writes computed keys for existing rows, and if any two rows
  collide (e.g. two owners whose names normalize to the same key) the unique
  index rejects the write.

## Required order (per environment)

Apply this to **each** environment's database separately: dev (`rbu_leasing`),
test (`rbu_leasing_test`), and production. Each database needs its own run —
this is not a one-time global migration.

1. Apply only the `ALTER TABLE ... ADD COLUMN` statements from the top of the
   SQL file (the column adds are safe to run alone; they only add nullable
   columns).
2. Run the backfill against that database's `DATABASE_URL`:
   ```
   node server/scripts/backfill-import-keys.mjs
   ```
   Confirm its output reports zero duplicate groups, e.g.
   `duplicate groups (must all be 0): { owners: 0, tenants: 0, units: 0, leases: 0 }`.
   If any count is non-zero, resolve those duplicates (merge or rename the
   colliding rows) before continuing — do not proceed to step 3 until this
   prints all zeros.
3. Only then apply the `CREATE UNIQUE INDEX` statements from the rest of the
   SQL file.
4. Run `npx prisma generate` so the Prisma client matches the updated schema.

On an **empty** database (no existing owners/tenants/units/leases) there is
nothing to backfill and nothing can collide, so the order does not matter —
the whole file can be run at once.

## Why this isn't `prisma migrate deploy`

Per this project's migration policy (the Prisma migration history has
diverged from the dev/test databases), schema changes are applied as manual,
idempotent SQL under `server/prisma/manual-migrations/`, not through Prisma's
migration system. `prisma migrate deploy` will **not** create these columns
or indexes — there is no corresponding migration file — so the SQL above (in
the order described) must be run by hand against each environment's
database.
