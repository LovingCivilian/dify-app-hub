# Handoff 2026-10-09: backend B2 and the account-id Dify user, executed and merged

This session planned and ran backend rework B2 (accounts and admin) and the small PR that followed it. Both are merged into `fork/overhaul`. This file holds only what the records below don't say; read those rather than repeating them here.

## Where things stand

- **`fork/overhaul`** is at `3d59f2ef`.
  - PR #28 (B2, merge commit `771b8daa`): https://github.com/LovingCivilian/dify-app-hub/pull/28
  - PR #29 (the account-id Dify user, merge commit `3d59f2ef`): https://github.com/LovingCivilian/dify-app-hub/pull/29
- **Branch `docs/accept-adrs-0022-0026`** holds two commits, not yet pushed (pushing and merging wait for the owner's word):
  - `02ff6cf1`: ADR-0022 to ADR-0026 set to `accepted` with the adr-skill's `set_adr_status.js`, plus the decisions index's Status column;
  - this handoff and `CLAUDE.md`'s "Latest handoff" pointer.
- **Branches kept on the owner's instruction:** `feat/backend-b2-accounts` and `feat/dify-user-id` stay on GitHub and locally. Do not delete any branch until the owner says so.
- **The browser check was not done.** The owner was remote and merged both PRs on the strength of the gates. The check lists are in the Testing sections of PR #28 and PR #29; offer them again when the owner is back at the machine.
- **The local Docker stack (`localhost:5300`)** runs an image built from `feat/dify-user-id`, which is the content of `3d59f2ef`. The local database has one account, now the `owner`. Its Dify `user` is its UUID.

## Records (read these, don't repeat them)

- **Plan:** `docs/superpowers/plans/2026-10-08-backend-b2-accounts.md`. Its header carries deviations 1–7 and decisions a–k. The run changed some of them; ADR-0024 records the outcome.
- **ADR-0024:** B2's decisions, each with its source.
- **ADR-0026:** the Dify end user is `users.id`. It records the owner's future features (a Langfuse user-page link; passing email and username to Dify apps that declare such inputs) and the B3 rule: link LDAP accounts by `entryUUID`/`objectGUID`, never `mail`.
- **B2 run records:** `docs/superpowers/research/2026-10-07-backend-rework/b2-execution/`:
  - `ledger.md` and `rulings.md` (the owner's decisions first);
  - the three pre-flight reviews;
  - the whole-branch review;
  - the fix-wave report.
- **The identity research:** `docs/superpowers/research/2026-10-08-dify-user-identity.md`. It covers Dify 1.17.1's source and docs, Langfuse, LDAP's stable identifiers and reference projects, and is input for B3.
- **What B2 and B3 leave open:** `CLAUDE.md` "Open follow-ups" and ADR-0024's Consequences.
- **The PR texts:** in the PRs themselves. The local copies in `tmp/` are scratch.

## Owner decisions this session

Not all of these are in the plan's header.

- **Accounts:**
  - Three roles: `owner`, `admin` and `user`. The owner is the `/init` account; it is never deleted or demoted and is edited only by itself. Only the owner manages admins; admins manage users. Nobody changes their own role.
  - The app is internal: most accounts will come from LDAP in B3. Local accounts are created by an admin.
- **Passwords and reset:**
  - Forgot and reset password keep their inherited handlers. SMTP is a future feature, and the login page hides "Forgot password?" unless SMTP is configured.
  - The password maximum is 72 UTF-8 bytes (OWASP, bcrypt). It replaced the plan's 128 characters.
- **`/init`:** worded "owner".
- **Hydration:** Playwright's product-side hydration fix, disabling controls until hydrated, was considered and declined (`CLAUDE.md` follow-ups).
- **Identity:** the Dify user is the account UUID, as a clean cut (no real chat history existed). `fork/main` is ignored for this.
- **ADRs:** ADR-0022 to ADR-0026 accepted, on the pending docs branch.

## How the owner wants work run (learned or reinforced this session)

- **ADR-0002 governs every decision, the controller's rulings included.** When a review finding names a documented route, take it, even for a Minor finding and even against the plan. "Small risk" and "the repo already does it" are not reasons. The owner had to remind me of this; memory `prefer-standard-approaches` records it. In a subagent run, write it into the run's rules file as rule R0 from the start.
- **Model choice:** Opus and Sonnet are available, and Fable was out of budget on 2026-10-08. The owner wants the riskiest reviews on Opus. Upgrading a planned Sonnet review to Opus for security or concurrency work was welcome.
- **Never push, open a PR or merge without the owner's word.** Ask again for each PR. "Merge" here means a merge commit, and no `--delete-branch` for now.

## Environment facts learned this session

- **Subagent reports:** a subagent's harness sometimes blocks writing its report file. Save the report from its reply into the run folder yourself before dispatching the reviewer.
- **The SDD `review-package` script** names its folder after the plan file's basename. A plan called `brief.md` writes to `.superpowers/sdd/brief/`; move the package into the run folder and remove that stray folder.
- **No `.ts` or `.tsx` files under `tmp/`.** The root `tsconfig.json` includes `**/*.ts`, so such a file breaks every tsc gate and vitest. Fetched or probe TypeScript goes in as `.ts.txt` or `.mts`. The identity research's files were renamed; the list is `tmp/identity-research-renamed-to-txt.list`.
- **`.next/dev/types` goes stale after deleting a route.** It is written by `next dev` and included by tsconfig, so tsc fails until the next `next dev` run, for example a Playwright run, regenerates it.
- **The full e2e suite** takes about 20 minutes: 465 passed and 19 skipped on B2's final tree.
- **The adr-skill's `set_adr_status.js`** appends a trailing blank line; oxfmt (and the pre-commit hook) removes it.
- **`.superpowers/sdd/2026-10-08-backend-b2-accounts/` and `…/2026-10-08-dify-user-id/`** are git-ignored run workspaces. B2's are committed in the `b2-execution` folder; the identity run's ledger is not committed. Remove them only when the owner agrees.

## Next step: B3

B3 covers groups, per-app access and LDAP, starting with its own brainstorm. Its inputs:

- the charter's B3 row (`docs/superpowers/specs/2026-10-07-backend-rework-charter.md` §5);
- ADR-0024 and ADR-0026 (the B3 linking rule);
- the identity research §4 (LDAP and Active Directory attributes);
- memory `end-user-identity-goal`, which holds the owner's LDAP model:
  - each account tagged local or LDAP;
  - an account removed from LDAP becomes deactivated;
  - LDAP accounts are created at first login, with no stored password;
  - the directory is re-checked periodically through a service account;
  - deactivate rather than delete;
  - an LDAP login never takes over a local account with the same email.

The charter's §2 Identity row is superseded by ADR-0026, which is accepted on the pending docs branch.

## Suggested skills

- `superpowers:brainstorming`: first, for B3's design.
- `superpowers:writing-plans`, then `superpowers:subagent-driven-development`: once the owner approves B3's design.
- `adr-skill`: for B3's decisions; the project copy is `.claude/skills/adr-skill`.
- `find-docs` (Context7): for the LDAP client library, next-auth's Credentials provider, and Drizzle.
- `deep-research`: if the LDAP library choice or the AD attribute behaviour needs a sourced survey.
- `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`: at the end of the run.
- `antd`: for any admin UI change, such as the account source tag or deactivation.

## Suggested kick-off prompt

> Read docs/superpowers/handoffs/2026-10-09-backend-b2-and-dify-user-id-execution.md, then CLAUDE.md. If the branch docs/accept-adrs-0022-0026 is still unpushed, ask me whether to push and merge it. Then start B3 with superpowers:brainstorming, from the charter's B3 row, ADR-0024, ADR-0026 and docs/superpowers/research/2026-10-08-dify-user-identity.md §4. Don't delete any branches.
