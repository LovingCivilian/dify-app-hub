---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (Task 12 production check and review)
---

# Pin `@ant-design/cssinjs` to the version Ant Design depends on

## Context and Problem Statement

The foundation plan's production check (`pnpm build`, fetch `/login`, count `<style>` tags and `--ant-color-primary` occurrences) returned 0 and 0: the production first paint was unstyled. Cause: upstream's `package.json` pinned `@ant-design/cssinjs ^1.24.0` while antd 6.6.5 depends on `@ant-design/cssinjs ^2.1.2`; `@ant-design/nextjs-registry` declares cssinjs as a peer (`>=1.0.0`), which pnpm resolved to the root's 1.x copy, so `AntdRegistry`'s `createCache`/`extractStyle` came from a different module than the cache antd wrote into, and extraction returned nothing. This defect exists on `fork/main` today. Antd's Next.js guide states the version must be consistent with the one inside antd's `node_modules` (its Pages Router note; the mechanism is the same for the App Router registry).

## Decision

Keep an explicit direct dependency on `@ant-design/cssinjs` in `package.json` and pin it to the range antd depends on (`^2.1.2` for antd 6.6.5). On every antd bump, align it (`pnpm why @ant-design/cssinjs` must show one version). This crosses the plan's "bump only within majors" rule; the documented requirement wins ([ADR-0002](0002-use-documented-library-approaches-only.md)).

Non-goals: removing the direct dependency (the official App Router example has none, but with pnpm the explicit pin is what makes the registry's peer resolve to antd's copy).

## Consequences

- Good, because the production `/login` HTML now carries `<style id="antd-cssinjs">` with the token block (24 `--ant-color-primary` occurrences), so the first paint is styled and the alias bridge ([ADR-0012](0012-alias-legacy-theme-variables-to-antd-tokens.md)) needs no fallbacks.
- Bad, because the pin must be revisited on each antd major or minor that moves cssinjs; a drift reproduces the bug silently.
- Neutral, because `@ant-design/icons` has the same shape of issue in a milder form (5.6.1 direct, 6.3.4 under antd/X: two bundles, no functional defect) — a future dependency pass may align it with the same reasoning.

## Implementation Plan

- **Affected paths**: `package.json`, `pnpm-lock.yaml`; `docs/frontend-conventions.md` Status (production check), `CLAUDE.md` "Frontend overhaul".
- **Dependencies**: `@ant-design/cssinjs` ^2.1.2 (antd 6.6.5); transitive `@rc-component/util` re-resolved 1.11.1 → 1.13.0.
- **Patterns to follow**: after `pnpm update antd`, run `pnpm why @ant-design/cssinjs` and align the pin; rerun the production check.
- **Patterns to avoid**: leaving two cssinjs versions in the tree; wrapping `AntdRegistry` in workarounds.

### Verification

- [x] `pnpm why @ant-design/cssinjs` → one version (2.1.2) for root, registry peer, antd, X.
- [x] `pnpm build && next start` (or the standalone server): `curl -s /login | grep -c 'id="antd-cssinjs"'` → 1.
- [ ] Docker image check before merging PR #12: the same `grep` against `http://localhost:5300/login` → 1.

## Alternatives Considered

- Fallback literals in the alias block (the plan's contingency): rejected once the root cause was found; it would have masked the defect.
- Remove the direct dependency and rely on peer auto-install: rejected for now; the explicit pin is deterministic under pnpm.

## More Information

Sources: PR #12 commit `dcf4cdb1`, Task 12 report and review, final review; antd guide `https://ant.design/docs/react/use-with-next.md`. Related: [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md).

Note, 2026-10-06 (applied on `fork/main`): the same defect existed on the line-level product (antd 6.4.3 depends on `@ant-design/cssinjs ^2.1.2`; the root pinned `^1.24.0`, so `@ant-design/nextjs-registry` resolved its peer to 1.24.0 and `pnpm why` showed two versions). The root pin is now `^2.1.2` (one version). Production build check on `/init` (a page rendered through the root layout; `/login` redirects to `/init` without a reachable database): before the fix 0 `<style id="antd-cssinjs">` tags and 0 `--ant-color-primary` occurrences, after it 1 and 24. References to ADR-0008, ADR-0012, the frontend conventions and the overhaul concern `fork/overhaul` only ([ADR-0019](0019-keep-two-product-lines.md)).
