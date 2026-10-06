---
status: accepted
date: 2026-10-04
decision-makers: LovingCivilian (fork owner)
---

# Leave the Ant Design / Ant Design X look as upstream has it

## Context and Problem Statement

After the i18n and login work, the owner asked whether the fork should adopt Ant Design X's chat components and antd's layout patterns instead of upstream's mix of Tailwind utility classes, Lucide icons, shadcn-style CSS variables and a few antd widgets. The question was sized while the auth work was in flight.

## Decision

At that point the fork kept the UI as upstream had it: no adoption of the X components, no restyling. Sizing showed the change touched every page, and the auth and i18n work had priority.

## Consequences

- Good, because the i18n and auth steps shipped without a UI rewrite in parallel.
- Bad, because the UI kept two styling systems (Tailwind variables and antd tokens) and dark mode only partly followed antd.

## Implementation Plan

None; the decision was to leave the code unchanged. Superseded the same day by the frontend overhaul charter once the auth and i18n steps had merged.

### Verification

- [x] Superseded; see [ADR-0008](0008-rebuild-frontend-on-ant-design-6-and-x-2.md).

## More Information

Source: `CLAUDE.md` "Infrastructure" as of PR #6 ("The Ant Design / Ant Design X look is left as upstream has it (adopting the X components was sized and dropped)"), reworded in PR #12 as superseded.

Note, 2026-10-06 (copy on `fork/main`): on `fork/overhaul` this record is superseded by ADR-0008 (the frontend rebuild). On `fork/main`, the line-level product of [ADR-0019](0019-keep-two-product-lines.md), this decision is the one in force: the Ant Design / Ant Design X look stays as upstream has it, so its status here is `accepted`. ADR-0008 has no file on this line; the body's "Superseded the same day" and its ticked Verification item describe `fork/overhaul`.
