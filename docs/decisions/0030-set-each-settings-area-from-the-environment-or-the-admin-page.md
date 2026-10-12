---
status: accepted
date: 2026-10-11
decision-makers: LovingCivilian (fork owner)
consulted: Claude Code session (settings brainstorm, plan and run)
---

# Set each settings area from the environment or the admin page

## Context and Problem Statement

Until this record every hub setting lived in environment variables, parsed once by `lib/env.ts` ([ADR-0025](0025-validate-with-zod.md)): the database, the sign-in secret, the SMTP block and, since B3b, the `LDAP_*` block ([ADR-0029](0029-sign-directory-accounts-in-over-ldap-and-keep-them-in-step-with-a-scheduled-sync.md)). The hub's name and logo were fixed in code ("Dify App Hub", `assets/images/logo.png`, `app/favicon.ico`), and the header linked to upstream's GitHub repository.

On 2026-10-11 the owner asked for the hub's own branding and, before it is built, for a foundation: every settings area can be set in one of two ways, by environment variables as today or on an admin page, chosen per area; branding is the first area, and SMTP and LDAP move onto the same layer in their own PRs. The brainstorm's decisions, taken by the owner and not re-opened, are the table in §2 of the spec `docs/superpowers/specs/2026-10-11-settings-and-branding-design.md` (owner-approved 2026-10-11).

The question: how does the hub decide, per settings area, where its values come from, store what an admin edits, and keep the deployment in control of which value wins?

## Decision Drivers

