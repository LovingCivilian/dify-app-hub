---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Keep MySQL (through Drizzle) instead of moving to PostgreSQL

## Context and Problem Statement

Upstream moved from Prisma to Drizzle ORM in May 2026 (upstream's own record: `docs/superpowers/specs/2026-05-21-prisma-to-drizzle-orm-migration-design.md`) and targets MySQL only: `drizzle.config.ts` uses `dialect: 'mysql'`, the schema uses `drizzle-orm/mysql-core`, migrations are MySQL SQL, and the Docker image runs them through `docker/entrypoint.sh`. While planning the fork's auth work, PostgreSQL was considered because the owner's other projects use it.

## Decision Drivers

- Merge-friendliness with upstream (backend changes must stay small, see [ADR-0009](0009-treat-the-frontend-as-fork-owned.md)).
- One database engine across dev loop, Docker stack and e2e suite.
- Effort versus benefit for a single-maintainer fork.

## Considered Options

- Keep MySQL 8.4 through Drizzle (upstream's setup).
- Port the schema, migrations and queries to PostgreSQL.

## Decision Outcome

Chosen option: keep MySQL, because the app is MySQL-only through Drizzle at every layer (dialect, schema types, migrations, entrypoint), a port would touch upstream-owned backend files on every sync, and nothing in the fork's roadmap needs Postgres features.

### Consequences

- Good, because upstream's migrations apply unchanged and backend syncs stay conflict-free.
- Good, because the e2e suite reuses the same engine: `docker-compose.e2e.yml` runs `mysql:8.4` on tmpfs ([ADR-0010](0010-verify-the-frontend-with-playwright-and-a-stub-dify-api.md)).
- Bad, because MySQL-specific SQL (`INSERT IGNORE`, `datetime(3)`) appears in fork code such as the e2e seed.
- Neutral, because a future Postgres move remains possible through Drizzle, at the cost of a full migration rewrite.

## Pros and Cons of the Options

### Keep MySQL

- Good, because zero backend change and zero divergence from upstream.
- Bad, because the owner's other infrastructure is Postgres-based.

### Port to PostgreSQL

- Good, because one engine across the owner's projects.
- Bad, because dialect, schema, every migration, the entrypoint and the Docker stacks change, and every upstream sync re-opens the conflict.

## Implementation Plan

- **Affected paths**: none changed; governs `drizzle.config.ts`, `db/**`, `docker-compose*.yml`, `.env*` `DATABASE_URL` values.
- **Patterns to follow**: new tables and migrations via `pnpm db:generate` / `pnpm db:migrate`; local dev uses the MySQL container on `127.0.0.1:3306` (`.env.development.local` overrides `DATABASE_URL`); schema changes need a manual migrate in the dev loop (only the container's entrypoint runs migrations automatically).
- **Patterns to avoid**: Postgres-only SQL or Drizzle `pg-core` imports.

### Verification

- [x] `drizzle.config.ts` dialect is `mysql`; `db/schema/*` imports `drizzle-orm/mysql-core`.
- [x] `docker-compose.local.yml` and `docker-compose.e2e.yml` both run `mysql:8.4`.

## More Information

Source: `CLAUDE.md` "Infrastructure" ("MySQL stays … Postgres was considered and rejected"). Upstream's migration record is inherited, not a fork decision.

Note, 2026-10-06 (copy on `fork/main`): this record was copied to the line-level product when the fork split into two lines ([ADR-0019](0019-keep-two-product-lines.md)). Its text is kept as written on `fork/overhaul`; references to ADR-0008–ADR-0014, ADR-0016–ADR-0018, the frontend overhaul, its shells and its Playwright e2e harness concern `fork/overhaul` only and have no file on this line.
