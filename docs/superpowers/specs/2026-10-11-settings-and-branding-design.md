# Instance settings and branding — design

Date: 2026-10-11 · Status: draft for the owner's review · Scope: a settings layer on `fork/overhaul` where each settings area is set by environment variables or on an admin page, chosen per area by an environment variable; branding (name, logo, favicon) is its first area, and SMTP and LDAP move onto it in later PRs · Delivery: one plan and one PR from `fork/overhaul`, branch `feat/settings-branding` · Research: `docs/superpowers/research/2026-10-11-settings/` (start at its README)

## 1. Goal

The owner or an admin can give the hub its own name, logo and browser-tab icon, either fixed by the deployment (environment variables and mounted image files) or edited on an admin page and stored in the database. Which of the two applies, or neither, is decided per settings area by one environment variable, so the deployment always knows which value wins and the admin page never overrides what the deployment fixed. The same layer later carries the SMTP and LDAP settings, which today live only in environment variables (`lib/env.ts`). The admin navigation is regrouped into two sidebar groups, Management and Settings.

## 2. Decisions taken in the brainstorm (do not re-open)

Owner's answers of 2026-10-11, in the order they were taken.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Foundation first | Settings are set in one of two ways, by environment variables as today or on an admin page; the settings layer is designed before branding is built on it. |
| 2 | Modes | One variable per area, `<AREA>_MODE`: `disabled` (the feature is off; for branding, the built-in look), `env` (values from environment variables, shown read-only on the page) or `database` (values edited on the page and stored in the database; the area's environment values are ignored). Unset counts as `disabled`. The page never changes the mode. The value is `database`, not `gui`: it names where the values live. |
| 3 | Order | Branding is the first area, built with the layer; SMTP and then LDAP move onto it in their own PRs. The rules they need (encrypted secrets, write-only fields, live reload) are fixed in this spec (§6). |
| 4 | Who edits | The owner and admins, through the existing admin gates (ADR-0024). |
| 5 | Branding modes | Branding offers all three modes. |
| 6 | Logo shape | Either a mark beside the name or a wordmark: a `showName` setting decides whether the name is shown beside the logo. |
| 7 | Favicon | Its own optional image; without one the logo is used, and without a logo the built-in icon. |
| 8 | GitHub button | Removed from the header (it links to upstream's repository). |
| 9 | Storage | One JSON document per area (reference projects: Documenso `SiteSettings`, Grafana `sso_setting`, n8n `features.ldap`, Mattermost `Configurations`; `reference-projects.md`). Tables `instance_settings` and `instance_setting_files` ("app" means a Dify app in this codebase, so not `app_settings`). |
| 10 | Missing logo | A custom name without a logo shows the name only, not the Dify App Hub logo. |
| 11 | Image sizes | Logo up to 512 KB, favicon up to 256 KB, so one save fits Next's default Server Action body limit of 1 MB (`serverActions.md:29-45`) and the limit stays as it is. |
| 12 | Navigation | No tabs. The admin sidebar has two groups as in antd's Layout "Sider" demo: **Management** (Apps, Users, Groups) and **Settings** (Branding; later Email, Directory). Children carry no icons; the groups do. In the collapsed sidebar a group's pop-out opens on click. Existing page URLs stay; settings pages live at `/settings/<area>`. |
| 13 | Secrets (SMTP, LDAP) | Encrypted inside the JSON document with AES-256-GCM; write-only on the page. The key is an environment variable, `SETTINGS_ENCRYPTION_KEY` (owner, 2026-10-11: "keep encryption key in env"; a recorded deviation from OWASP, §6.1). |

## 3. The settings layer

### 3.1 Mode variables

`lib/env.ts` parses one mode per area with zod (ADR-0025), next to today's blocks:

- `BRANDING_MODE`: `disabled` | `env` | `database`, read through the file's `blankAsAbsent` helper with the default `disabled`. Any other value fails the environment parse, which names the variable, as today.
- Each area's `env` block is required together only when its mode is `env` (the all-or-nothing rule of the SMTP and LDAP blocks, charter §4.5, B3 spec §7.1). In the other modes the block's variables are ignored; `docs/settings.md` says so.
- `SMTP_MODE` and `LDAP_MODE` replace `SMTP_ENABLED` and "LDAP is on when `LDAP_URL` is set" in their PRs (§6.5).

### 3.2 Data model

Drizzle schema in `db/schema/settings.ts`, one generated migration (`drizzle-kit generate`), applied by the container entrypoint as today. MySQL 8.4 types that have a PostgreSQL counterpart (`json` → `jsonb`, `mediumblob` → `bytea`), so the planned move stays a type mapping (ADR-0004 note).

| Table | Columns and keys |
| --- | --- |
| `instance_settings` | `area` `varchar(32)` primary key (`branding`; later `smtp`, `ldap`); `data` `json` not null, typed with Drizzle's `json().$type<…>()` (Drizzle guide "Set empty array default in MySQL with json column"); `updated_at` `datetime(3)` not null; `updated_by` `varchar(36)` null, the saving account's `users.id` with no foreign key, so deleting that account keeps the record (as `users.admin_deactivated_by`, B3 spec §3.1). |
| `instance_setting_files` | `area` → `instance_settings.area` `ON DELETE CASCADE`; `name` `varchar(32)` (`logo`, `favicon`); primary key `(area, name)`; `bytes` `mediumblob` not null (`{ mode: 'buffer' }`, as `dify_apps.icon_image`, `db/schema/apps.ts:48`); `mime` `varchar(64)` not null; `updated_at` `datetime(3)` not null. |

A row is written only in `database` mode. In `env` and `disabled` mode a stored row is ignored and kept, so switching back to `database` restores the earlier values. The JSON document describes its files (size, hash), so the shell reads one small row per request and never the bytes (§3.5).

### 3.3 Area modules

Each area has one server-only module (`import 'server-only'`) under `lib/settings/`:

- **One zod schema** for the area's values, used by the `env` parse, the stored row and the save action, so the environment and the form cannot accept different values.
- **One reader** (`getBranding()` for branding), wrapped in React `cache` so a request reads once across `generateMetadata`, the root layout and the pages (`generate-metadata.md:195`). It returns the effective values for the current mode:
  - `disabled`: the built-in values.
  - `env`: the parsed environment values and the processed image files (§4.4).
  - `database`: the stored row, parsed by the schema. No row yet means the built-in values (the normal first state). A row the schema refuses (a manual edit, an older shape) also means the built-in values, and one line goes to the log through `lib/error-log.ts`.
- **The admin view** (`getBrandingSettings(actor)`) for the settings page: the mode, the values, per-variable load errors in `env` mode, and the last change (time and the saving account's email).

The data access lives in `lib/data/settings.ts` (server-only, ADR-0024's DAL): `readInstanceSetting(area)`, `readInstanceSettingFile(area, name)` and `writeInstanceSetting(actor, area, data, files)`. Writes take the verified actor and call `assertAdmin(actor)`. The branding read takes no actor: the brand is public by design, since the login page shows it.

### 3.4 Access

- `/settings/*` lives in the `(admin)` route group: the layout's `requireAdminUser()` (ADR-0018) and the page's own `requireAdminUser()` (ADR-0024's gates in the layout and the page).
- The save action calls `requireAdmin()`, the DAL write `assertAdmin(actor)`.
- The two image routes are public (§4.5); `/api/branding` joins `PUBLIC_PREFIXES` in `lib/access.ts`.

### 3.5 Freshness

The reader runs once per request and is one primary-key read of a small row. A save is visible on the next request in every hub container, with no cache to invalidate, as Documenso and Open WebUI read (`reference-projects.md`). On the saving admin's own page, the action's `revalidatePath('/', 'layout')` re-renders at once ("Updates the UI immediately", `revalidatePath.md:19`). LDAP's scheduler needs more than a per-request read (§6.4).

## 4. Branding

### 4.1 Values

| Value | Rule | Used for |
| --- | --- | --- |
| `name` | Required, trimmed, 1–64 characters. One name for every language (it is a proper name). | The header text, the login-card title, the browser-tab title, the header home link's accessible name. |
| `showName` | Boolean, default `true`. Cannot be `false` without a logo. | Whether the name shows beside the logo (header) and under it (login card). The tab title and the link's name always use it. |
| `logo` | Optional image (§4.4). | The header (28 px high) and the login card (64 px high). |
| `favicon` | Optional image (§4.4). | The browser-tab icon. Falls back to the logo, then to the built-in icon. |

The built-in values: name "Dify App Hub", `showName` true, the logo and favicon `assets/images/logo.png` (today's image; the deleted `app/favicon.ico` is the same file). The built-in image stays a static import, so `next/image` keeps its known size and its hashed `/_next/static/…` URL (`image.md:105-113`), which the proxy already passes (`proxy.ts:43-45`).

### 4.2 `env` mode

| Variable | Rule |
| --- | --- |
| `BRANDING_NAME` | Required in `env` mode; the `name` rule. |
| `BRANDING_SHOW_NAME` | `true` / `false`, default `true` (the file's `flag` helper). |
| `BRANDING_LOGO_FILE` | Optional path inside the container to an image file, mounted read-only (`docs/settings.md` shows the Compose volume). |
| `BRANDING_FAVICON_FILE` | Optional path, the same way. |

`BRANDING_SHOW_NAME=false` without `BRANDING_LOGO_FILE` fails the environment parse. The files are read and processed (§4.4) on first use and kept in the process; a changed file takes a restart, as any environment change does. A file that cannot be read or is refused by §4.4 is logged once through `lib/error-log.ts`, naming the variable and the error code, never the path, and the hub keeps running without that image (name only, or the next favicon fallback), as `LDAP_CA_FILE` is handled (`lib/directory/connection.ts:18-27`, `lib/directory/schedule.ts:45`). The settings page shows the error beside the variable. Whenever the logo is unavailable at render time (here, or a missing file row in `database` mode, §7), the name is shown even with `showName` off, so the header and the login card are never empty.

### 4.3 `database` mode

The JSON document in `instance_settings` (area `branding`):

```ts
{
	name: string
	showName: boolean
	logo: StoredImage | null
	favicon: StoredImage | null
}
// StoredImage = { sha256: string; width: number; height: number }  (the processed PNG's hash and size)
```

The processed images are rows `branding/logo` and `branding/favicon` in `instance_setting_files`. The document and its files are written in one transaction, so a document never names a file that is not there.

### 4.4 Image checks and processing

Following the OWASP File Upload Cheat Sheet: an allowlist, a size limit, the browser's type not trusted, and images decoded and re-encoded by an up-to-date library with restricted formats and resource limits, metadata removed (`docs-and-standards.md`). The library is **sharp**, which Next already installs for its image optimizer (`deploying-to-platforms.md:20`) and lists as a server external package (`serverExternalPackages.md:89`); it becomes a direct dependency pinned to the version Next resolves (`0.35.4` today), so the tree keeps one copy (the reasoning of ADR-0013).

1. **Size before decoding:** logo ≤ 512 KB, favicon ≤ 256 KB (decision 11). Larger input is refused unread.
2. **Browser check (convenience only):** antd `Upload`'s `beforeUpload` refuses other types and sizes with a message (antd demo `upload-png-only`); the server repeats every check.
3. **Decode:** `sharp(input, { limitInputPixels })` with sharp's default `failOn` (input refused on any decoder warning) and a pixel limit of 4096 × 4096 (tighter than sharp's default `0x3FFF²`, a resource limit in OWASP's sense). The format comes from the decoder (`metadata().format`), never from the browser: PNG, JPEG, WebP or SVG are accepted for both images. ICO is not (sharp does not read it); a PNG icon is what Next's own `icons` example uses (`generate-metadata.md:585-593`).
4. **Re-encode to PNG**, metadata removed (sharp's default: "By default all metadata will be removed"):
   - logo: `resize({ width: 768, height: 192, fit: 'inside' })` (192 px is three times the largest display height, 64 px, for high-density screens; 768 px allows a 4:1 wordmark); raster input is not enlarged (`withoutEnlargement`); SVG input is rasterised at a density that reaches the target height.
   - favicon: `resize(64, 64, { fit: 'contain', background: transparent })`, a square PNG (twice the 32 px tab size).
5. **Store** the PNG bytes, their SHA-256 and the output width and height.

Nothing the hub serves is SVG or the uploaded bytes themselves; every image leaves as a PNG it produced.

### 4.5 Serving the images

Two public Route Handlers, `app/api/branding/logo/route.ts` and `app/api/branding/favicon/route.ts` (GET):

- They serve the current mode's processed image: the stored file in `database` mode, the processed file in `env` mode. The favicon route falls back to the logo. With no custom image they answer `404` with the envelope (`difyErrorResponse`, as the icon route does); the shell links to the built-in static image in that case, so the route is not asked.
- Headers as the app-icon route (`app/api/apps/[appId]/icon/route.ts`): `content-type: image/png`, an `etag` from the SHA-256, `304` on a matching `If-None-Match`, `x-content-type-options: nosniff`, and the sandboxing `content-security-policy`; the cache policy is `public, no-cache` (the brand is public; revalidated on every use, RFC 9111 §5.2.2.4).
- The URLs the shell writes carry `?v=<first 16 hex digits of the SHA-256>`, so a browser that holds favicons longer than `no-cache` asks still fetches a new one. The routes ignore the parameter.
- `/api/branding` is added to `PUBLIC_PREFIXES` (`lib/access.ts`) and to the pinned route list (`__tests__/api-routes.test.ts`).

### 4.6 Where the brand shows

- `app/layout.tsx` calls `getBranding()` and passes a trimmed `BrandingView` (`name`, `showName`, `logo: { src, width, height } | null`) through `AppProviders` into a small client context (`components/providers/branding-context.tsx`), the way the session and the theme already travel (ADR-0020's trimmed props).
- `components/shell/brand-mark.tsx` draws the logo and, per `showName`, the name. The built-in image renders through `next/image` from its static import (as today); a custom image renders through `next/image` with `unoptimized` (it is already processed, `image.md:391-412`) and its stored width and height scaled to the display height (`image.md:105-113`).
- `AppHeader` uses it inside the home link, whose accessible name is the brand name (`aria-label`); `AuthCard` uses it above the form; the settings page uses it for the preview. When the name is shown beside the image, the image is `alt=""` (W3C WAI Images Tutorial, Functional images, Example 2 "Logo image within link text": "a null (empty) value is applied … to avoid redundancy"); when it is not, the header link keeps its accessible name through `aria-label` (Example 1, "Image used alone as a linked logo", names where the link goes) and the login card's image carries the name as its `alt`.
- `generateMetadata` in `app/layout.tsx` sets `title` to the name and `icons.icon` to the favicon URL (the route with `?v=`, or the built-in image's static URL). `app/favicon.ico` is deleted, because a file-based icon overrides the metadata (`generate-metadata.md:114`). The proxy matcher's `favicon.ico` exclusion and the `/favicon.ico` public prefix stay, so a stray request for the old path gets a 404 instead of a redirect to the login page.
- The header's GitHub button and `GITHUB_URL` are removed (decision 8).

## 5. Admin navigation and the settings pages

### 5.1 The sidebar

`components/shell/admin-shell.tsx`'s flat list becomes two groups, following antd's Layout "Sider" demo (an inline `Menu` whose items carry `children`; `antd demo Layout side`):

```
▾ Management   (AppstoreOutlined)
    Apps       /app-management
    Users      /user-management
    Groups     /group-management
▾ Settings     (SettingOutlined)
    Branding   /settings/branding
```

- Groups are not pages; clicking one opens or closes it. Children are `Link`s without icons.
- Both groups start open (`defaultOpenKeys`); the selected key is the child whose path starts the current pathname.
- `triggerSubMenuAction="click"`: in the collapsed sidebar a group opens its pop-out on click, not hover (antd `Menu` prop, default `hover`), for ADR-0014's reasons (touch, accidental opening).
- The header's drawer below md shows the same tree with the same open groups (`AppHeader`'s `nav` prop).
- This regroups ADR-0028's sidebar: a dated note on ADR-0028.

### 5.2 Addresses

Apps, Users and Groups keep `/app-management`, `/user-management` and `/group-management` (bookmarks and the e2e suite rely on them). Settings pages are `/settings/<area>`: `/settings/branding` now. `/settings` redirects to `/settings/branding` (Next's `redirect`), so a typed address lands somewhere.

### 5.3 The Branding page

`app/(admin)/settings/branding/page.tsx` (server: gate, load `getBrandingSettings(actor)`, trim) and `components/admin/settings/branding-settings.tsx` (client), with `loading.tsx`/`error.tsx` per the admin area's pattern. The shared page header reads "Branding" with a subtitle. An antd `Alert` states the mode first:

| Mode | The page shows |
| --- | --- |
| `disabled` | "Branding is off. The hub uses its built-in name and logo. Set `BRANDING_MODE` to `env` or `database` to change it." and a preview of the built-in look. No form. |
| `env` | "Branding is set by environment variables and can't be changed here." (Mattermost's banner, adapted: "This setting has been set through an environment variable. It cannot be changed through the System Console.", `reference-projects.md`). An antd `Descriptions` list of each value with its variable name, the image previews, and any load error beside its variable (§4.2). |
| `database` | The form. |

The form (antd `Form`):

- **Name:** `Input` with `showCount` and `maxLength` 64.
- **Show the name beside the logo:** `Switch`, disabled and on while there is no logo.
- **Logo** and **Favicon:** each an `Upload` that keeps the file in the browser until Save (antd demo `upload-manually`), with a preview, Replace and Remove. The browser checks type and size for a quick message (§4.4 step 2).
- **Preview:** a strip drawn with `brand-mark.tsx`, showing unsaved images through `URL.createObjectURL`.
- **Last change:** "Last changed by _email_ on _date_". Two admins saving at once: the last save wins, and the line shows whose.
- **Save** runs the action; success shows `App.useApp().message`; the header changes on the same page (§3.5).

### 5.4 The save action

`app/(admin)/settings/branding/{actions,schemas}.ts`, returning `ActionResult` (ADR-0023) from a `FormData` (Server Actions accept `FormData` with files):

1. `requireAdmin()`.
2. The mode must be `database`, else the failure `settings_not_editable` (n8n refuses a save with 403 while an area is managed by the environment, `reference-projects.md`).
3. zod (ADR-0025) parses `name`, `showName`, and per image an intent `keep` | `replace` | `remove` with the file for `replace`.
4. Images through §4.4; a refused image is a field error (`image_too_large`, `image_type_not_allowed`, `image_unreadable`).
5. `showName` false without a logo (after the intents) is a field error.
6. One transaction: upsert the `instance_settings` row with `updated_at` and `updated_by`; upsert or delete the file rows.
7. `revalidatePath('/', 'layout')`; success.

Failures reuse `lib/action-failure.ts` (a database error is the general error, logged without secrets).

## 6. Rules fixed now for SMTP and LDAP (built in their PRs)

### 6.1 Secrets encrypted at rest

- AES-256-GCM through Node's `crypto`, a fresh random 96-bit IV per value, the 128-bit tag kept. OWASP: authenticated modes, "GCM and CCM … as a first preference", within NIST SP 800-38D's IV rules (`docs-and-standards.md`). Twenty and GitLab use AES-256-GCM; n8n encrypts the secret field inside its JSON document the same way (`reference-projects.md`).
- Stored in place of the plain value inside the area's JSON document: `{ v: 1, iv, tag, data }` (base64).
- The key is `SETTINGS_ENCRYPTION_KEY`, 32 random bytes in base64, parsed by `lib/env.ts`, required once an area with secrets runs in `database` mode, and separate from `NEXTAUTH_SECRET` (rotating the sign-in secret must not make stored passwords unreadable; Twenty falls back to its app secret, the hub does not).
- **Recorded deviation (decision 13):** OWASP's Cryptographic Storage Cheat Sheet says "Avoid storing keys in environment variables" and to keep keys "in a separate location from encrypted data … in the filesystem"; Docker documents secrets as files under `/run/secrets/`. The owner keeps the key in the environment, with the deployment's other secrets (`NEXTAUTH_SECRET`, `DATABASE_URL`, `LDAP_BIND_PASSWORD`) — the key still lives apart from the database it protects. ADR-0030 states the deviation.
- Rotation: OWASP prefers re-encrypting with the new key over keeping several keys; a re-encrypt command is a follow-up.

### 6.2 Write-only secrets

The page never receives a stored secret, masked or not. A secret field shows "Saved. Leave blank to keep it."; a blank field on save keeps the stored value (Grafana, n8n and Keycloak keep the stored secret when the placeholder comes back, `reference-projects.md`). In `env` mode the read-only view shows "set" for a secret variable, never its value (Gitea's config page hides the mailer password).

### 6.3 Test buttons

Email: "Send test email" (Gitea's admin page has one). Directory: "Test connection".

### 6.4 Changes reaching the LDAP scheduler

In `database` mode a save must reach the sync schedule in every container: a revision check (Gitea checks a revision row at most once per second; Grafana reloads every `reload_interval`), designed in the LDAP PR.

### 6.5 Today's variables

`SMTP_ENABLED` and LDAP's "on when `LDAP_URL` is set" become `SMTP_MODE` and `LDAP_MODE`; whether the old forms keep working is decided in those PRs.

## 7. Errors

| Case | Behaviour |
| --- | --- |
| `BRANDING_MODE` not one of the three values; `env` mode without `BRANDING_NAME`; `BRANDING_SHOW_NAME=false` without a logo file | The environment parse fails at startup and names the variable (today's `lib/env.ts` behaviour). |
| `env` mode image file unreadable or refused | Logged once (variable and code, no path); the hub runs without that image; the page shows the error (§4.2). |
| `database` mode, no row | Built-in values; not an error. |
| `database` mode, row refused by the schema | Built-in values; one log line. |
| A file row missing for a document that names it | The route answers 404; the shell falls back as for no image; one log line. |
| Save by a `user` account | `forbidden` (`requireAdmin`). |
| Save outside `database` mode | `settings_not_editable`. |
| Refused field or image | Field errors, translated (§5.4). |
| Database failure on save | The general error; nothing written (one transaction). |

## 8. Testing

- **Unit (Vitest, node):** the mode and `env` block parse in `lib/env.ts` (each mode, blanks, the `showName` rule); the branding schema; `getBranding()` in each mode, including no row and a refused row; the image pipeline with fixture files (PNG, JPEG, WebP, SVG accepted and re-encoded to PNG with stored size; ICO, a renamed text file, a truncated PNG, an oversized file and a file over the pixel limit refused); the image routes (headers, ETag and 304, 404 envelope, public access); the save action (gates, mode refusal, field errors, `remove` intents, one transaction); `lib/access.ts`'s new public prefix; the pinned API route list.
- **e2e (Playwright, ADR-0010):** `.env.e2e` sets `BRANDING_MODE=database`; the e2e server runs one mode, so `env` and `disabled` are covered by unit tests. Specs: the sidebar tree on desktop and phone, and the collapsed pop-out opening on click; an admin saves a name and a logo and sees them in the header, on the login page and in the favicon link; `showName` off shows the image only; a `user` account is sent away from `/settings/branding`. The brand is global state and the suite runs serially (`workers: 1`), so the branding spec restores the built-in state after each test (`e2e/auth.spec.ts:45` expects the "Dify App Hub" heading).
- **Before merge:** the gates in `CLAUDE.md` (typegen, tsc, oxlint, oxfmt, `pnpm test`), the e2e suite, and the Docker rebuild (sharp's native build must load in the Alpine image).

## 9. Documentation and records

- ADR-0030, "Set each settings area from the environment or the admin page, chosen by an environment mode": the modes, the JSON document per area, the image processing with sharp as a direct dependency, the secret rules and the key deviation.
- A dated note on ADR-0028 for the grouped sidebar.
- `docs/settings.md` for operators: the modes, the branding variables, mounting image files in Compose, what the page shows per mode.
- `.env.template`: a `BRANDING_*` block.
- `docs/decisions/README.md` index; `CLAUDE.md` pointers (decision line, "Where things are", next step).
- i18n: `admin.menu_management`, `admin.menu_settings`, `admin.menu_branding` and `admin_settings.*` in en, zh and ar (ADR-0005); the zh and ar wording joins the owner's review list.

## 10. Changes from the brainstorm's chat wording

Taken while writing this spec from the docs, the standards and the codebase; for the owner's review.

1. `updated_by` has no foreign key (chat: `ON DELETE SET NULL`), following B3a's `admin_deactivated_by`, so the record survives the account's deletion.
2. An unreadable `env` mode image file is logged and shown on the page, and the hub keeps running (chat: "stops the app"). That is how `LDAP_CA_FILE` actually behaves.
3. Uploaded images are decoded and re-encoded to PNG with sharp (OWASP File Upload); SVG, JPEG and WebP are accepted as input but never served, and ICO is not accepted (chat: PNG, JPEG, WebP, SVG and ICO served as uploaded, type checked from the bytes). This also gives `next/image` the width and height it requires.
4. The built-in logo and favicon stay a static import; the image routes serve only custom images (chat: the routes serve the built-in images in `disabled` mode).
5. `/settings` redirects to `/settings/branding`.

## 11. Out of scope and follow-ups

- SMTP and LDAP on the layer (their own PRs, §6); the Mailpit e2e branch pairs with SMTP's.
- A key-rotation command (§6.1); encrypting the Dify API keys (`db/schema/apps.ts:36`) with the same key.
- An apple-touch icon and other icon sizes; a per-language name.
- Persisting the sidebar's collapsed state and its open groups across reloads (ADR-0028's open look calls).

## 12. Sources

`docs/superpowers/research/2026-10-11-settings/`: `reference-projects.md` (13 projects, pinned commits) and `docs-and-standards.md` (Next.js 16 bundled docs, Drizzle, antd 6, sharp, OWASP File Upload and Cryptographic Storage cheat sheets, Docker Compose secrets).