- The deployment always knows which value wins: the admin page never overrides what the deployment fixed (spec §1).
- Documented approaches only, with two or three reference projects where the docs leave a choice open ([ADR-0002](0002-use-documented-library-approaches-only.md); the run's rule R0).
- Several hub containers: the owner's deployment scales out to several containers before growing one (owner, 2026-10-07, `CLAUDE.md` "Docker stack"), so a saved value must reach every container without a shared folder or a cache to invalidate.
- Uploaded and mounted images are untrusted input. OWASP File Upload Cheat Sheet: "For images, decode and re-encode to an allowed image format, explicitly removing unnecessary metadata … Use an up-to-date library with restricted formats, resource limits, and sandboxing."
- The secrets of later areas (the SMTP password, the LDAP bind password) are stored encrypted. OWASP Cryptographic Storage Cheat Sheet: "Where available, authenticated modes should always be used … GCM and CCM … should be used as a first preference."
- Only features MySQL and PostgreSQL share ([ADR-0004](0004-keep-mysql-through-drizzle.md), note of 2026-10-09: the planned move stays a type mapping).
- The existing gates and props: the admin surface checked in the layout, the page, the action and the DAL ([ADR-0024](0024-keep-the-apps-own-data-behind-a-data-access-layer-with-server-actions-and-gate-the-admin-surface-by-role.md)); trimmed props to client components ([ADR-0020](0020-load-page-data-on-the-server.md)).

## Considered Options

The research is `docs/superpowers/research/2026-10-11-settings/`: `reference-projects.md` (13 projects, each claim read at a pinned commit) and `docs-and-standards.md` (Next 16 bundled docs, Drizzle, antd 6, sharp, the OWASP cheat sheets, Docker's secrets page).

How an area's stored values are shaped:

- **One JSON document per area** (chosen). Documenso keeps `SiteSettings { id, enabled, data Json, lastModifiedByUserId, lastModifiedAt }`, one row per area checked by a zod union (`packages/prisma/schema.prisma:1122-1129` at `documenso/documenso@38ecb21`); Grafana stores each SSO provider as one `settings` document in `sso_setting`; n8n keeps `features.ldap` and `features.oidc` as one JSON value each; Mattermost writes its whole configuration as one JSON document per save (`Configurations`), with files in `ConfigurationFiles`; GitLab moves its newer areas into per-area `jsonb` columns on `application_settings`.
- **A typed table per area.** GitLab's single `application_settings` row (about 596 columns) and its `appearances` row for branding; Cal.com's single-row `Deployment`; Payload's table per Global.
- **Key/value rows.** Twenty `keyValuePair`, Gitea `system_setting`, Discourse `site_settings`, Open WebUI `config`, Plane `instance_configurations`, Keycloak `COMPONENT_CONFIG`.

How the environment and the page share an area:

- **The environment locks the area** (chosen). n8n's per-area `*_MANAGED_BY_ENV` (for example `N8N_SSO_MANAGED_BY_ENV`) writes the environment into the row at start-up, locks the UI and answers a save with 403; Mattermost disables an environment-set field with the banner "This setting has been set through an environment variable. It cannot be changed through the System Console."; Discourse's `DISCOURSE_*` globals hide the setting and ignore writes; Gitea's configuration page shows `app.ini` read-only.
- **The database wins.** Grafana's stored SSO settings "override settings from other sources (arguments, environment variables, settings file, etc)"; Twenty's database value overrides the environment, labelled as such in its UI.
- **The environment seeds the database once, then the database wins.** Open WebUI (unless `ENABLE_PERSISTENT_CONFIG=False`), Plane (its entrypoint seeds missing keys; `SKIP_ENV_VAR`).

## Decision Outcome

Chosen: one mode variable per area, `<AREA>_MODE` = `disabled` | `env` | `database`, where `env` locks the area to the environment and `database` hands it to the admin page; one JSON document per area in `instance_settings`, its files in `instance_setting_files`; every image decoded and re-encoded to PNG by sharp; branding first. A mode set by the deployment answers "which value wins" before anyone opens the page, where database-wins and seed-once make the answer depend on what was saved and when. One document per area is checked by one zod schema and read with one primary-key lookup per request, which serves several containers with no cache. Re-encoding means the hub never serves a byte it did not produce.

The sections below record what was built on `feat/settings-branding`, including the run's rulings; where they changed the spec's text, the deviations section says so.

### The modes

- `lib/env.ts` parses `BRANDING_MODE` with zod: `disabled`, `env` or `database` (`SETTINGS_MODES` in `lib/settings/modes.ts`); unset or blank is `disabled`; any other value fails the environment parse, naming the variable. The value is read leniently, trimmed and lower-cased, through the same `blankOrLowerCased` helper as the file's `flag()` for the `*_ENABLED` flags (deviation 2).
- `disabled`: the area is off; for branding, the built-in name and logo. `env`: the area's variables, required together only in this mode (the all-or-nothing rule of the SMTP and LDAP blocks), shown read-only on the page. `database`: the page edits the values, and the area's variables are ignored. The page never changes the mode; a mode change or a changed `env` value takes a restart.
- A row is written only in `database` mode. In the other modes a stored row is ignored and kept, so switching back to `database` restores it.
- `ServerEnv.branding` is a discriminated union on `mode` (`BrandingEnv`), and every reader switches on it with an exhaustiveness check (`unhandledMode` in `lib/settings/branding.ts`; TypeScript handbook, "Exhaustiveness checking"), so a new mode fails the type check until each switch handles it.

### The data model and the Data Access Layer

- `db/schema/settings.ts`, migration `db/migrations/20261011081133_settings-branding/`:
  - `instance_settings`: `area` `varchar(32)` primary key; `data` `json` not null (Drizzle `json().$type<unknown>()`, parsed by the area's zod schema on every read and write); `updated_at` `datetime(3)`; `updated_by` `varchar(36)` null, the saving account's `users.id` with no foreign key, so deleting that account keeps the record (as `users.admin_deactivated_by`).
  - `instance_setting_files`: `area` → `instance_settings.area` `ON DELETE CASCADE`; `name` `varchar(32)`; primary key `(area, name)`; `bytes` `mediumblob` (`mode: 'buffer'`, as `dify_apps.icon_image`); `mime` `varchar(64)`; `updated_at` `datetime(3)`.
  - Both types have PostgreSQL counterparts (`jsonb`, `bytea`). The tables are not `app_settings`, because "app" means a Dify app in this codebase.
- `lib/data/settings.ts` (server-only, ADR-0024):
  - `readInstanceSetting(area)` answers the document only and takes no actor: the brand is public, since the login page shows it.
  - `readInstanceSettingChange(actor, area)` answers when and by whom (the email, through a left join) the area was last saved, gated by `assertAdmin` (Next `data-security.md`: "Perform authorization checks", "Return safe, minimal Data Transfer Objects"). Later areas' reads (SMTP, LDAP) are gated functions in this DAL too, never the callers' duty.
  - `readInstanceSettingFile(area, name)`.
  - `writeInstanceSetting(actor, area, build, files)` checks `assertAdmin`, then in one transaction locks the row (`SELECT … FOR UPDATE`, MySQL 8.4 "Locking Reads", as the house `lockGroup` does), builds the document from the locked one through the caller's pure `build(current)` (an `undefined` answer writes nothing and returns `false`), upserts it in place (Drizzle "Upsert"; MySQL 8.4 `INSERT … ON DUPLICATE KEY UPDATE`, where `REPLACE` would delete the row and cascade its files away) and applies the file changes. The transaction is re-issued on a deadlock, three attempts in all (MySQL 8.4 "How to Minimize and Handle Deadlocks": "Always be prepared to re-issue a transaction if it fails due to deadlock"), so `build` must be repeatable (deviation 4).

### Branding

- **Values** (spec §4.1): `name`, trimmed, 1–64 characters (zod 4.5 and later count Unicode code points), one name for every language; `showName`, default true, false only with a logo; `logo` and `favicon`, optional images. Whenever no logo can be drawn the name shows even with `showName` off (`effectiveShowName`), so the header and the login card are never empty. The built-in brand is "Dify App Hub" and the static import `assets/images/logo.png`, passed as `BUILT_IN_LOGO` (`{ src, width, height }`, `lib/settings/built-in-logo.ts`). `app/favicon.ico` is deleted, because a file-based icon overrides `generateMetadata` (`generate-metadata.md:114`).
- **Modules:** `lib/settings/branding-rules.ts` (client-safe: the name schema, the limits, the image paths, the view types) and `lib/settings/branding.ts` (server-only: the reader, the admin view, the save).
- **`env` mode:** `BRANDING_NAME` (required), `BRANDING_SHOW_NAME` (`true` by default; `false` without `BRANDING_LOGO_FILE` fails the parse), `BRANDING_LOGO_FILE` and `BRANDING_FAVICON_FILE` (paths inside the container, mounted read-only). The files are read and processed on first use and kept for the process. Each is checked with `fs.stat` before it is read: a regular file only (Node `stats.isFile()`; a FIFO or a device reports size 0 and would be read without end) and within the byte limit. A file that cannot be used is logged by its variable and code, never its path (`logSettingsError` in `lib/error-log.ts`, as `LDAP_CA_FILE` is logged), shown on the Branding page, and the hub runs without that image.
- **`database` mode:** the document is `{ name, showName, logo, favicon }`, each image `{ sha256, width, height }` of the processed PNG; the bytes are the rows `branding/logo` and `branding/favicon`. No row means the built-in brand (the first state). A row the schema refuses means the built-in brand and one log line. A database that does not answer also means the built-in brand and one log line (plan decision f), so the login page still renders.
- **One read per request:** `getBranding = cache(readBranding)` (React `cache`; `generate-metadata.md:195`), shared by `generateMetadata`, the root layout and the pages. A save shows on the next request in every container, with nothing to invalidate, as Documenso reads its settings per request and Open WebUI reads its database directly. The image routes call `readBranding` itself, since react.dev documents `cache` for Server Components only.

### Images

- `processBrandImage(kind, input)` in `lib/settings/images.ts`:
  1. Refuse input over the byte limit, unread: logo 512 KB, favicon 256 KB, so one save fits Next's default 1 MB Server Action body (`serverActions.md:29-45`).
  2. Decode with sharp at a pixel limit of 4096 × 4096 (`limitInputPixels`, tighter than sharp's default `0x3FFF * 0x3FFF`), sharp's default `failOn` (refused on any decoder warning) and `autoOrient` (the EXIF orientation applied first, so a phone photo stays upright; plan decision g).
  3. Accept the decoded formats PNG, JPEG and WebP only, whatever the browser declared (deviation 1: no SVG).
  4. Resize: the logo inside 768 × 192 and never enlarged (three times the largest display height of 64 px, up to 4:1); the favicon 64 × 64 `contain` on transparent.
  5. Encode PNG (sharp: "By default all metadata will be removed"), and record the SHA-256 and the output size.
- Refusals are `too_large` or `not_allowed` (plan decision b: sharp reports an unknown format and a damaged file through the same error).
- sharp is a direct dependency pinned exactly at the version Next 16.3.4 resolves, `sharp@0.35.4` (`pnpm add -E`; Next lists `sharp ^0.35.4` as an optional dependency, "required for Image Optimization", `deploying-to-platforms.md:20`, and in the built-in `serverExternalPackages`), so the tree keeps one copy, the reasoning of [ADR-0013](0013-pin-ant-design-cssinjs-to-antd-version.md).

### Serving the images

- `GET /api/branding/logo` and `GET /api/branding/favicon` (`app/api/branding/`; the favicon falls back to the logo) are public, `/api/branding` in `PUBLIC_PREFIXES` (`lib/access.ts`), because the login page shows them. `lib/settings/image-response.ts` answers as the app-icon route does: `content-type: image/png`; an ETag from the SHA-256; `cache-control: public, no-cache` (RFC 9111 §5.2.2.4); `x-content-type-options: nosniff`; `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`; `304` for a matching `If-None-Match` (RFC 9110 §13.1.2: a list of tags, the weak comparison of §8.8.3.2, `*`); the 404 envelope `{ code: 'not_found', … }` when no custom image is set. The routes read the version first (deviation 5).
- The shell writes the URLs with `?v=<first 16 hex digits of the SHA-256>`, so a browser that keeps favicons longer than `no-cache` asks still fetches a new one.

### The shell

- `app/layout.tsx`: `generateMetadata` sets `title` to the name and `icons.icon` to the favicon URL; the layout passes `shellBranding(brandingView(…))` (`name`, `showName`, `logo`; the favicon URL stays on the server, ADR-0020) to `BrandingProvider` (`components/providers/branding-context.tsx`), inside antd's `App`.
- `components/shell/brand-logo.tsx` draws the image only (plan decision d): `next/image` at the display height with the width scaled from the stored size (`image.md:105-113`). The built-in image goes through Next's optimizer from its static import, a custom image (a `/api/branding/*` source) is `unoptimized`, since the hub already re-encoded it (`image.md:391-412`; deviation 7).
- `AppHeader` puts the brand in the home link, named by `aria-label` (WCAG technique ARIA8, "Using aria-label for link purpose": "when there are no elements visible on the page that describe the object"), so the link keeps its name when the image stands alone or the name is hidden below md; the image itself is `alt=""` (W3C WAI Images Tutorial, Functional images, Example 2, for an image beside the link text). The name is cut with an ellipsis (`min-width: 0`, CSS Flexbox §4.5; MDN `text-overflow`) and stays visible below md when there is no logo (`.nameOnly`, plan decision i). `AuthCard` gives a lone image the name as its `alt`. The header's GitHub button is gone (spec §2 #8).

### The admin page and the save

- The sidebar becomes two groups, Management (Apps, Users, Groups) and Settings (Branding), in `components/shell/admin-nav.tsx` ([ADR-0028](0028-navigate-the-admin-area-in-a-sidebar-shared-with-the-chat.md), note of 2026-10-11). `/settings` redirects to `/settings/branding` (`app/(admin)/settings/page.tsx`).
- `app/(admin)/settings/branding/page.tsx` checks `requireAdminUser()` and loads `getBrandingSettings(actor, BUILT_IN_LOGO)`; `components/admin/settings/branding-settings.tsx` shows the mode first in an antd `Alert`. `disabled`: a notice and the built-in preview. `env`: a `Descriptions` list of each value beside its variable, the image previews and any file error (Mattermost's banner, adapted). `database`: the form (the name with a code-point counter through antd Input's `count`; the switch, held on while there is no logo; two uploads kept in the browser until Save, antd demo `upload-manually`; the preview; who saved last and when).
- `saveBrandingAction` (`app/(admin)/settings/branding/{actions,schemas}.ts`) is a thin Server Action returning `ActionResult`: `requireAdmin()`; the mode (`settings_not_editable` outside `database`, as n8n answers 403 while an area is managed by the environment); the zod form schema (`name`, `showName`, and per image `keep` | `replace` | `remove`); `saveBranding`, which processes the replaced images before the transaction (MySQL 8.4: "Keep transactions small and short in duration"; Documenso and Cal.com also process the image before their write) and resolves `keep` and the name rule inside `build` against the locked document; then `refresh()` (deviation 6). A refused image is `invalid_image` with each image's code as a field error; the name rule is `invalid_input` with `showName: ['logo_required']`. `ActionErrorCode` gains `settings_not_editable` and `invalid_image`. Two admins saving at once: the last save wins, and the page shows whose.

### Rules fixed now for SMTP and LDAP (built in their PRs)

- **Secrets encrypted at rest:** AES-256-GCM through Node's `crypto`, a fresh random 96-bit IV per value and the 128-bit tag kept, stored in place of the plain value inside the area's document as `{ v: 1, iv, tag, data }` (base64), within NIST SP 800-38D's IV rules (OWASP Cryptographic Storage). Twenty and GitLab use AES-256-GCM; n8n encrypts the secret field inside its JSON document.
- **The key** is `SETTINGS_ENCRYPTION_KEY`: 32 random bytes in base64, parsed by `lib/env.ts`, required once an area with secrets runs in `database` mode, and separate from `NEXTAUTH_SECRET`, so rotating the sign-in secret cannot make stored passwords unreadable (Twenty falls back to its app secret; the hub does not). Rotation re-encrypts with the new key, which OWASP prefers over keeping several keys; the command is a follow-up.
- **Write-only secrets:** the page never receives a stored secret, masked or not; a blank field on save keeps the stored value (Grafana, n8n and Keycloak keep the stored secret when the placeholder comes back); in `env` mode the page shows "set", never the value (Gitea's configuration page hides the mailer password).
- **Test buttons:** "Send test email" (Gitea's admin page has one) and "Test connection".
- **LDAP's schedule:** a save in `database` mode reaches the sync schedule in every container through a revision check (Gitea checks a revision row at most once a second; Grafana reloads every `reload_interval`), designed in the LDAP PR.
- **Today's variables:** `SMTP_MODE` and `LDAP_MODE` replace `SMTP_ENABLED` and "LDAP is on when `LDAP_URL` is set"; whether the old forms keep working is decided in those PRs.

### The recorded deviation from OWASP: the key stays in the environment

OWASP's Cryptographic Storage Cheat Sheet says "Avoid storing keys in environment variables, as these can be accidentally exposed through functions such as phpinfo() or through the /proc/self/environ file" and "Where possible, encryption keys should be stored in a separate location from encrypted data. For example, if the data is stored in a database, the keys should be stored in the filesystem." Docker Compose documents secrets as files: "Secrets are mounted as a file in `/run/secrets/<secret_name>` inside the container", and n8n reads its key from `N8N_ENCRYPTION_KEY_FILE` that way.

The owner keeps `SETTINGS_ENCRYPTION_KEY` in the environment (2026-10-11: "keep encryption key in env"), beside the deployment's other secrets (`NEXTAUTH_SECRET`, `DATABASE_URL`, `LDAP_BIND_PASSWORD`). The key still lives apart from the database it protects. Nothing in this PR encrypts: the deviation binds the SMTP and LDAP PRs. If it is revisited, a `_FILE` variable read from `/run/secrets/` is the documented route.

### Deviations from the spec text

1. **SVG input is refused** (Task 3 ruling, second round), where spec §4.4 step 3 accepts SVG and step 4 rasterises it. librsvg, the renderer inside sharp, decodes embedded `data:` rasters itself while it renders, outside `limitInputPixels`, and sharp's `svg.stylesheet` option cannot switch them off, because librsvg 2.62 lets author `!important` rules and `style` attributes win over the user stylesheet (`rsvg/src/css.rs`, `properties.rs`); a 415 KB SVG reached 1.18 GB of memory. With no documented way to hold the spec's own resource limit for SVG, OWASP File Upload's "restricted formats" decides: PNG, JPEG and WebP are accepted, SVG (and every bypass variant the review tried) is `not_allowed`, and `image/svg+xml` left the file picker's list. The output was a PNG of at most 768 × 192 either way, so SVG input only saved an export step. Restoring SVG needs a sanitiser, a new dependency with its own record. The plan's Review Focus 2 (a viewBox-only SVG) fell away with it.
2. **`BRANDING_MODE` is read leniently** (Task 2 ruling M2): blanks around it and its case do not matter, as for the `*_ENABLED` flags (`flag()`) and ADR-0029's `LDAP_ENCRYPTION`, where spec §3.1 says "through the file's `blankAsAbsent` helper". `Database` is accepted where it would be refused; harmless.
3. **The settings key stays in the environment** (spec §2 #13, §6.1; owner): a deviation from OWASP, recorded above, not from the spec; listed here so every deviation is in one place.
4. **The write builds the document under a row lock** (Task 4 ruling I1): spec §3.3 names `writeInstanceSetting(actor, area, data, files)`. A save that read the document outside its transaction could, against a concurrent save, write a document naming a file the other save had replaced or deleted (spec §4.3: "a document never names a file that is not there"). The DAL takes a pure `build(current)` callback under `SELECT … FOR UPDATE` and re-issues the transaction on a deadlock (two first saves can deadlock on the gap lock), three attempts in all, mirroring `lib/data/directory.ts`. Last-write-wins (spec §5.3) is kept; an optimistic version check was not taken because it would need a new error code and UI.
5. **The image routes read the version first and tag the bytes they serve** (Task 5 ruling M2, Task 6): spec §4.5 says "an `etag` from the SHA-256". `readBrandImageVersion(kind)` reads the stored hash only, so a matching `If-None-Match` is a 304 without reading the blob (RFC 9110 §13.1.2: "to enable efficient updates of cached information with a minimum amount of transaction overhead"); a 200 is tagged with the hash of the bytes it carries (its first 32 hex digits, quoted), so a body always matches its ETag even when a save lands between the two reads.
6. **`refresh()` instead of `revalidatePath('/', 'layout')`** (plan decision a; spec §3.5 and §5.4 step 7): every admin action here uses `next/cache`'s `refresh` ("`refresh` allows you to refresh the client router from within a Server Action", `refresh.md`), and the root layout is dynamic (it reads cookies), so the saving admin sees the new brand at once.
7. **The built-in logo stays a static import through Next's optimizer** (Task 7 ruling M5): as spec §4.1 and §4.6 say, where the plan's text drew it `unoptimized` like a custom image; only a `/api/branding/*` source is `unoptimized`. It reaches the shell as `BUILT_IN_LOGO`, `{ src, width, height }` from the static import (ruling N2, ADR-0020's trimmed props).

Also against the spec's wording, by the plan's decisions and the run's rulings: one `invalid_image` failure with the codes `too_large` and `not_allowed`, not three field codes `image_too_large`, `image_type_not_allowed` and `image_unreadable` (plan decisions b and h; spec §5.4 step 4); new keys `admin.menu_item_*` for the sidebar's children, where spec §9 names `admin.menu_branding` (plan decision c); `brand-logo.tsx` draws the image only and the header and the login card place the name, where spec §4.6 names `brand-mark.tsx` (plan decision d); the page's unsaved preview uses antd `Image` (plan decision e); the Name field counts code points through antd Input's `count`, where spec §5.3 says `showCount` and `maxLength` (ruling N4: native `maxLength` counts UTF-16 units); and a file row missing for a document that names it (spec §7) leaves the shell with a broken image while the route answers 404, because the shell reads the document only (Task 5 ruling ⚠️1: the one-transaction write under a row lock makes it impossible short of a manual database edit, and the next save repairs it).

### Not decided here

- Whether `SMTP_ENABLED` and the `LDAP_URL` switch keep working beside `SMTP_MODE` and `LDAP_MODE`, and the design of the LDAP revision check: their PRs (spec §6.4, §6.5).
- A per-language brand name, an apple-touch icon and other icon sizes, and persisting the sidebar's collapsed state and open groups across reloads (spec §11; ADR-0028's open look calls).
- Encrypting the Dify API keys (`dify_apps`) with the settings key, and the key-rotation command (spec §11).

### Consequences

- Good, because the deployment decides per area which source wins, and the page says which (Mattermost's banner).
- Good, because a saved brand reaches every container on its next request: the files are in the database, and there is no cache to invalidate.
- Good, because the hub never serves an uploaded or mounted byte: every image is a PNG it produced, without metadata, upright, and inert when opened on its own (nosniff, the sandboxing CSP).
- Good, because SMTP and LDAP move onto rules already fixed: encrypted, write-only secrets and an area locked by its mode.
- Bad, because an SVG logo must be exported to PNG first (deviation 1).
- Bad, because the settings key in the environment is visible wherever the process environment is (`/proc/self/environ`, `docker inspect`, a crash dump), OWASP's reason against it; accepted by the owner.
- Bad, because a database that does not answer delays every page, the login page included, up to mysql2's default 10 s `connectTimeout` (`db/index.ts`, pre-existing) before the built-in brand renders (Task 5 ruling ⚠️2); a follow-up.
- Bad, because a manual database edit that removes a file row leaves a broken image in the shell until the next save.
- Bad, because a Next upgrade that moves its sharp range needs the exact pin moved with it, or the tree holds two copies.
- Bad, because a mode change or a changed `env` value takes a restart, and an `env` mode file error is logged once per process, so after the first page load it is seen on the Branding page rather than in a fresh log.
- Neutral, because the header's link to upstream's GitHub repository is gone.
- Neutral, because `env` and `disabled` mode are proven by unit tests only: the e2e server runs one mode (`BRANDING_MODE=database` in `.env.e2e`, ADR-0010: no test switches in product code).

## Implementation Plan

- **Affected paths**: `db/schema/{settings,index}.ts`, `db/migrations/20261011081133_settings-branding/`, `lib/env.ts`, `lib/settings/{modes,branding-rules,built-in-logo,images,branding,image-response}.ts`, `lib/data/settings.ts`, `lib/error-log.ts`, `lib/action-result.ts`, `lib/access.ts`, `app/api/branding/{logo,favicon}/route.ts`, `app/layout.tsx` (and `app/favicon.ico`, deleted), `components/providers/{app-providers,branding-context}.tsx`, `components/shell/{app-header.tsx,app-header.module.css,auth-card.tsx,brand-logo.tsx,admin-nav.tsx,admin-shell.tsx}`, `app/(admin)/settings/page.tsx`, `app/(admin)/settings/branding/{page.tsx,actions.ts,schemas.ts}`, `components/admin/settings/{branding-settings.tsx,branding-errors.ts}`, `locales/{en,zh,ar}/translation.json`, `.env.template`, `.env.e2e`, `e2e/{branding,admin-nav}.spec.ts`, `e2e/fixtures/branding.ts`, `e2e/global-setup.ts` (deletes the `branding` row before a run), the amended `e2e/{shell,smoke,ssr-first-paint,admin-groups,screenshots}.spec.ts`, `docs/settings.md`.
- **Dependencies**: `sharp@0.35.4`, exact (`pnpm add -E`), the version Next 16.3.4 resolves.
- **Patterns to follow**: a new area adds `<AREA>_MODE` to `lib/env.ts` with the lenient read and its block required together in `env` mode; one zod schema in `lib/settings/<area>.ts` for the environment, the stored document and the save; a reader wrapped in React `cache` that switches exhaustively on the mode; writes through `writeInstanceSetting` with a pure, synchronous `build`; reads that carry anything beyond the public document gated in `lib/data/settings.ts`; the page at `app/(admin)/settings/<area>/` with one entry in the Settings group of `ADMIN_NAV`; secrets encrypted in the document and write-only on the page; every image through `processBrandImage`'s checks.
- **Patterns to avoid**: the page changing the mode; a stored value overriding an `env` mode value; serving uploaded or mounted bytes as they came; SVG input without a sanitiser; reading an `env` mode file before `fs.stat` has checked it; a path, a value or a secret in a log line; a write outside `writeInstanceSetting`; image processing inside the transaction; an `async` or impure `build`.
- **Configuration**: `BRANDING_MODE` and the `BRANDING_*` block (`.env.template`, `docs/settings.md`); `SETTINGS_ENCRYPTION_KEY` arrives with the first area that has secrets.
- **Migration steps**: `pnpm db:migrate` (the container's entrypoint runs it); no existing data changes, and with `BRANDING_MODE` unset the hub keeps its built-in look.

### Verification

- [x] `pnpm test` at `18f0b37e`, 2026-10-11: 139 files, 1737 tests passed, among them `__tests__/{env,settings-schema,branding-rules,settings-images,data-settings,settings-branding,branding-routes,brand-logo,admin-nav,branding-actions,branding-errors,branding-pages,access,api-routes}.test.ts`: each mode and the `env` block; the image pipeline (formats, EXIF orientation, the pixel limit, SVG and its bypass variants refused); the DAL's SQL, lock and deadlock re-issue; the reader in each mode with no row, a refused row and a failing database; the routes' headers, 304 and 404; the action's gates, mode refusal and field errors.
- [x] The Playwright specs `e2e/branding.spec.ts` (an admin saves a name and a logo and sees them in the header, on the login page and in the favicon link; `showName` off; a 64-character name cut; a `user` sent away) and `e2e/admin-nav.spec.ts`, with the amended `shell`, `smoke`, `ssr-first-paint` and `admin-groups` specs, on the three projects, run per task (the run's ledger).
- [ ] The full e2e suite from a fresh e2e stack and the Docker gate (sharp loading in the Alpine image; `/api/branding/logo` signed out answering the 404 envelope while no brand is saved): the plan's Task 12.
- [ ] The owner's look at the Branding page and the grouped sidebar.

## Pros and Cons of the Options

### One JSON document per area

- Good, because one zod schema checks the environment, the stored document and the save, so they cannot accept different values.
- Good, because one primary-key read per request serves the shell, and the document carries its files' hash and size, so the shell never reads image bytes.
- Good, because a new area adds a schema, not a migration; Documenso, Grafana, n8n and Mattermost store areas this way, and GitLab moves its newer areas this way.
- Bad, because the database does not check the shape: a manual edit or an older shape is refused at read (the built-in values and one log line).

### A typed table per area

- Good, because the database checks every column.
- Bad, because every field and every area is a migration; GitLab's single row reached about 596 columns, and its newer areas went to per-area `jsonb`.

### Key/value rows

- Good, because one table holds every setting, and one setting can change without the others.
- Bad, because an area is many rows read and written together and typed one by one, with no single document for one schema to check.

### The environment locks the area

- Good, because the deployment always knows which value wins, and the page can say so (n8n, Mattermost, Discourse, Gitea).
- Bad, because a switch takes a restart, and the page cannot take over a value the deployment set.

### The database wins

- Good, because an admin can change anything without a restart.
- Bad, because the deployment's value loses silently once a row exists (Grafana, Twenty), against the first driver.

### The environment seeds once

- Good, because a fresh install starts configured.
- Bad, because after the first start an environment change does nothing unless a switch says otherwise (`ENABLE_PERSISTENT_CONFIG`, `SKIP_ENV_VAR`), so which value wins depends on history.

## More Information

Spec: `docs/superpowers/specs/2026-10-11-settings-and-branding-design.md` (§2, §3 to §7, and the note of 2026-10-11 at the end of §10). Plan: `docs/superpowers/plans/2026-10-11-settings-and-branding.md` (decisions a to i). Research: `docs/superpowers/research/2026-10-11-settings/`. The run's records: the ledger (`progress.md`), the pre-flight report and the per-task briefs, reports and reviews under `.superpowers/sdd/2026-10-11-settings-and-branding/` (git-ignored). Operations: `docs/settings.md`.

Follow-ups: SMTP and LDAP onto the layer (spec §6); a key-rotation command; encrypting the Dify API keys (`dify_apps`, `db/schema/apps.ts`) with the settings key; an apple-touch icon and other icon sizes; a per-language name; the login page's wait on a database that does not answer (mysql2's `connectTimeout`); SVG input with a sanitiser; the zh and ar wording of `admin_settings.*` and the `admin.menu_*` keys.

Sources: Next 16.3.4 bundled docs (`generate-metadata.md`, `serverActions.md`, `refresh.md`, `image.md`, `deploying-to-platforms.md`, `serverExternalPackages.md`, `data-security.md`, `authentication.md`); react.dev `cache`; Drizzle ("Upsert", MySQL `json().$type<T>()`); MySQL 8.4 ("Locking Reads", "How to Minimize and Handle Deadlocks", `INSERT … ON DUPLICATE KEY UPDATE`, "FOREIGN KEY Constraints"); sharp 0.35 (constructor `limitInputPixels`, `failOn`, `autoOrient`; `resize`; output metadata); antd 6.6.5 through `@ant-design/cli` (Layout "Sider" demo, Menu `defaultOpenKeys` and `triggerSubMenuAction`, Upload `upload-manually`, Input `count`, Descriptions, Alert, Image); zod 4 (code points since 4.5; refinements' `when` and `error`); Node `fs.Stats`, `crypto.createHash`; RFC 9110 §8.8.3.2 and §13.1.2; RFC 9111 §5.2.2.4; OWASP File Upload and Cryptographic Storage cheat sheets; Docker Compose "Use secrets"; W3C WAI Images Tutorial (Functional images); WCAG 2.2 technique ARIA8; MDN `text-overflow`; CSS Flexbox Level 1 §4.5. Reference projects at the commits pinned in `reference-projects.md`: Documenso, Grafana, n8n, Mattermost, GitLab, Cal.com, Payload, Twenty, Gitea, Discourse, Open WebUI, Plane, Keycloak. Related: ADR-0002, ADR-0004, ADR-0013, ADR-0014, ADR-0020, ADR-0024, ADR-0025, ADR-0028, ADR-0029.

Note, 2026-10-12 (Part 0, [ADR-0031](0031-move-the-database-to-postgresql-18.md)): the 10 s bound on a database that does not answer is now the pool's `connectionTimeoutMillis: 10_000` in `db/index.ts`. node-postgres has no bound by default ("Pool": "By default this is 0 which means no timeout"), so Part 0 sets mysql2's default explicitly and the login page behaves as this record describes.
