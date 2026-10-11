# Instance Settings and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A settings layer where each area is set by environment variables or on an admin page (chosen per area by `<AREA>_MODE`), with branding (name, logo, favicon) as its first area and the admin sidebar regrouped into Management and Settings.

**Architecture:** `BRANDING_MODE` (`disabled` | `env` | `database`) is parsed in `lib/env.ts`. In `database` mode the brand is one JSON document in `instance_settings` plus processed PNGs in `instance_setting_files`; in `env` mode it comes from `BRANDING_*` variables and mounted files. Every image is decoded and re-encoded to PNG by sharp before it is stored or served. A server-only reader (`lib/settings/branding.ts`) resolves the brand once per request; the root layout passes a trimmed view to the shell through a context, sets the tab title and favicon in `generateMetadata`, and two public Route Handlers serve the custom images. The Branding page (`/settings/branding`) shows the mode first and, in `database` mode, a form saved by a thin Server Action.

**Tech Stack:** Next.js 16 (App Router, Server Actions, Route Handlers, `generateMetadata`), Drizzle ORM 1.0.0-rc.3 on MySQL 8.4, zod 4, sharp 0.35.4 (new direct dependency), antd 6 (Layout, Menu, Form, Upload, Alert, Descriptions, Image), react-i18next, Vitest 4 (node environment), Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-11-settings-and-branding-design.md` (owner-approved 2026-10-11). Research: `docs/superpowers/research/2026-10-11-settings/` (`reference-projects.md`, `docs-and-standards.md`).

## Global Constraints

- Branch `feat/settings-branding` (from `fork/overhaul` `0f6dd29e`); commits are conventional, English, and end with the session's `Co-Authored-By` and `Claude-Session` trailers (CLAUDE.md). Nothing is pushed until the owner says so.
- ADR-0002: documented approaches only; every non-obvious choice carries its source in a comment, as the surrounding code does.
- Modes: `BRANDING_MODE` is `disabled` | `env` | `database`; unset or blank means `disabled`; any other value fails the environment parse naming `BRANDING_MODE`. The page never changes the mode.
- Editors: the owner and admins (`requireAdminUser()` in the layout and page, `requireAdmin()` in the action, `assertAdmin(actor)` in the writes).
- Tables: `instance_settings` (`area` varchar(32) PK, `data` json not null, `updated_at` datetime(3), `updated_by` varchar(36) null, no foreign key) and `instance_setting_files` (`area` → `instance_settings.area` ON DELETE CASCADE, `name` varchar(32), PK `(area, name)`, `bytes` mediumblob, `mime` varchar(64), `updated_at` datetime(3)).
- Name: trimmed, 1–64 characters (zod counts code points); one name for every language; built-in name `Dify App Hub`.
- Images: input logo ≤ 512 KB, favicon ≤ 256 KB; accepted decoded formats PNG, JPEG, WebP, SVG (no ICO, no GIF); pixel limit 4096 × 4096; output always PNG: logo fit inside 768 × 192 (raster never enlarged), favicon 64 × 64 `contain` on transparent; metadata removed; EXIF orientation applied first.
- Serving: `GET /api/branding/logo` and `GET /api/branding/favicon` are public; `content-type: image/png`, ETag from the SHA-256, `cache-control: public, no-cache`, `x-content-type-options: nosniff`, CSP `default-src 'none'; style-src 'unsafe-inline'; sandbox`, 304 on a matching `If-None-Match`, 404 envelope `{ code: 'not_found', … }` with no custom image. URLs written by the shell carry `?v=<first 16 hex digits of the SHA-256>`.
- Navigation: sidebar groups `Management` (Apps `/app-management`, Users `/user-management`, Groups `/group-management`) and `Settings` (Branding `/settings/branding`); children without icons; both groups open by default; `triggerSubMenuAction="click"`; `/settings` redirects to `/settings/branding`.
- i18n: every new key in `locales/en`, `locales/zh` and `locales/ar` (`__tests__/i18n-locales.test.ts` checks parity and placeholders).
- No DOM unit tests (Vitest runs in `node`); layout and behaviour in the browser are checked by the e2e suite.
- Gates before each commit (CLAUDE.md): `pnpm exec next typegen && pnpm exec tsc --noEmit`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --check <files>`, `pnpm test`.

## Review Focus

1. **The database does not answer while a page renders in `database` mode** → the brand falls back to the built-in look and one line is logged; the login page still renders. Pinned in Task 5.
2. **An SVG wordmark with only a `viewBox` (no `width`/`height`)** → processed to a PNG of the full box size, not refused and not tiny. Pinned in Task 3.
3. **A phone photo (JPEG with EXIF orientation 6)** → stored upright, with no EXIF left. Pinned in Task 3.
4. **A small file with huge dimensions (a decompression bomb, e.g. a 311 KB PNG of 10 000 × 10 000)** → refused by the pixel limit although it passes the byte limit. Pinned in Task 3.
5. **An `env` mode file variable pointing at a missing file or a directory** → the hub keeps running without that image, the log names the variable and the code (never the path), and the settings page shows the error. Pinned in Task 5.

## Plan decisions (taken while planning, against the spec's wording)

- **a. `refresh()` instead of `revalidatePath('/', 'layout')`** after a save: every admin action here uses `next/cache`'s `refresh` ("refresh the client router from within a Server Action", `refresh.md`), and the root layout is dynamic (it reads cookies), so it re-renders with the new brand.
- **b. Two image error codes, `too_large` and `not_allowed`**, not three: sharp answers "unsupported image format" and "damaged" through the same error path, and telling them apart would mean parsing its messages.
- **c. New keys for the sidebar children** (`admin.menu_item_apps|users|groups|branding`): `admin.menu_apps|users|groups` stay, because the pages use them as their titles ("User management").
- **d. `components/shell/brand-logo.tsx`** draws the image only; the header and the login card place the name themselves (their typography differs).
- **e. The unsaved preview on the Branding page uses antd `Image`**: an image the browser has not decoded has no known size, which `next/image` requires.
- **f. `getBranding()` catches a database read failure** (Review Focus 1); the spec is silent on it.
- **g. sharp's `autoOrient` input option** (Review Focus 3); the spec says "metadata removed", which alone would leave a phone photo on its side.
- **h. `ActionErrorCode` gains `settings_not_editable` and `invalid_image`.**
- **i. With no logo the header's name stays visible below md** (a new `.nameOnly` class): today's `.title` hides the name on phones, which would leave a name-only header empty.

## File Structure

| File | Responsibility |
| --- | --- |
| `db/schema/settings.ts` (new) | The two tables. |
| `db/migrations/<timestamp>_settings-branding/` (generated) | Their migration. |
| `lib/settings/modes.ts` (new) | `SETTINGS_MODES`, `SettingsMode` (client-safe). |
| `lib/settings/branding-rules.ts` (new) | Client-safe branding constants, the name schema, the view types, `effectiveShowName`. |
| `lib/env.ts` | `BRANDING_MODE` and the `env` block → `ServerEnv.branding`. |
| `lib/settings/images.ts` (new) | `processBrandImage` with sharp. |
| `lib/data/settings.ts` (new) | The settings DAL (read the row, read a file, write in one transaction). |
| `lib/error-log.ts` | `logSettingsError`. |
| `lib/settings/branding.ts` (new) | `getBranding`, `brandingView`, `readBrandImage`, `getBrandingSettings`, `saveBranding`, `isBrandingEditable`. |
| `lib/settings/image-response.ts` (new) | The image routes' answer. |
| `app/api/branding/{logo,favicon}/route.ts` (new) | The two public image routes. |
| `lib/access.ts` | `/api/branding` public. |
| `components/providers/branding-context.tsx` (new) | `BrandingProvider`, `useBranding`. |
| `components/shell/brand-logo.tsx` (new) | The brand image through `next/image`. |
| `components/providers/app-providers.tsx`, `app/layout.tsx` | Pass the brand; `generateMetadata`. |
| `components/shell/app-header.tsx` (+ `.module.css`), `components/shell/auth-card.tsx` | Draw the brand; GitHub button removed. |
| `components/shell/admin-nav.tsx` (new), `components/shell/admin-shell.tsx` | The grouped navigation. |
| `app/(admin)/settings/page.tsx`, `app/(admin)/settings/branding/{page.tsx,actions.ts,schemas.ts}` (new) | The pages and the save action. |
| `components/admin/settings/{branding-settings.tsx,branding-errors.ts}` (new) | The Branding page's client component. |
| `lib/action-result.ts` | Two codes. |
| `locales/{en,zh,ar}/translation.json` | Keys. |
| `e2e/fixtures/branding.ts`, `e2e/branding.spec.ts`, `e2e/admin-nav.spec.ts` (new); `e2e/admin-groups.spec.ts`, `e2e/smoke.spec.ts`, `.env.e2e` | e2e. |
| `docs/decisions/0030-…md`, `docs/decisions/0028-…md`, `docs/decisions/README.md`, `docs/settings.md`, `.env.template`, `CLAUDE.md` | Records. |

---

### Task 1: The settings tables and their migration

**Files:**

- Create: `db/schema/settings.ts`
- Modify: `db/schema/index.ts`
- Generate: `db/migrations/<timestamp>_settings-branding/{migration.sql,snapshot.json}`
- Test: `__tests__/settings-schema.test.ts`

**Interfaces:**

- Produces: `instanceSettings` (columns `area`, `data`, `updatedAt`, `updatedBy`) and `instanceSettingFiles` (columns `area`, `name`, `bytes`, `mime`, `updatedAt`), exported from `@/db/schema`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/settings-schema.test.ts
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { getTableConfig } from 'drizzle-orm/mysql-core'
import { describe, expect, it } from 'vitest'

import { instanceSettingFiles, instanceSettings } from '@/db/schema'

describe('the settings schema (settings spec §3.2)', () => {
	it('keys instance_settings by area, stores a JSON document, and keeps who saved it without a foreign key', () => {
		const config = getTableConfig(instanceSettings)
		expect(config.name).toBe('instance_settings')
		expect(instanceSettings.area.primary).toBe(true)
		expect(instanceSettings.area.getSQLType()).toBe('varchar(32)')
		expect(instanceSettings.data.getSQLType()).toBe('json')
		expect(instanceSettings.data.notNull).toBe(true)
		expect(instanceSettings.updatedBy.notNull).toBe(false)
		// As users.admin_deactivated_by (B3 spec §3.1): deleting the saving account keeps the record.
		expect(config.foreignKeys).toEqual([])
	})

	it('keys instance_setting_files by area and name and deletes them with their area', () => {
		const config = getTableConfig(instanceSettingFiles)
		expect(config.name).toBe('instance_setting_files')
		const [primary] = config.primaryKeys
		expect(primary.columns.map(column => column.name)).toEqual(['area', 'name'])
		const [foreignKey] = config.foreignKeys
		expect(foreignKey.onDelete).toBe('cascade')
		expect(foreignKey.reference().foreignTable).toBe(instanceSettings)
		expect(instanceSettingFiles.bytes.getSQLType()).toBe('mediumblob')
		expect(instanceSettingFiles.mime.notNull).toBe(true)
	})

	it('ships one generated migration that creates both tables', () => {
		const folder = readdirSync('db/migrations').find(name => name.endsWith('_settings-branding'))
		expect(folder).toBeDefined()
		const sql = readFileSync(path.join('db/migrations', folder!, 'migration.sql'), 'utf8')
		expect(sql).toContain('CREATE TABLE `instance_settings`')
		expect(sql).toContain('CREATE TABLE `instance_setting_files`')
		expect(sql).toMatch(/ON DELETE cascade/i)
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/settings-schema.test.ts` Expected: FAIL (`instanceSettings` is not exported from `@/db/schema`).

- [ ] **Step 3: Add the tables**

```ts
// db/schema/settings.ts
import { sql } from 'drizzle-orm'
import { datetime, json, mediumblob, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core'

/**
 * Instance settings (settings spec §3.2): one JSON document per area (`branding`; later `smtp`, `ldap`), parsed by the
 * area's zod schema on every read and write (Drizzle guide "Set empty array default in MySQL with json column":
 * `json().$type<T>()`). A row is written only while the area's mode is `database`. `updated_by` is the saving account's
 * id with no foreign key, so deleting that account keeps the record (as users.admin_deactivated_by, B3 spec §3.1).
 */
export const instanceSettings = mysqlTable('instance_settings', {
	area: varchar('area', { length: 32 }).primaryKey(),
	data: json('data').$type<unknown>().notNull(),
	updatedAt: datetime('updated_at', { fsp: 3 })
		.default(sql`CURRENT_TIMESTAMP(3)`)
		.notNull()
		.$onUpdate(() => new Date()),
	updatedBy: varchar('updated_by', { length: 36 }),
})

/**
 * An area's files (spec §3.2): branding's processed PNGs, in the database like the app icons (dify_apps.icon_image),
 * so several hub containers need no shared folder. Deleting the area's row deletes them (MySQL 8.4 "FOREIGN KEY
 * Constraints", ON DELETE CASCADE).
 */
export const instanceSettingFiles = mysqlTable(
	'instance_setting_files',
	{
		area: varchar('area', { length: 32 })
			.notNull()
			.references(() => instanceSettings.area, { onDelete: 'cascade' }),
		name: varchar('name', { length: 32 }).notNull(),
		bytes: mediumblob('bytes', { mode: 'buffer' }).notNull(),
		mime: varchar('mime', { length: 64 }).notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [primaryKey({ columns: [table.area, table.name] })],
)
```

Add to `db/schema/index.ts`, keeping the alphabetical order of the file:

```ts
export { instanceSettingFiles, instanceSettings } from './settings'
```

- [ ] **Step 4: Generate the migration**

Run: `env $(grep DATABASE_URL .env.development.local) pnpm db:generate --name settings-branding` Expected: a new folder `db/migrations/<timestamp>_settings-branding/` with `migration.sql` creating both tables and the foreign key. Read the SQL; it must contain nothing else.

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/settings-schema.test.ts` Expected: PASS (3 tests).

- [ ] **Step 6: Apply it to the local development database**

Run: `env $(grep DATABASE_URL .env.development.local) pnpm db:migrate` Expected: the migration applies (the e2e database gets it from `e2e/global-setup.ts`, the container from its entrypoint).

- [ ] **Step 7: Gates and commit**

Run the gates in Global Constraints on the changed files, then:

```bash
git add db/schema/settings.ts db/schema/index.ts db/migrations __tests__/settings-schema.test.ts
git commit -m "feat(settings): add the instance settings tables"
```

---

### Task 2: The branding rules and the environment parse

**Files:**

- Create: `lib/settings/modes.ts`, `lib/settings/branding-rules.ts`
- Modify: `lib/env.ts`, `.env.template`
- Test: `__tests__/env.test.ts` (extend), `__tests__/branding-rules.test.ts` (new)

**Interfaces:**

- Produces (client-safe): `SETTINGS_MODES`, `SettingsMode`; from `branding-rules.ts`: `BUILT_IN_BRAND_NAME = 'Dify App Hub'`, `BRAND_NAME_MAX = 64`, `brandNameSchema`, `BRAND_IMAGE_KINDS = ['logo', 'favicon']`, `BrandImageKind`, `BRAND_IMAGE_MAX_BYTES: Record<BrandImageKind, number>`, `BRAND_IMAGE_MIME_TYPES`, `BRAND_IMAGE_ERROR_CODES = ['too_large', 'not_allowed']`, `BrandImageErrorCode`, `BRAND_LOGO_PATH = '/api/branding/logo'`, `BRAND_FAVICON_PATH = '/api/branding/favicon'`, `interface BrandImageSource { src: string; width: number; height: number }`, `interface BrandingView { name: string; showName: boolean; logo: BrandImageSource | null; faviconSrc: string }`, `effectiveShowName(showName: boolean, hasLogo: boolean): boolean`.
- Produces (server): `ServerEnv.branding: BrandingEnv` with `interface BrandingEnv { mode: SettingsMode; values: BrandingEnvValues | null }` and `interface BrandingEnvValues { name: string; showName: boolean; logoFile: string | null; faviconFile: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/branding-rules.test.ts
import { describe, expect, it } from 'vitest'

import { brandNameSchema, effectiveShowName } from '@/lib/settings/branding-rules'

describe('brandNameSchema (settings spec §4.1)', () => {
	it('trims and accepts 1–64 characters, counted as code points', () => {
		expect(brandNameSchema.parse('  Acme AI Hub  ')).toBe('Acme AI Hub')
		expect(brandNameSchema.safeParse('   ').success).toBe(false)
		expect(brandNameSchema.safeParse('a'.repeat(65)).success).toBe(false)
		// 64 emoji are 128 UTF-16 code units and 64 code points (zod 4 counts code points).
		expect(brandNameSchema.safeParse('🚀'.repeat(64)).success).toBe(true)
	})
})

describe('effectiveShowName (spec §4.2: the header is never empty)', () => {
	it('shows the name when asked, and always when there is no logo', () => {
		expect(effectiveShowName(true, true)).toBe(true)
		expect(effectiveShowName(false, true)).toBe(false)
		expect(effectiveShowName(false, false)).toBe(true)
	})
})
```

Add to `__tests__/env.test.ts`. First update the existing `'parses the minimal environment with no mail'` expectation to include `branding: { mode: 'disabled', values: null }`. Then add:

```ts
describe('BRANDING_MODE (settings spec §3.1)', () => {
	const keysOf = (source: Record<string, string>) => {
		try {
			parseEnv({ ...base, ...source })
		} catch (error) {
			return (error as EnvError).keys
		}
		return []
	}

	it('is disabled when unset or blank, and reads its value leniently', () => {
		expect(parseEnv(base).branding).toEqual({ mode: 'disabled', values: null })
		expect(parseEnv({ ...base, BRANDING_MODE: '  ' }).branding.mode).toBe('disabled')
		expect(parseEnv({ ...base, BRANDING_MODE: ' Database ' }).branding).toEqual({
			mode: 'database',
			values: null,
		})
	})

	it('refuses any other value, naming the variable', () => {
		expect(keysOf({ BRANDING_MODE: 'gui' })).toEqual(['BRANDING_MODE'])
	})

	it('ignores the BRANDING_* block outside env mode', () => {
		expect(
			parseEnv({ ...base, BRANDING_MODE: 'database', BRANDING_SHOW_NAME: 'maybe' }).branding.values,
		).toBeNull()
	})

	it('reads the env block in env mode, with the name trimmed and blank files absent', () => {
		expect(
			parseEnv({
				...base,
				BRANDING_MODE: 'env',
				BRANDING_NAME: ' Acme AI Hub ',
				BRANDING_LOGO_FILE: '/branding/logo.svg',
				BRANDING_FAVICON_FILE: ' ',
			}).branding,
		).toEqual({
			mode: 'env',
			values: {
				name: 'Acme AI Hub',
				showName: true,
				logoFile: '/branding/logo.svg',
				faviconFile: null,
			},
		})
	})

	it('requires BRANDING_NAME in env mode', () => {
		expect(keysOf({ BRANDING_MODE: 'env' })).toEqual(['BRANDING_NAME'])
		expect(keysOf({ BRANDING_MODE: 'env', BRANDING_NAME: 'x'.repeat(65) })).toEqual([
			'BRANDING_NAME',
		])
	})

	it('refuses BRANDING_SHOW_NAME=false without a logo file, and takes it with one', () => {
		expect(
			keysOf({ BRANDING_MODE: 'env', BRANDING_NAME: 'Acme', BRANDING_SHOW_NAME: 'false' }),
		).toEqual(['BRANDING_SHOW_NAME'])
		expect(
			parseEnv({
				...base,
				BRANDING_MODE: 'env',
				BRANDING_NAME: 'Acme',
				BRANDING_SHOW_NAME: 'false',
				BRANDING_LOGO_FILE: '/branding/logo.png',
			}).branding.values?.showName,
		).toBe(false)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/env.test.ts __tests__/branding-rules.test.ts` Expected: FAIL (`@/lib/settings/branding-rules` does not exist; `branding` missing from the parsed environment).

- [ ] **Step 3: Write the client-safe modules**

```ts
// lib/settings/modes.ts
/**
 * Where a settings area's values come from (settings spec §2 #2), chosen by its `<AREA>_MODE` variable: `disabled` (off;
 * for branding the built-in look), `env` (environment variables, shown read-only) or `database` (edited on the admin page).
 * Unset is `disabled`. Client-safe: the settings pages read it too.
 */
export const SETTINGS_MODES = ['disabled', 'env', 'database'] as const

export type SettingsMode = (typeof SETTINGS_MODES)[number]
```

```ts
// lib/settings/branding-rules.ts
import * as z from 'zod'

/** The brand the hub ships with (settings spec §4.1). */
export const BUILT_IN_BRAND_NAME = 'Dify App Hub'

/** Spec §4.1: trimmed, 1–64 characters (zod 4 counts code points). One name for every language: it is a proper name. */
export const BRAND_NAME_MAX = 64
export const brandNameSchema = z.string().trim().min(1).max(BRAND_NAME_MAX)

export const BRAND_IMAGE_KINDS = ['logo', 'favicon'] as const
export type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number]

/** Spec §2 #11: one save stays under Next's default 1 MB Server Action body (serverActions.md:29-45). */
export const BRAND_IMAGE_MAX_BYTES: Readonly<Record<BrandImageKind, number>> = {
	logo: 512 * 1024,
	favicon: 256 * 1024,
}

/** What the file picker offers and the browser's quick check takes; the server decides (OWASP File Upload Cheat Sheet). */
export const BRAND_IMAGE_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/svg+xml',
] as const

/** Why the server refused an image (spec §4.4): over the byte limit, or not a PNG, JPEG, WebP or SVG that decodes. */
export const BRAND_IMAGE_ERROR_CODES = ['too_large', 'not_allowed'] as const
export type BrandImageErrorCode = (typeof BRAND_IMAGE_ERROR_CODES)[number]

/** The two public image routes (spec §4.5). */
export const BRAND_LOGO_PATH = '/api/branding/logo'
export const BRAND_FAVICON_PATH = '/api/branding/favicon'

/** An image the browser draws: a URL and its intrinsic size (next/image needs both, image.md:105-113). */
export interface BrandImageSource {
	src: string
	width: number
	height: number
}

/** The brand as the shell draws it (spec §4.6), trimmed for the client (ADR-0020). */
export interface BrandingView {
	name: string
	/** Already effective: true whenever there is no logo. */
	showName: boolean
	/** null: the name only. */
	logo: BrandImageSource | null
	faviconSrc: string
}

/** Spec §4.2: the name shows whenever no logo can be drawn, so the header and the login card are never empty. */
export const effectiveShowName = (showName: boolean, hasLogo: boolean): boolean =>
	showName || !hasLogo
```

- [ ] **Step 4: Parse the mode and the env block in `lib/env.ts`**

Add the imports at the top of the import block:

```ts
import { brandNameSchema } from '@/lib/settings/branding-rules'
import { SETTINGS_MODES, type SettingsMode } from '@/lib/settings/modes'
```

After the `blankAsAbsent` helper, add:

```ts
/** Settings spec §3.1: read leniently like the flags (blanks and case do not matter); unset or blank is `disabled`. */
const brandingModeSchema = z.preprocess(
	value => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined),
	z.enum(SETTINGS_MODES).default('disabled'),
)

/** Required together once BRANDING_MODE is env (spec §4.2; the all-or-nothing rule of the SMTP and LDAP blocks). */
const brandingSchema = z
	.object({
		BRANDING_NAME: brandNameSchema,
		BRANDING_SHOW_NAME: flag('true'),
		BRANDING_LOGO_FILE: blankAsAbsent(z.string().trim().optional()),
		BRANDING_FAVICON_FILE: blankAsAbsent(z.string().trim().optional()),
	})
	.refine(value => value.BRANDING_SHOW_NAME === 'true' || value.BRANDING_LOGO_FILE !== undefined, {
		path: ['BRANDING_SHOW_NAME'],
		message: 'true unless BRANDING_LOGO_FILE is set',
	})
```

Next to `SmtpConfig`, add:

```ts
export interface BrandingEnvValues {
	name: string
	showName: boolean
	/** Paths inside the container, mounted read-only (docs/settings.md); null when unset. */
	logoFile: string | null
	faviconFile: string | null
}

export interface BrandingEnv {
	mode: SettingsMode
	/** Set in `env` mode only; the BRANDING_* block is ignored in the other modes (spec §3.1). */
	values: BrandingEnvValues | null
}
```

Add `branding: BrandingEnv` to `ServerEnv`. In `parseEnv`, after the LDAP block and before `return`:

```ts
const brandingMode = brandingModeSchema.safeParse(source.BRANDING_MODE)
if (!brandingMode.success) throw new EnvError(['BRANDING_MODE'])
let brandingValues: BrandingEnvValues | null = null
if (brandingMode.data === 'env') {
	const parsed = brandingSchema.safeParse(source)
	if (!parsed.success) throw new EnvError(keysOf(parsed.error))
	brandingValues = {
		name: parsed.data.BRANDING_NAME,
		showName: parsed.data.BRANDING_SHOW_NAME === 'true',
		logoFile: parsed.data.BRANDING_LOGO_FILE ?? null,
		faviconFile: parsed.data.BRANDING_FAVICON_FILE ?? null,
	}
}
```

and add `branding: { mode: brandingMode.data, values: brandingValues },` to the returned object.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/env.test.ts __tests__/branding-rules.test.ts` Expected: PASS.

- [ ] **Step 6: Fix the other `ServerEnv` literals**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit` Expected: errors only where a test or fixture builds a `ServerEnv` object (for example a mocked `env()` returning `{ …, smtp: null, ldap: null }`). Add `branding: { mode: 'disabled', values: null }` to each one the compiler names, then re-run until tsc is clean and `pnpm test` passes.

- [ ] **Step 7: Document the variables in `.env.template`**

After the LDAP block, append:

```bash

# Branding (docs/settings.md, ADR-0030). disabled: the built-in name and logo. env: the BRANDING_* values below.
# database: set on the admin page (Settings > Branding); the BRANDING_* values below are then ignored.
BRANDING_MODE=disabled
# BRANDING_NAME=Acme AI Hub
# true or false: the name beside the logo; false needs BRANDING_LOGO_FILE
# BRANDING_SHOW_NAME=true
# Image files inside the container, mounted read-only: PNG, JPEG, WebP or SVG, logo up to 512 KB, icon up to 256 KB
# BRANDING_LOGO_FILE=/branding/logo.svg
# BRANDING_FAVICON_FILE=/branding/favicon.png
```

- [ ] **Step 8: Gates and commit**

```bash
git add lib/settings/modes.ts lib/settings/branding-rules.ts lib/env.ts .env.template __tests__/env.test.ts __tests__/branding-rules.test.ts
# plus every test file Step 6 touched
git commit -m "feat(settings): parse BRANDING_MODE and the branding environment"
```

---

### Task 3: Image processing with sharp

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml` (sharp as a direct dependency)
- Create: `lib/settings/images.ts`
- Test: `__tests__/settings-images.test.ts`

**Interfaces:**

- Consumes: `BRAND_IMAGE_MAX_BYTES`, `BrandImageKind`, `BrandImageErrorCode` (Task 2).
- Produces: `interface ProcessedImage { bytes: Buffer; sha256: string; width: number; height: number }`, `class BrandImageError extends Error { code: BrandImageErrorCode }`, `MAX_INPUT_PIXELS = 4096 * 4096`, `processBrandImage(kind: BrandImageKind, input: Buffer): Promise<ProcessedImage>`.

- [ ] **Step 1: Add sharp at the version Next resolves**

Run: `ls -d node_modules/.pnpm/sharp@*` (expected: `sharp@0.35.4…`), then `pnpm add -E sharp@0.35.4`. Expected: `"sharp": "0.35.4"` in `dependencies`, and still one `sharp@0.35.4` folder under `node_modules/.pnpm` (one copy, the reasoning of ADR-0013; exact pin as ADR-0029 pins ldapts and croner).

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/settings-images.test.ts
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { BrandImageError, MAX_INPUT_PIXELS, processBrandImage } from '@/lib/settings/images'

const solid = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 4, background: { r: 22, g: 119, b: 255, alpha: 1 } } })

/** The refusal code, or 'accepted'. */
const outcome = async (work: Promise<unknown>) => {
	try {
		await work
		return 'accepted'
	} catch (error) {
		return error instanceof BrandImageError ? error.code : `other: ${String(error)}`
	}
}

describe('processBrandImage (settings spec §4.4)', () => {
	it.each(['png', 'jpeg', 'webp'] as const)('re-encodes a %s logo as a PNG inside 768 × 192', async format => {
		const out = await processBrandImage('logo', await solid(1600, 400)[format]().toBuffer())
		const meta = await sharp(out.bytes).metadata()
		expect(meta.format).toBe('png')
		expect([out.width, out.height]).toEqual([768, 192])
		expect([meta.width, meta.height]).toEqual([768, 192])
		expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
	})

	it('does not enlarge a small raster logo', async () => {
		const out = await processBrandImage('logo', await solid(100, 40).png().toBuffer())
		expect([out.width, out.height]).toEqual([100, 40])
	})

	it('draws an SVG wordmark that has only a viewBox at the full box size (Review Focus 2)', async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#1677ff"/></svg>',
		)
		const out = await processBrandImage('logo', svg)
		expect([out.width, out.height]).toEqual([768, 192])
		expect((await sharp(out.bytes).metadata()).format).toBe('png')
	})

	it('turns a favicon into a 64 × 64 PNG with transparent padding', async () => {
		const out = await processBrandImage('favicon', await solid(300, 100).png().toBuffer())
		expect([out.width, out.height]).toEqual([64, 64])
		expect((await sharp(out.bytes).metadata()).hasAlpha).toBe(true)
	})

	it('stores a phone photo upright and without its metadata (Review Focus 3)', async () => {
		// 400 × 200 stored with EXIF orientation 6 is a 200 × 400 picture; inside 768 × 192 that is 96 × 192.
		const input = await solid(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer()
		const out = await processBrandImage('logo', input)
		expect([out.width, out.height]).toEqual([96, 192])
		const meta = await sharp(out.bytes).metadata()
		expect(meta.exif).toBeUndefined()
		expect(meta.orientation).toBeUndefined()
	})

	it.each([
		['an ICO file', Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), Buffer.alloc(64)])],
		['a text file', Buffer.from('not an image')],
		['an empty file', Buffer.alloc(0)],
	])('refuses %s as not_allowed', async (_name, input) => {
		expect(await outcome(processBrandImage('logo', input))).toBe('not_allowed')
	})

	it('refuses a GIF, which sharp decodes but the allowlist does not take', async () => {
		expect(await outcome(processBrandImage('favicon', await solid(10, 10).gif().toBuffer()))).toBe('not_allowed')
	})

	it('refuses a truncated PNG whose header still reads', async () => {
		const png = await solid(300, 300).png().toBuffer()
		expect(await outcome(processBrandImage('logo', png.subarray(0, Math.floor(png.length / 2))))).toBe('not_allowed')
	})

	it('refuses an image over the pixel limit although its bytes are small (Review Focus 4)', async () => {
		const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: 'white' } })
			.png({ compressionLevel: 9 })
			.toBuffer()
		expect(bomb.length).toBeLessThan(512 * 1024)
		expect(5000 * 5000).toBeGreaterThan(MAX_INPUT_PIXELS)
		expect(await outcome(processBrandImage('logo', bomb))).toBe('not_allowed')
	})

	it('refuses input over its kind's byte limit before decoding', async () => {
		expect(await outcome(processBrandImage('favicon', Buffer.alloc(256 * 1024 + 1)))).toBe('too_large')
		expect(await outcome(processBrandImage('logo', Buffer.alloc(512 * 1024 + 1)))).toBe('too_large')
	})
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/settings-images.test.ts` Expected: FAIL (`@/lib/settings/images` does not exist).

- [ ] **Step 4: Write the pipeline**

```ts
// lib/settings/images.ts
import 'server-only'

import { createHash } from 'node:crypto'

import sharp from 'sharp'

import {
	BRAND_IMAGE_MAX_BYTES,
	type BrandImageErrorCode,
	type BrandImageKind,
} from './branding-rules'

/** An image the hub produced (settings spec §4.4): a PNG, its SHA-256 (hex) and its size in pixels. */
export interface ProcessedImage {
	bytes: Buffer
	sha256: string
	width: number
	height: number
}

export class BrandImageError extends Error {
	constructor(public readonly code: BrandImageErrorCode) {
		super(code)
		this.name = 'BrandImageError'
	}
}

/** A resource limit in OWASP's sense, tighter than sharp's default `0x3FFF * 0x3FFF` (sharp src/common.h). */
export const MAX_INPUT_PIXELS = 4096 * 4096

/** The decoded formats accepted (spec §4.4 step 3); the browser's declared type is never read. */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp', 'svg'])

/** The logo at three times its largest display height (64 px) and up to 4:1; the favicon twice the 32 px tab size. */
const BOX: Record<BrandImageKind, { width: number; height: number }> = {
	logo: { width: 768, height: 192 },
	favicon: { width: 64, height: 64 },
}

/** sharp's `density` for vector input: "the DPI … in the range 1 to 100000", default 72. */
const SVG_DENSITY_MAX = 100_000

/**
 * The DPI that draws an SVG (whose size sharp reports at 72 DPI, from width/height or the viewBox) at the box's scale, so a
 * small vector logo is drawn sharp instead of enlarged as pixels.
 */
const svgDensity = (width: number, height: number, box: { width: number; height: number }) =>
	Math.min(Math.max(72 * Math.min(box.width / width, box.height / height), 1), SVG_DENSITY_MAX)

/**
 * Decode, check and re-encode an image as PNG (OWASP File Upload Cheat Sheet: "decode and re-encode to an allowed image
 * format, explicitly removing unnecessary metadata … restricted formats, resource limits"). sharp refuses input on any
 * decoder warning by default (`failOn`), removes metadata from its output by default ("By default all metadata will be
 * removed"), and `autoOrient` applies the EXIF orientation first, so a phone photo stays upright.
 */
export async function processBrandImage(
	kind: BrandImageKind,
	input: Buffer,
): Promise<ProcessedImage> {
	if (input.length > BRAND_IMAGE_MAX_BYTES[kind]) throw new BrandImageError('too_large')
	const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true }
	let meta: sharp.Metadata
	try {
		meta = await sharp(input, options).metadata()
	} catch {
		throw new BrandImageError('not_allowed')
	}
	if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height)
		throw new BrandImageError('not_allowed')
	const box = BOX[kind]
	const density = meta.format === 'svg' ? svgDensity(meta.width, meta.height, box) : undefined
	try {
		const { data, info } = await sharp(input, { ...options, density })
			.resize({
				...box,
				fit: kind === 'logo' ? 'inside' : 'contain',
				withoutEnlargement: kind === 'logo',
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			})
			.png()
			.toBuffer({ resolveWithObject: true })
		return {
			bytes: data,
			sha256: createHash('sha256').update(data).digest('hex'),
			width: info.width,
			height: info.height,
		}
	} catch {
		throw new BrandImageError('not_allowed')
	}
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/settings-images.test.ts` Expected: PASS (every case). If the bomb case is slow, keep it: it is the limit's only proof.

- [ ] **Step 6: Gates and commit**

```bash
git add package.json pnpm-lock.yaml lib/settings/images.ts __tests__/settings-images.test.ts
git commit -m "feat(settings): decode and re-encode brand images with sharp"
```

---

### Task 4: The settings data access

**Files:**

- Create: `lib/data/settings.ts`
- Test: `__tests__/data-settings.test.ts`

**Interfaces:**

- Consumes: `instanceSettings`, `instanceSettingFiles`, `users` (`@/db/schema`); `assertAdmin`, `SessionUser` (`@/lib/auth/session`).
- Produces: `type SettingsArea = 'branding'`; `interface InstanceSettingRow { data: unknown; updatedAt: Date; updatedBy: string | null; updatedByEmail: string | null }`; `interface InstanceSettingFile { bytes: Buffer; mime: string }`; `type InstanceSettingFileChanges = Partial<Record<string, InstanceSettingFile | null>>`; `readInstanceSetting(area): Promise<InstanceSettingRow | null>`; `readInstanceSettingFile(area, name): Promise<InstanceSettingFile | null>`; `writeInstanceSetting(actor, area, data, files): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/data-settings.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { calls, rows } = vi.hoisted(() => ({
	calls: [] as unknown[][],
	rows: { value: [] as unknown[] },
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', async () => {
	const { instanceSettingFiles, instanceSettings } = await import('@/db/schema')
	const nameOf = (table: unknown) =>
		table === instanceSettings
			? 'instance_settings'
			: table === instanceSettingFiles
				? 'instance_setting_files'
				: 'other'
	const chain = {
		leftJoin: () => chain,
		where: () => chain,
		limit: () => Promise.resolve(rows.value),
	}
	const db = {
		select: () => ({ from: () => chain }),
		insert: (table: unknown) => ({
			values: (values: unknown) => ({
				onDuplicateKeyUpdate: (update: unknown) => {
					calls.push(['upsert', nameOf(table), values, update])
					return Promise.resolve()
				},
			}),
		}),
		delete: (table: unknown) => ({
			where: () => {
				calls.push(['delete', nameOf(table)])
				return Promise.resolve()
			},
		}),
		transaction: async (work: (tx: unknown) => unknown) => {
			calls.push(['begin'])
			await work(db)
			calls.push(['commit'])
		},
	}
	return { getDb: () => db }
})

import { AuthError } from '@/lib/auth/session'
import {
	readInstanceSetting,
	readInstanceSettingFile,
	writeInstanceSetting,
} from '@/lib/data/settings'

const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' as const }
const user = { id: 'u1', email: 'user@example.com', name: null, role: 'user' as const }

beforeEach(() => {
	calls.length = 0
	rows.value = []
})

describe('readInstanceSetting', () => {
	it('answers null before the first save, and the row with its author afterwards', async () => {
		expect(await readInstanceSetting('branding')).toBeNull()
		const row = {
			data: { name: 'Acme' },
			updatedAt: new Date(),
			updatedBy: 'a1',
			updatedByEmail: 'admin@example.com',
		}
		rows.value = [row]
		expect(await readInstanceSetting('branding')).toEqual(row)
	})
})

describe('readInstanceSettingFile', () => {
	it('answers the bytes and type, or null', async () => {
		expect(await readInstanceSettingFile('branding', 'logo')).toBeNull()
		rows.value = [{ bytes: Buffer.from([1]), mime: 'image/png' }]
		expect(await readInstanceSettingFile('branding', 'logo')).toEqual({
			bytes: Buffer.from([1]),
			mime: 'image/png',
		})
	})
})

describe('writeInstanceSetting (spec §4.3: one transaction)', () => {
	it('refuses a user-role account before writing anything (ADR-0024: the DAL checks the role again)', async () => {
		await expect(writeInstanceSetting(user, 'branding', {}, {})).rejects.toBeInstanceOf(AuthError)
		await expect(writeInstanceSetting(user, 'branding', {}, {})).rejects.toMatchObject({
			code: 'forbidden',
		})
		expect(calls).toEqual([])
	})

	it('upserts the document with its author, upserts a new file, deletes a removed one and keeps an absent one', async () => {
		const logo = { bytes: Buffer.from([1, 2]), mime: 'image/png' }
		await writeInstanceSetting(admin, 'branding', { name: 'Acme' }, { logo, favicon: null })
		expect(calls[0]).toEqual(['begin'])
		expect(calls[1]).toEqual([
			'upsert',
			'instance_settings',
			expect.objectContaining({ area: 'branding', data: { name: 'Acme' }, updatedBy: 'a1' }),
			{ set: expect.objectContaining({ data: { name: 'Acme' }, updatedBy: 'a1' }) },
		])
		expect(calls[2]).toEqual([
			'upsert',
			'instance_setting_files',
			expect.objectContaining({
				area: 'branding',
				name: 'logo',
				bytes: logo.bytes,
				mime: 'image/png',
			}),
			{ set: expect.objectContaining({ bytes: logo.bytes, mime: 'image/png' }) },
		])
		expect(calls[3]).toEqual(['delete', 'instance_setting_files'])
		expect(calls[4]).toEqual(['commit'])
		expect(calls).toHaveLength(5)
	})
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/data-settings.test.ts` Expected: FAIL (`@/lib/data/settings` does not exist).

- [ ] **Step 3: Write the DAL**

```ts
// lib/data/settings.ts
import 'server-only'

import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db'
import { instanceSettingFiles, instanceSettings, users } from '@/db/schema'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

/** The areas with a row (settings spec §3.2); SMTP and LDAP join in their own PRs. */
export type SettingsArea = 'branding'

export interface InstanceSettingRow {
	data: unknown
	updatedAt: Date
	updatedBy: string | null
	/** The saving account's email while that account exists (left join; no foreign key, spec §3.2). */
	updatedByEmail: string | null
}

export interface InstanceSettingFile {
	bytes: Buffer
	mime: string
}

/** A file to store under the area, or `null` to delete it; a name left out keeps its file. */
export type InstanceSettingFileChanges = Partial<Record<string, InstanceSettingFile | null>>

/**
 * The area's row, or null before its first save. It takes no actor: the brand is public by design, since the login page
 * shows it (spec §3.3); SMTP's and LDAP's readers add their own gate.
 */
export const readInstanceSetting = async (
	area: SettingsArea,
): Promise<InstanceSettingRow | null> => {
	const [row] = await getDb()
		.select({
			data: instanceSettings.data,
			updatedAt: instanceSettings.updatedAt,
			updatedBy: instanceSettings.updatedBy,
			updatedByEmail: users.email,
		})
		.from(instanceSettings)
		.leftJoin(users, eq(users.id, instanceSettings.updatedBy))
		.where(eq(instanceSettings.area, area))
		.limit(1)
	return row ?? null
}

export const readInstanceSettingFile = async (
	area: SettingsArea,
	name: string,
): Promise<InstanceSettingFile | null> => {
	const [row] = await getDb()
		.select({ bytes: instanceSettingFiles.bytes, mime: instanceSettingFiles.mime })
		.from(instanceSettingFiles)
		.where(and(eq(instanceSettingFiles.area, area), eq(instanceSettingFiles.name, name)))
		.limit(1)
	return row ?? null
}

/**
 * Saves the area's document and its file changes in one transaction, so a document never names a missing file (spec §4.3).
 * The role is checked again here (ADR-0024: the DAL's own gate).
 */
export const writeInstanceSetting = async (
	actor: SessionUser,
	area: SettingsArea,
	data: unknown,
	files: InstanceSettingFileChanges,
): Promise<void> => {
	assertAdmin(actor)
	const now = new Date()
	await getDb().transaction(async tx => {
		await tx
			.insert(instanceSettings)
			.values({ area, data, updatedAt: now, updatedBy: actor.id })
			.onDuplicateKeyUpdate({ set: { data, updatedAt: now, updatedBy: actor.id } })
		for (const [name, file] of Object.entries(files)) {
			if (file === undefined) continue
			if (file === null) {
				await tx
					.delete(instanceSettingFiles)
					.where(and(eq(instanceSettingFiles.area, area), eq(instanceSettingFiles.name, name)))
				continue
			}
			await tx
				.insert(instanceSettingFiles)
				.values({ area, name, bytes: file.bytes, mime: file.mime, updatedAt: now })
				.onDuplicateKeyUpdate({ set: { bytes: file.bytes, mime: file.mime, updatedAt: now } })
		}
	})
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/data-settings.test.ts` Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
git add lib/data/settings.ts __tests__/data-settings.test.ts
git commit -m "feat(settings): add the instance settings data access"
```

---

### Task 5: The branding reader

**Files:**

- Create: `lib/settings/branding.ts`
- Modify: `lib/error-log.ts`, `lib/action-result.ts`
- Test: `__tests__/settings-branding.test.ts`

**Interfaces:**

- Consumes: Tasks 2–4.
- Produces:
  - `storedImageSchema`, `type StoredImage = { sha256: string; width: number; height: number }`, `brandingDataSchema`, `type BrandingData`.
  - `interface Branding { mode: SettingsMode; builtIn: boolean; name: string; showName: boolean; logo: StoredImage | null; favicon: StoredImage | null }`.
  - `getBranding(): Promise<Branding>` (React `cache`).
  - `brandingView(branding: Branding, builtInImage: BrandImageSource): BrandingView`.
  - `readBrandImage(kind: BrandImageKind): Promise<{ bytes: Buffer; sha256: string } | null>`.
  - `interface BrandingSettingsView` (below) and `getBrandingSettings(actor: SessionUser, builtInImage: BrandImageSource): Promise<BrandingSettingsView>`.
  - `type ImageChange = { intent: 'keep' } | { intent: 'remove' } | { intent: 'replace'; file: File }`, `interface BrandingInput { name: string; showName: boolean; images: Record<BrandImageKind, ImageChange> }`, `isBrandingEditable(): boolean`, `saveBranding(actor: SessionUser, input: BrandingInput): Promise<ActionResult>`.
  - `logSettingsError(setting: string, code: string): void` in `lib/error-log.ts`.
  - `ActionErrorCode` gains `'settings_not_editable' | 'invalid_image'`.

- [ ] **Step 1: Add the two action codes and the log helper**

In `lib/action-result.ts`, add to `ActionErrorCode` (before `'operation_failed'`):

```ts
	| 'settings_not_editable'
	| 'invalid_image'
```

At the end of `lib/error-log.ts`:

```ts
/**
 * A setting the hub could not use (settings spec §4.2, §7): the variable or record and a code, never a path or a value,
 * as LDAP_CA_FILE is logged (lib/directory/schedule.ts).
 */
export const logSettingsError = (setting: string, code: string): void => {
	console.error(`${setting} could not be used:`, { code })
}
```

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/settings-branding.test.ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BrandingEnv } from '@/lib/env'

const { envState, data, logs } = vi.hoisted(() => ({
	envState: { branding: { mode: 'disabled', values: null } as BrandingEnv },
	data: {
		readInstanceSetting: vi.fn(),
		readInstanceSettingFile: vi.fn(),
		writeInstanceSetting: vi.fn(),
	},
	logs: { logSettingsError: vi.fn(), logActionError: vi.fn() },
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/env', () => ({ env: () => envState }))
vi.mock('@/lib/data/settings', () => data)
// The factories hand back the same hoisted spies after each vi.resetModules() (Vitest `vi.mock`, `vi.hoisted`).
vi.mock('@/lib/error-log', () => logs)
const { logSettingsError, logActionError } = logs

/** A fresh module per test: env mode keeps its processed files for the process. */
const load = async () => {
	vi.resetModules()
	return import('@/lib/settings/branding')
}

const builtInImage = { src: '/_next/static/media/logo.abc.png', width: 81, height: 83 }
const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' as const }
const sha = (char: string) => char.repeat(64)
const png = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 4, background: '#1677ff' } }).png().toBuffer()

beforeEach(() => {
	envState.branding = { mode: 'disabled', values: null }
	for (const fn of Object.values(data)) fn.mockReset()
	logSettingsError.mockClear()
	logActionError.mockClear()
})

describe('getBranding (settings spec §3.3)', () => {
	it('is the built-in brand in disabled mode, without a database read', async () => {
		const { getBranding } = await load()
		expect(await getBranding()).toEqual({
			mode: 'disabled',
			builtIn: true,
			name: 'Dify App Hub',
			showName: true,
			logo: null,
			favicon: null,
		})
		expect(data.readInstanceSetting).not.toHaveBeenCalled()
	})

	it('is the built-in brand in database mode before the first save, and the saved one afterwards', async () => {
		envState.branding = { mode: 'database', values: null }
		const { getBranding } = await load()
		data.readInstanceSetting.mockResolvedValueOnce(null)
		expect(await getBranding()).toMatchObject({ mode: 'database', builtIn: true, name: 'Dify App Hub' })
		const logo = { sha256: sha('a'), width: 400, height: 100 }
		data.readInstanceSetting.mockResolvedValueOnce({
			data: { name: 'Acme', showName: false, logo, favicon: null },
			updatedAt: new Date(),
			updatedBy: 'a1',
			updatedByEmail: null,
		})
		expect(await (await load()).getBranding()).toEqual({
			mode: 'database',
			builtIn: false,
			name: 'Acme',
			showName: false,
			logo,
			favicon: null,
		})
	})

	it('falls back to the built-in brand and logs a document the schema refuses', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({ data: { name: '' }, updatedAt: new Date(), updatedBy: null, updatedByEmail: null })
		expect(await (await load()).getBranding()).toMatchObject({ builtIn: true })
		expect(logSettingsError).toHaveBeenCalledWith('instance_settings.branding', 'invalid_document')
	})

	it('falls back to the built-in brand when the database does not answer (Review Focus 1)', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
		expect(await (await load()).getBranding()).toMatchObject({ mode: 'database', builtIn: true })
		expect(logActionError).toHaveBeenCalledWith(expect.any(Error), 'getBranding')
	})

	it('reads env mode from the variables and the processed files', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'branding-'))
		const logoFile = path.join(dir, 'logo.png')
		await writeFile(logoFile, await png(800, 200))
		envState.branding = { mode: 'env', values: { name: 'Acme', showName: true, logoFile, faviconFile: null } }
		const branding = await (await load()).getBranding()
		expect(branding).toMatchObject({ mode: 'env', builtIn: false, name: 'Acme', showName: true, favicon: null })
		expect(branding.logo).toEqual({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/), width: 768, height: 192 })
	})

	it('runs without an env file it cannot use, logging the variable and the code, never the path (Review Focus 5)', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'branding-'))
		await mkdir(path.join(dir, 'a-directory'))
		envState.branding = {
			mode: 'env',
			values: {
				name: 'Acme',
				showName: false,
				logoFile: path.join(dir, 'missing.png'),
				faviconFile: path.join(dir, 'a-directory'),
			},
		}
		const { getBranding, getBrandingSettings } = await load()
		expect(await getBranding()).toMatchObject({ logo: null, favicon: null })
		expect(logSettingsError).toHaveBeenCalledWith('BRANDING_LOGO_FILE', 'ENOENT')
		expect(logSettingsError).toHaveBeenCalledWith('BRANDING_FAVICON_FILE', 'EISDIR')
		expect(JSON.stringify(logSettingsError.mock.calls)).not.toContain(dir)
		const settings = await getBrandingSettings(admin, builtInImage)
		expect(settings.env?.errors).toEqual({ logo: 'ENOENT', favicon: 'EISDIR' })
		// Spec §4.2: the name shows while the logo is unavailable, although BRANDING_SHOW_NAME is false.
		expect(settings.current.showName).toBe(true)
	})

	it('refuses an oversized env file by its size, without reading it', async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'branding-'))
		const faviconFile = path.join(dir, 'big.png')
		await writeFile(faviconFile, Buffer.alloc(256 * 1024 + 1))
		envState.branding = { mode: 'env', values: { name: 'Acme', showName: true, logoFile: null, faviconFile } }
		await (await load()).getBranding()
		expect(logSettingsError).toHaveBeenCalledWith('BRANDING_FAVICON_FILE', 'too_large')
	})
})

describe('brandingView (spec §4.6)', () => {
	const base = { mode: 'database' as const, builtIn: false, name: 'Acme', showName: true, logo: null, favicon: null }

	it('draws the built-in image for the built-in brand', async () => {
		const { brandingView } = await load()
		expect(brandingView({ ...base, builtIn: true, name: 'Dify App Hub' }, builtInImage)).toEqual({
			name: 'Dify App Hub',
			showName: true,
			logo: builtInImage,
			faviconSrc: builtInImage.src,
		})
	})

	it('points at the versioned routes, with the favicon falling back to the logo and then to the built-in icon', async () => {
		const { brandingView } = await load()
		const logo = { sha256: `${'1'.repeat(16)}${'f'.repeat(48)}`, width: 400, height: 100 }
		const favicon = { sha256: `${'2'.repeat(16)}${'e'.repeat(48)}`, width: 64, height: 64 }
		expect(brandingView({ ...base, logo, favicon }, builtInImage)).toEqual({
			name: 'Acme',
			showName: true,
			logo: { src: `/api/branding/logo?v=${'1'.repeat(16)}`, width: 400, height: 100 },
			faviconSrc: `/api/branding/favicon?v=${'2'.repeat(16)}`,
		})
		expect(brandingView({ ...base, logo }, builtInImage).faviconSrc).toBe(`/api/branding/favicon?v=${'1'.repeat(16)}`)
		expect(brandingView(base, builtInImage).faviconSrc).toBe(builtInImage.src)
	})

	it('shows the name whenever there is no logo', async () => {
		const { brandingView } = await load()
		expect(brandingView({ ...base, showName: false }, builtInImage)).toMatchObject({ showName: true, logo: null })
	})
})

describe('readBrandImage (spec §4.5)', () => {
	it('serves the stored file with the document's hash in database mode', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({
			data: { name: 'Acme', showName: true, logo: { sha256: sha('a'), width: 4, height: 1 }, favicon: null },
			updatedAt: new Date(),
			updatedBy: null,
			updatedByEmail: null,
		})
		data.readInstanceSettingFile.mockResolvedValue({ bytes: Buffer.from([7]), mime: 'image/png' })
		const { readBrandImage } = await load()
		expect(await readBrandImage('logo')).toEqual({ bytes: Buffer.from([7]), sha256: sha('a') })
		expect(await readBrandImage('favicon')).toBeNull()
	})

	it('answers null and logs when the document names a file that is not there', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({
			data: { name: 'Acme', showName: true, logo: { sha256: sha('a'), width: 4, height: 1 }, favicon: null },
			updatedAt: new Date(),
			updatedBy: null,
			updatedByEmail: null,
		})
		data.readInstanceSettingFile.mockResolvedValue(null)
		expect(await (await load()).readBrandImage('logo')).toBeNull()
		expect(logSettingsError).toHaveBeenCalledWith('instance_setting_files.branding.logo', 'missing_file')
	})

	it('serves nothing in disabled mode', async () => {
		expect(await (await load()).readBrandImage('logo')).toBeNull()
	})
})

describe('saveBranding (spec §5.4)', () => {
	const keepBoth = { logo: { intent: 'keep' as const }, favicon: { intent: 'keep' as const } }
	const saved = { sha256: sha('a'), width: 400, height: 100 }

	beforeEach(() => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({
			data: { name: 'Old', showName: true, logo: saved, favicon: null },
			updatedAt: new Date(),
			updatedBy: 'a1',
			updatedByEmail: null,
		})
	})

	it('refuses outside database mode', async () => {
		envState.branding = { mode: 'env', values: { name: 'Acme', showName: true, logoFile: null, faviconFile: null } }
		const { saveBranding } = await load()
		expect(await saveBranding(admin, { name: 'Acme', showName: true, images: keepBoth })).toEqual({
			ok: false,
			code: 'settings_not_editable',
		})
		expect(data.writeInstanceSetting).not.toHaveBeenCalled()
	})

	it('keeps the stored images on keep, and writes no file change', async () => {
		const { saveBranding } = await load()
		expect(await saveBranding(admin, { name: 'Acme', showName: false, images: keepBoth })).toEqual({ ok: true, data: undefined })
		expect(data.writeInstanceSetting).toHaveBeenCalledWith(
			admin,
			'branding',
			{ name: 'Acme', showName: false, logo: saved, favicon: null },
			{},
		)
	})

	it('processes a replaced image and deletes a removed one', async () => {
		const { saveBranding } = await load()
		const file = new File([await png(64, 64)], 'icon.png', { type: 'image/png' })
		const result = await saveBranding(admin, {
			name: 'Acme',
			showName: true,
			images: { logo: { intent: 'remove' }, favicon: { intent: 'replace', file } },
		})
		expect(result).toEqual({ ok: true, data: undefined })
		const [, , document, files] = data.writeInstanceSetting.mock.calls[0]
		expect(document).toMatchObject({ logo: null, favicon: { width: 64, height: 64 } })
		expect(files).toEqual({ logo: null, favicon: { bytes: expect.any(Buffer), mime: 'image/png' } })
	})

	it('names each refused image in fieldErrors and writes nothing', async () => {
		const { saveBranding } = await load()
		const text = new File(['not an image'], 'logo.png', { type: 'image/png' })
		const big = new File([Buffer.alloc(256 * 1024 + 1)], 'icon.png', { type: 'image/png' })
		expect(
			await saveBranding(admin, {
				name: 'Acme',
				showName: true,
				images: { logo: { intent: 'replace', file: text }, favicon: { intent: 'replace', file: big } },
			}),
		).toEqual({ ok: false, code: 'invalid_image', fieldErrors: { logo: ['not_allowed'], favicon: ['too_large'] } })
		expect(data.writeInstanceSetting).not.toHaveBeenCalled()
	})

	it('refuses to hide the name when no logo is left', async () => {
		const { saveBranding } = await load()
		expect(
			await saveBranding(admin, {
				name: 'Acme',
				showName: false,
				images: { logo: { intent: 'remove' }, favicon: { intent: 'keep' } },
			}),
		).toEqual({ ok: false, code: 'invalid_input', fieldErrors: { showName: ['logo_required'] } })
	})

	it('refuses a user-role account', async () => {
		const { saveBranding } = await load()
		await expect(
			saveBranding({ ...admin, role: 'user' }, { name: 'Acme', showName: true, images: keepBoth }),
		).rejects.toMatchObject({ code: 'forbidden' })
	})
})

describe('getBrandingSettings', () => {
	it('carries the last change in database mode', async () => {
		envState.branding = { mode: 'database', values: null }
		const at = new Date('2026-10-11T10:00:00.000Z')
		data.readInstanceSetting.mockResolvedValue({
			data: { name: 'Acme', showName: true, logo: null, favicon: null },
			updatedAt: at,
			updatedBy: 'a1',
			updatedByEmail: 'admin@example.com',
		})
		const settings = await (await load()).getBrandingSettings(admin, builtInImage)
		expect(settings).toMatchObject({
			mode: 'database',
			name: 'Acme',
			hasLogo: false,
			faviconSrc: null,
			env: null,
			updatedAt: '2026-10-11T10:00:00.000Z',
			updatedByEmail: 'admin@example.com',
		})
	})
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm exec vitest run --project unit __tests__/settings-branding.test.ts` Expected: FAIL (`@/lib/settings/branding` does not exist).

- [ ] **Step 4: Write the reader**

```ts
// lib/settings/branding.ts
import 'server-only'

import { readFile, stat } from 'node:fs/promises'

import { cache } from 'react'
import * as z from 'zod'

import { fail, ok, type ActionResult } from '@/lib/action-result'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'
import {
	readInstanceSetting,
	readInstanceSettingFile,
	writeInstanceSetting,
	type InstanceSettingFileChanges,
} from '@/lib/data/settings'
import { env, type BrandingEnvValues } from '@/lib/env'
import { logActionError, logSettingsError } from '@/lib/error-log'

import {
	BRAND_FAVICON_PATH,
	BRAND_IMAGE_KINDS,
	BRAND_IMAGE_MAX_BYTES,
	BRAND_LOGO_PATH,
	BUILT_IN_BRAND_NAME,
	brandNameSchema,
	effectiveShowName,
	type BrandImageKind,
	type BrandImageSource,
	type BrandingView,
} from './branding-rules'
import { BrandImageError, processBrandImage, type ProcessedImage } from './images'
import type { SettingsMode } from './modes'

/** A processed image as the document records it (spec §4.3): the PNG's hash and size; the bytes are a file row. */
export const storedImageSchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
})
export type StoredImage = z.infer<typeof storedImageSchema>

/** The branding document in instance_settings (spec §4.3), checked on every read and write. */
export const brandingDataSchema = z.object({
	name: brandNameSchema,
	showName: z.boolean(),
	logo: storedImageSchema.nullable(),
	favicon: storedImageSchema.nullable(),
})
export type BrandingData = z.infer<typeof brandingDataSchema>

/** The brand in effect (spec §3.3). `builtIn`: the hub's own name and image, in `disabled` mode and before a first save. */
export interface Branding {
	mode: SettingsMode
	builtIn: boolean
	name: string
	showName: boolean
	logo: StoredImage | null
	favicon: StoredImage | null
}

const builtInBranding = (mode: SettingsMode): Branding => ({
	mode,
	builtIn: true,
	name: BUILT_IN_BRAND_NAME,
	showName: true,
	logo: null,
	favicon: null,
})

const stored = (image: ProcessedImage | undefined): StoredImage | null =>
	image ? { sha256: image.sha256, width: image.width, height: image.height } : null

export const ENV_FILE_VARIABLE: Record<
	BrandImageKind,
	'BRANDING_LOGO_FILE' | 'BRANDING_FAVICON_FILE'
> = {
	logo: 'BRANDING_LOGO_FILE',
	favicon: 'BRANDING_FAVICON_FILE',
}

/** env mode's files after processing (spec §4.2) and why a set file could not be used. */
interface EnvImages {
	images: Partial<Record<BrandImageKind, ProcessedImage>>
	/** A Node error code (ENOENT, EACCES, EISDIR) or an image refusal code (too_large, not_allowed). */
	errors: Partial<Record<BrandImageKind, string>>
}

const errorCode = (error: unknown): string => {
	if (error instanceof BrandImageError) return error.code
	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string'
	)
		return error.code
	return 'unknown'
}

/**
 * Reads and processes the env mode files once. A file that cannot be used is logged by its variable and code, never its
 * path, and the hub runs without it (spec §4.2, as LDAP_CA_FILE: lib/directory/connection.ts). Its size is checked before
 * it is read, so a wrong path to a large file is not loaded into memory.
 */
const loadEnvImages = async (values: BrandingEnvValues): Promise<EnvImages> => {
	const result: EnvImages = { images: {}, errors: {} }
	const files: Record<BrandImageKind, string | null> = {
		logo: values.logoFile,
		favicon: values.faviconFile,
	}
	for (const kind of BRAND_IMAGE_KINDS) {
		const file = files[kind]
		if (!file) continue
		try {
			if ((await stat(file)).size > BRAND_IMAGE_MAX_BYTES[kind])
				throw new BrandImageError('too_large')
			result.images[kind] = await processBrandImage(kind, await readFile(file))
		} catch (error) {
			const code = errorCode(error)
			result.errors[kind] = code
			logSettingsError(ENV_FILE_VARIABLE[kind], code)
		}
	}
	return result
}

/** Kept for the process: an environment change takes a restart anyway (spec §4.2). */
let envImagesPromise: Promise<EnvImages> | undefined
const envImages = (values: BrandingEnvValues) => (envImagesPromise ??= loadEnvImages(values))

const fromDocument = (mode: SettingsMode, document: unknown): Branding => {
	const parsed = brandingDataSchema.safeParse(document)
	if (!parsed.success) {
		logSettingsError('instance_settings.branding', 'invalid_document')
		return builtInBranding(mode)
	}
	return { mode, builtIn: false, ...parsed.data }
}

/**
 * The brand in effect for this request (spec §3.3, §3.5): one read shared by generateMetadata, the layouts and the pages
 * (React `cache`, generate-metadata.md:195). A database that does not answer gives the built-in brand, so the login page
 * still renders (Review Focus 1).
 */
export const getBranding = cache(async (): Promise<Branding> => {
	const { mode, values } = env().branding
	if (mode === 'disabled') return builtInBranding(mode)
	if (mode === 'env' && values) {
		const { images } = await envImages(values)
		return {
			mode,
			builtIn: false,
			name: values.name,
			showName: values.showName,
			logo: stored(images.logo),
			favicon: stored(images.favicon),
		}
	}
	try {
		const row = await readInstanceSetting('branding')
		return row ? fromDocument(mode, row.data) : builtInBranding(mode)
	} catch (error) {
		logActionError(error, 'getBranding')
		return builtInBranding(mode)
	}
})

const version = (image: StoredImage) => image.sha256.slice(0, 16)

/**
 * The brand as the browser draws it (spec §4.6). The built-in brand uses the static import's URL and size; a custom image
 * its route with `?v=` (spec §4.5), so a browser that keeps favicons longer than `no-cache` asks still fetches a new one.
 */
export const brandingView = (branding: Branding, builtInImage: BrandImageSource): BrandingView => {
	if (branding.builtIn)
		return { name: branding.name, showName: true, logo: builtInImage, faviconSrc: builtInImage.src }
	const logo = branding.logo
		? {
				src: `${BRAND_LOGO_PATH}?v=${version(branding.logo)}`,
				width: branding.logo.width,
				height: branding.logo.height,
			}
		: null
	const icon = branding.favicon ?? branding.logo
	return {
		name: branding.name,
		showName: effectiveShowName(branding.showName, logo !== null),
		logo,
		faviconSrc: icon ? `${BRAND_FAVICON_PATH}?v=${version(icon)}` : builtInImage.src,
	}
}

/** A custom image's bytes for its route (spec §4.5), or null when there is none; the favicon route falls back itself. */
export const readBrandImage = async (
	kind: BrandImageKind,
): Promise<{ bytes: Buffer; sha256: string } | null> => {
	const { mode, values } = env().branding
	if (mode === 'env' && values) {
		const image = (await envImages(values)).images[kind]
		return image ? { bytes: image.bytes, sha256: image.sha256 } : null
	}
	if (mode !== 'database') return null
	const record = (await getBranding())[kind]
	if (!record) return null
	const file = await readInstanceSettingFile('branding', kind)
	if (!file) {
		logSettingsError(`instance_setting_files.branding.${kind}`, 'missing_file')
		return null
	}
	return { bytes: file.bytes, sha256: record.sha256 }
}

/** What the Branding page shows (spec §5.3). */
export interface BrandingSettingsView {
	mode: SettingsMode
	/** The brand as the shell draws it now. */
	current: BrandingView
	/** As configured (before effectiveShowName): the document in database mode, the variables in env mode. */
	name: string
	showName: boolean
	hasLogo: boolean
	/** The custom favicon's URL, or null while the favicon follows the logo or the built-in icon. */
	faviconSrc: string | null
	/** env mode: the file variables and why a set file could not be used. */
	env: {
		logoFile: string | null
		faviconFile: string | null
		errors: Partial<Record<BrandImageKind, string>>
	} | null
	/** database mode: the last save (ISO) and the saving account's email while it exists. */
	updatedAt: string | null
	updatedByEmail: string | null
}

export const getBrandingSettings = async (
	actor: SessionUser,
	builtInImage: BrandImageSource,
): Promise<BrandingSettingsView> => {
	assertAdmin(actor)
	const branding = await getBranding()
	const { mode, values } = env().branding
	const view: BrandingSettingsView = {
		mode,
		current: brandingView(branding, builtInImage),
		name: branding.name,
		showName: branding.showName,
		hasLogo: branding.logo !== null,
		faviconSrc: branding.favicon ? `${BRAND_FAVICON_PATH}?v=${version(branding.favicon)}` : null,
		env: null,
		updatedAt: null,
		updatedByEmail: null,
	}
	if (mode === 'env' && values) {
		const { errors } = await envImages(values)
		return { ...view, env: { logoFile: values.logoFile, faviconFile: values.faviconFile, errors } }
	}
	if (mode === 'database') {
		const row = await readInstanceSetting('branding')
		return {
			...view,
			updatedAt: row?.updatedAt.toISOString() ?? null,
			updatedByEmail: row?.updatedByEmail ?? null,
		}
	}
	return view
}

export type ImageChange =
	| { intent: 'keep' }
	| { intent: 'remove' }
	| { intent: 'replace'; file: File }

/** The Branding form after its schema (app/(admin)/settings/branding/schemas.ts). */
export interface BrandingInput {
	name: string
	showName: boolean
	images: Record<BrandImageKind, ImageChange>
}

/** Spec §2 #2: the page edits branding only in database mode. */
export const isBrandingEditable = (): boolean => env().branding.mode === 'database'

/**
 * Spec §5.4 steps 2 and 4–6: the mode, the images through processBrandImage, the name rule, then one write. The role is
 * checked here and again in the DAL (ADR-0024).
 */
export const saveBranding = async (
	actor: SessionUser,
	input: BrandingInput,
): Promise<ActionResult> => {
	assertAdmin(actor)
	if (!isBrandingEditable()) return fail('settings_not_editable')
	const row = await readInstanceSetting('branding')
	const saved = row ? brandingDataSchema.safeParse(row.data) : null
	const current = saved?.success ? saved.data : null
	const images: Record<BrandImageKind, StoredImage | null> = { logo: null, favicon: null }
	const files: InstanceSettingFileChanges = {}
	const fieldErrors: Record<string, string[]> = {}
	for (const kind of BRAND_IMAGE_KINDS) {
		const change = input.images[kind]
		if (change.intent === 'keep') {
			images[kind] = current?.[kind] ?? null
			continue
		}
		if (change.intent === 'remove') {
			files[kind] = null
			continue
		}
		try {
			if (change.file.size > BRAND_IMAGE_MAX_BYTES[kind]) throw new BrandImageError('too_large')
			const image = await processBrandImage(kind, Buffer.from(await change.file.arrayBuffer()))
			images[kind] = stored(image)
			files[kind] = { bytes: image.bytes, mime: 'image/png' }
		} catch (error) {
			if (!(error instanceof BrandImageError)) throw error
			fieldErrors[kind] = [error.code]
		}
	}
	if (Object.keys(fieldErrors).length) return fail('invalid_image', fieldErrors)
	if (!input.showName && !images.logo) return fail('invalid_input', { showName: ['logo_required'] })
	await writeInstanceSetting(
		actor,
		'branding',
		{ name: input.name, showName: input.showName, ...images },
		files,
	)
	return ok(undefined)
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `pnpm exec vitest run --project unit __tests__/settings-branding.test.ts` Expected: PASS.

- [ ] **Step 6: Gates and commit**

```bash
git add lib/settings/branding.ts lib/error-log.ts lib/action-result.ts __tests__/settings-branding.test.ts
git commit -m "feat(settings): resolve the brand for each mode"
```

---

### Task 6: The image routes

**Files:**

- Create: `lib/settings/image-response.ts`, `app/api/branding/logo/route.ts`, `app/api/branding/favicon/route.ts`
- Modify: `lib/access.ts`, `__tests__/access.test.ts`, `__tests__/api-routes.test.ts`
- Test: `__tests__/branding-routes.test.ts`

**Interfaces:**

- Consumes: `readBrandImage` (Task 5); `difyErrorResponse`, `errorResponseFrom` (`@/lib/dify/errors`).
- Produces: `brandImageResponse(request: Request, image: { bytes: Buffer; sha256: string } | null): Response`; `GET` handlers at `/api/branding/logo` and `/api/branding/favicon`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/branding-routes.test.ts
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readBrandImage } = vi.hoisted(() => ({ readBrandImage: vi.fn() }))
vi.mock('@/lib/settings/branding', () => ({ readBrandImage }))

import { GET as getFavicon } from '@/app/api/branding/favicon/route'
import { GET as getLogo } from '@/app/api/branding/logo/route'

const get = (path: string, headers: Record<string, string> = {}) =>
	new NextRequest(`http://app${path}`, { headers })
const image = { bytes: Buffer.from([1, 2, 3]), sha256: 'a'.repeat(64) }

beforeEach(() => readBrandImage.mockReset())

describe('GET /api/branding/logo (settings spec §4.5)', () => {
	it('answers the 404 envelope without a custom logo, with no session asked', async () => {
		readBrandImage.mockResolvedValue(null)
		const response = await getLogo(get('/api/branding/logo'))
		expect(response.status).toBe(404)
		await expect(response.json()).resolves.toMatchObject({ code: 'not_found', status: 404 })
		expect(response.headers.get('etag')).toBeNull()
	})

	it('serves the PNG publicly, revalidated on every use, with nosniff and the sandbox CSP, and 304 on a matching ETag', async () => {
		readBrandImage.mockResolvedValue(image)
		const response = await getLogo(get('/api/branding/logo?v=aaaaaaaaaaaaaaaa'))
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('image/png')
		expect(response.headers.get('cache-control')).toBe('public, no-cache')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
		expect(response.headers.get('content-security-policy')).toBe(
			"default-src 'none'; style-src 'unsafe-inline'; sandbox",
		)
		const etag = response.headers.get('etag')
		expect(etag).toBe(`"${'a'.repeat(32)}"`)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
		const cached = await getLogo(get('/api/branding/logo', { 'if-none-match': etag! }))
		expect(cached.status).toBe(304)
		expect(cached.headers.get('etag')).toBe(etag)
	})

	it('answers an unexpected failure with the 500 envelope', async () => {
		readBrandImage.mockRejectedValue(new Error('boom'))
		expect((await getLogo(get('/api/branding/logo'))).status).toBe(500)
	})
})

describe('GET /api/branding/favicon', () => {
	it('serves the favicon, else the logo', async () => {
		readBrandImage.mockImplementation(async (kind: string) => (kind === 'logo' ? image : null))
		const response = await getFavicon(get('/api/branding/favicon'))
		expect(response.status).toBe(200)
		expect(readBrandImage.mock.calls.map(([kind]) => kind)).toEqual(['favicon', 'logo'])
	})
})
```

In `__tests__/access.test.ts`, add `'/api/branding/logo'` and `'/api/branding/favicon'` to the public list, and `'/api/brandingx'` to the list that needs a session (find the `it.each` that holds `'/loginx'`).

In `__tests__/api-routes.test.ts`, extend the comment with "the settings spec adds the two public brand image routes" and the regex alternation with `|branding\/(logo|favicon)` after `directory\/groups`; rename the test to `'holds only the auth, health, Dify, icon, directory group search and brand image Route Handlers'`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/branding-routes.test.ts __tests__/access.test.ts __tests__/api-routes.test.ts` Expected: FAIL (the routes do not exist; `/api/branding/logo` is not public).

- [ ] **Step 3: Write the answer and the routes**

```ts
// lib/settings/image-response.ts
import { difyErrorResponse } from '@/lib/dify/errors'

/**
 * A brand image answer (settings spec §4.5), shaped like the app-icon route (app/api/apps/[appId]/icon/route.ts): public,
 * since the brand is, and revalidated on every use (RFC 9111 §5.2.2.4 no-cache), so a new logo shows at once and an
 * unchanged one costs a 304 through its ETag (RFC 9110 §13.1.2). The hub only serves PNGs it produced; nosniff and the
 * sandboxing CSP keep the answer inert if opened on its own.
 */
export const brandImageResponse = (
	request: Request,
	image: { bytes: Buffer; sha256: string } | null,
): Response => {
	if (!image) return difyErrorResponse('not_found', 'No custom image is set.', 404)
	const etag = `"${image.sha256.slice(0, 32)}"`
	const headers = {
		etag,
		'cache-control': 'public, no-cache',
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
	}
	if (request.headers.get('if-none-match') === etag)
		return new Response(null, { status: 304, headers })
	return new Response(new Uint8Array(image.bytes), {
		headers: {
			...headers,
			'content-type': 'image/png',
			'content-length': String(image.bytes.length),
		},
	})
}
```

```ts
// app/api/branding/logo/route.ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom } from '@/lib/dify/errors'
import { readBrandImage } from '@/lib/settings/branding'
import { brandImageResponse } from '@/lib/settings/image-response'

/** The custom logo (settings spec §4.5). Public: the login page shows it before anyone signs in (lib/access.ts). */
export async function GET(request: NextRequest) {
	try {
		return brandImageResponse(request, await readBrandImage('logo'))
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/branding/logo')
	}
}
```

```ts
// app/api/branding/favicon/route.ts
import type { NextRequest } from 'next/server'

import { errorResponseFrom } from '@/lib/dify/errors'
import { readBrandImage } from '@/lib/settings/branding'
import { brandImageResponse } from '@/lib/settings/image-response'

/** The custom tab icon, else the custom logo (settings spec §4.1, §4.5). Public, like the logo. */
export async function GET(request: NextRequest) {
	try {
		return brandImageResponse(
			request,
			(await readBrandImage('favicon')) ?? (await readBrandImage('logo')),
		)
	} catch (error) {
		return errorResponseFrom(error, 'GET /api/branding/favicon')
	}
}
```

In `lib/access.ts`, add `'/api/branding',` after `'/api/health',` in `PUBLIC_PREFIXES`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/branding-routes.test.ts __tests__/access.test.ts __tests__/api-routes.test.ts __tests__/proxy.test.ts` Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
git add lib/settings/image-response.ts app/api/branding lib/access.ts __tests__/branding-routes.test.ts __tests__/access.test.ts __tests__/api-routes.test.ts
git commit -m "feat(settings): serve the custom logo and favicon publicly"
```

---

### Task 7: The brand in the shell

**Files:**

- Create: `components/providers/branding-context.tsx`, `components/shell/brand-logo.tsx`, `e2e/branding.spec.ts`
- Modify: `components/providers/app-providers.tsx`, `app/layout.tsx`, `components/shell/app-header.tsx`, `components/shell/app-header.module.css`, `components/shell/auth-card.tsx`
- Delete: `app/favicon.ico`
- Test: `__tests__/brand-logo.test.ts`, `e2e/branding.spec.ts`

**Interfaces:**

- Consumes: `getBranding`, `brandingView` (Task 5); `BrandingView`, `BrandImageSource` (Task 2).
- Produces: `BrandingProvider({ value, children })`, `useBranding(): BrandingView`; `BrandLogo({ image, height, alt })` (default export) and `scaledWidth(image: BrandImageSource, height: number): number`; `AppProviders` prop `branding: BrandingView`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/brand-logo.test.ts
import { describe, expect, it } from 'vitest'

import { scaledWidth } from '@/components/shell/brand-logo'

describe('scaledWidth (settings spec §4.6: next/image needs both sizes)', () => {
	it('keeps the stored proportions at the display height, never below one pixel', () => {
		expect(scaledWidth({ src: '/x', width: 768, height: 192 }, 28)).toBe(112)
		expect(scaledWidth({ src: '/x', width: 81, height: 83 }, 64)).toBe(62)
		expect(scaledWidth({ src: '/x', width: 1, height: 192 }, 28)).toBe(1)
	})
})
```

```ts
// e2e/branding.spec.ts
import { expect, test } from '@playwright/test'

// Settings spec §4.6: with nothing saved the hub shows its built-in brand; the header has no GitHub button.
test.describe('the built-in brand', () => {
	test('the header and the tab show it, and the GitHub button is gone', async ({ page }) => {
		await page.goto('/apps')
		await expect(page).toHaveTitle('Dify App Hub')
		await expect(page.getByRole('banner').getByRole('link', { name: 'Dify App Hub' })).toBeVisible()
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			'href',
			/\/_next\/static\/media\/logo/,
		)
		await expect(page.getByRole('button', { name: 'GitHub' })).toHaveCount(0)
		await expect(page.getByRole('link', { name: 'GitHub' })).toHaveCount(0)
	})

	test('the login page shows the name under the logo', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		const page = await context.newPage()
		await page.goto('/login')
		await expect(page.getByRole('heading', { name: 'Dify App Hub' })).toBeVisible()
		await context.close()
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/brand-logo.test.ts` → FAIL (module missing). Run (stop `pnpm dev` first): `pnpm test:e2e e2e/branding.spec.ts --project desktop-light` → FAIL (the GitHub link is still there; the favicon is `/favicon.ico`).

- [ ] **Step 3: Write the context and the logo**

```tsx
// components/providers/branding-context.tsx
'use client'

import { createContext, useContext } from 'react'

import type { BrandingView } from '@/lib/settings/branding-rules'

const BrandingContext = createContext<BrandingView | null>(null)

/** The brand from the root layout (settings spec §4.6), as the session and the theme travel (ADR-0020). */
export function BrandingProvider({
	value,
	children,
}: {
	value: BrandingView
	children: React.ReactNode
}) {
	return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export const useBranding = (): BrandingView => {
	const value = useContext(BrandingContext)
	if (!value) throw new Error('useBranding is used outside BrandingProvider')
	return value
}
```

```tsx
// components/shell/brand-logo.tsx
'use client'

import Image from 'next/image'

import type { BrandImageSource } from '@/lib/settings/branding-rules'

/** The width that keeps the image's proportions at the display height (next/image needs both, image.md:105-113). */
export const scaledWidth = (image: BrandImageSource, height: number): number =>
	Math.max(1, Math.round((image.width * height) / image.height))

/**
 * The brand image (settings spec §4.6), drawn as the hub stored it: `unoptimized` (image.md:391-412), since a custom image
 * is already a small PNG the hub produced and the built-in one is tiny. The header and the login card place the name.
 */
export default function BrandLogo({
	image,
	height,
	alt,
}: {
	image: BrandImageSource
	height: number
	alt: string
}) {
	return (
		<Image
			src={image.src}
			width={scaledWidth(image, height)}
			height={height}
			alt={alt}
			loading="eager"
			unoptimized
		/>
	)
}
```

- [ ] **Step 4: Pass the brand down from the root layout**

In `components/providers/app-providers.tsx`: import `BrandingProvider` from `@/components/providers/branding-context` and `type BrandingView` from `@/lib/settings/branding-rules`; add the prop `branding: BrandingView` to `AppProviders` (its doc comment: "the brand from the root layout, settings spec §4.6"); wrap `children` inside `AntdProviders`:

```tsx
<AntdProviders>
	<BrandingProvider value={branding}>{children}</BrandingProvider>
</AntdProviders>
```

In `app/layout.tsx`: replace `export const metadata …` with `generateMetadata`, and read the brand with the session and cookies:

```tsx
import builtInLogo from '@/assets/images/logo.png'
import { brandingView, getBranding } from '@/lib/settings/branding'

/**
 * The tab title and icon follow the brand (settings spec §4.6). app/favicon.ico is gone: a file-based icon overrides
 * generateMetadata (generate-metadata.md:114). getBranding is one read per request (React cache).
 */
export async function generateMetadata(): Promise<Metadata> {
	const view = brandingView(await getBranding(), builtInLogo)
	return {
		title: view.name,
		description: 'A Dify web app that fits your business',
		icons: { icon: view.faviconSrc },
	}
}
```

In `RootLayout`, change the `Promise.all` to `const [session, cookieStore, branding] = await Promise.all([getCachedServerSession(), cookies(), getBranding()])` and pass `branding={brandingView(branding, builtInLogo)}` to `AppProviders`.

Delete the file-based icon: `git rm app/favicon.ico`.

- [ ] **Step 5: Draw the brand in the header and the login card; remove the GitHub button**

In `components/shell/app-header.tsx`:

- remove `GithubOutlined` from the icons import, the `LogoIcon` import, `GITHUB_URL`, and the GitHub `Button` inside `dropdowns`;
- import `BrandLogo from './brand-logo'` and `{ useBranding } from '@/components/providers/branding-context'`;
- in the component, `const branding = useBranding()`, and replace the home `Link`'s content:

```tsx
<Link
	href="/apps"
	className={styles.logo}
	aria-label={branding.name}
>
	{branding.logo && (
		<BrandLogo
			image={branding.logo}
			height={28}
			alt=""
		/>
	)}
	{branding.showName && (
		<Typography.Text
			strong
			// Below md the name gives way to the controls (.title), unless it is the only thing to show.
			className={branding.logo ? styles.title : styles.nameOnly}
		>
			{branding.name}
		</Typography.Text>
	)}
</Link>
```

Add a comment above the `Link`: `{/* W3C WAI Images Tutorial, Functional images: an image beside the link text is alt="" (Example 2); the link keeps its name through aria-label when the image is alone (Example 1). */}`.

In `components/shell/app-header.module.css`, after `.title`:

```css
/* A name-only brand (settings spec §4.2): kept at every width, cut with an ellipsis when narrow. */
.nameOnly {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
```

In `components/shell/auth-card.tsx`: remove the `LogoIcon` import, import `BrandLogo` and `useBranding`, update the doc comment ("the brand header … settings spec §4.6"), and replace the image and title:

```tsx
{
	branding.logo && (
		<BrandLogo
			image={branding.logo}
			height={64}
			// Alone, the image carries the name (W3C WAI Images Tutorial, informative images).
			alt={branding.showName ? '' : branding.name}
		/>
	)
}
{
	/* Typography margins out-specify a single module class, so reset through style. */
}
{
	branding.showName && (
		<Typography.Title
			level={3}
			style={{ margin: 0 }}
		>
			{branding.name}
		</Typography.Title>
	)
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/brand-logo.test.ts` → PASS. Run: `pnpm test` → PASS (if a test asserted the `metadata` export or the GitHub link, update it to the new behaviour). Run: `pnpm test:e2e e2e/branding.spec.ts e2e/auth.spec.ts e2e/shell.spec.ts` → PASS on all three projects.

- [ ] **Step 7: Gates and commit**

```bash
git add components/providers app/layout.tsx components/shell e2e/branding.spec.ts __tests__/brand-logo.test.ts
git commit -m "feat(shell): draw the configured brand and drop the GitHub button"
```

(`git rm` in Step 4 already staged the deleted favicon.)

---

### Task 8: The grouped admin navigation

**Files:**

- Create: `components/shell/admin-nav.tsx`, `e2e/admin-nav.spec.ts`
- Modify: `components/shell/admin-shell.tsx`, `components/shell/app-header.tsx`, `locales/{en,zh,ar}/translation.json`, `e2e/admin-groups.spec.ts`, `e2e/smoke.spec.ts`
- Test: `__tests__/admin-nav.test.ts`, `e2e/admin-nav.spec.ts`

**Interfaces:**

- Produces: `ADMIN_NAV` (groups with `key`, `icon`, `label`, `children[{ key, label }]`), `ADMIN_NAV_OPEN_KEYS: string[]`, `adminNavItems(t: (key: AdminNavLabel) => string): NonNullable<MenuProps['items']>`, `selectedAdminKey(pathname: string): string | undefined`; `AppHeader` prop `navOpenKeys?: string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/admin-nav.test.ts
import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_OPEN_KEYS, adminNavItems, selectedAdminKey } from '@/components/shell/admin-nav'

describe('the admin navigation (settings spec §5.1)', () => {
	it('has two groups with their pages as children, and the children carry no icons', () => {
		const items = adminNavItems(key => key)
		expect(items.map(item => item && 'key' in item && item.key)).toEqual(['management', 'settings'])
		const children = items.map(item => (item && 'children' in item ? (item.children ?? []) : []))
		expect(children.map(group => group.map(child => child && 'key' in child && child.key))).toEqual(
			[['/app-management', '/user-management', '/group-management'], ['/settings/branding']],
		)
		for (const group of children)
			for (const child of group) expect(child && 'icon' in child && child.icon).toBeFalsy()
	})

	it('opens both groups by default', () => {
		expect(ADMIN_NAV_OPEN_KEYS).toEqual(['management', 'settings'])
	})

	it('selects the page under the pathname, at a segment boundary', () => {
		expect(selectedAdminKey('/user-management')).toBe('/user-management')
		expect(selectedAdminKey('/settings/branding')).toBe('/settings/branding')
		expect(selectedAdminKey('/group-management/anything')).toBe('/group-management')
		expect(selectedAdminKey('/user-managementx')).toBeUndefined()
		expect(selectedAdminKey('/settings')).toBeUndefined()
	})
})
```

```ts
// e2e/admin-nav.spec.ts
import { expect, test } from '@playwright/test'

// Settings spec §5.1: two groups in the sidebar, open by default; in the collapsed sidebar a group opens on click.
test('the sidebar groups the pages under Management and Settings', async ({ page, isMobile }) => {
	test.skip(isMobile, 'below md the sidebar is replaced by the header drawer (next test)')
	await page.goto('/app-management')
	const sider = page.getByRole('complementary')
	for (const name of ['Management', 'Settings'])
		await expect(sider.getByRole('menuitem', { name })).toBeVisible()
	for (const name of ['Apps', 'Users', 'Groups', 'Branding'])
		await expect(sider.getByRole('link', { name, exact: true })).toBeVisible()
	await expect(sider.getByRole('link', { name: 'App management' })).toHaveCount(0)
})

test('the collapsed sidebar opens a group on click', async ({ page, isMobile }) => {
	test.skip(isMobile, 'the sidebar is not part of the mobile layout')
	await page.goto('/app-management')
	const sider = page.getByRole('complementary')
	await expect(async () => {
		await page.getByRole('button', { name: 'Collapse sidebar' }).click({ timeout: 1_000 })
		await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible({
			timeout: 1_000,
		})
	}).toPass()
	await sider.getByRole('menuitem', { name: 'Settings' }).click()
	await expect(page.getByRole('menu').getByRole('link', { name: 'Branding' })).toBeVisible()
})

test('the phone drawer shows the same tree', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'the drawer is the mobile navigation')
	await page.goto('/app-management')
	await expect(async () => {
		await page.getByRole('button', { name: 'Menu' }).click()
		await expect(page.getByRole('dialog').getByRole('link', { name: 'Branding' })).toBeVisible({
			timeout: 1_000,
		})
	}).toPass()
	for (const name of ['Apps', 'Users', 'Groups'])
		await expect(page.getByRole('dialog').getByRole('link', { name, exact: true })).toBeVisible()
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/admin-nav.test.ts` → FAIL (module missing). Run: `pnpm test:e2e e2e/admin-nav.spec.ts` → FAIL.

- [ ] **Step 3: Add the keys**

`locales/en/translation.json`, in `admin`: `"menu_management": "Management"`, `"menu_settings": "Settings"`, `"menu_item_apps": "Apps"`, `"menu_item_users": "Users"`, `"menu_item_groups": "Groups"`, `"menu_item_branding": "Branding"`. `locales/zh/translation.json`: `"管理"`, `"设置"`, `"应用"`, `"用户"`, `"群组"`, `"品牌"`. `locales/ar/translation.json`: `"الإدارة"`, `"الإعدادات"`, `"التطبيقات"`, `"المستخدمون"`, `"المجموعات"`, `"العلامة التجارية"`.

- [ ] **Step 4: Write the navigation**

```tsx
// components/shell/admin-nav.tsx
import { AppstoreOutlined, SettingOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import Link from 'next/link'

/**
 * The admin sidebar's two groups (settings spec §5.1), as antd Layout's "Sider" demo builds them: an inline Menu whose
 * items carry `children`. Groups carry the icons; children are pages, without icons. The page titles keep their own keys
 * (admin.menu_apps, …), so the children have shorter labels of their own.
 */
export const ADMIN_NAV = [
	{
		key: 'management',
		icon: <AppstoreOutlined />,
		label: 'admin.menu_management',
		children: [
			{ key: '/app-management', label: 'admin.menu_item_apps' },
			{ key: '/user-management', label: 'admin.menu_item_users' },
			{ key: '/group-management', label: 'admin.menu_item_groups' },
		],
	},
	{
		key: 'settings',
		icon: <SettingOutlined />,
		label: 'admin.menu_settings',
		children: [{ key: '/settings/branding', label: 'admin.menu_item_branding' }],
	},
] as const

type AdminNavGroup = (typeof ADMIN_NAV)[number]
export type AdminNavLabel = AdminNavGroup['label'] | AdminNavGroup['children'][number]['label']

/** Both groups start open (spec §5.1; antd Menu `defaultOpenKeys`). */
export const ADMIN_NAV_OPEN_KEYS: string[] = ADMIN_NAV.map(group => group.key)

export const adminNavItems = (t: (key: AdminNavLabel) => string): NonNullable<MenuProps['items']> =>
	ADMIN_NAV.map(group => ({
		key: group.key,
		icon: group.icon,
		label: t(group.label),
		children: group.children.map(item => ({
			key: item.key,
			label: <Link href={item.key}>{t(item.label)}</Link>,
		})),
	}))

/** The page under the pathname: the child whose path is the pathname or its prefix at a segment boundary. */
export const selectedAdminKey = (pathname: string): string | undefined =>
	ADMIN_NAV.flatMap(group => group.children).find(
		item => pathname === item.key || pathname.startsWith(`${item.key}/`),
	)?.key
```

In `components/shell/admin-shell.tsx`: remove `ADMIN_NAV` and its icon imports; import `{ ADMIN_NAV_OPEN_KEYS, adminNavItems, selectedAdminKey } from './admin-nav'`; build `const nav = adminNavItems(key => t(key))` and `const selected = selectedAdminKey(pathname)`; pass `navOpenKeys={ADMIN_NAV_OPEN_KEYS}` to `AppHeader`; give the sider `Menu` the two new props with their source:

```tsx
<Menu
	mode="inline"
	items={nav}
	selectedKeys={selected ? [selected] : []}
	defaultOpenKeys={ADMIN_NAV_OPEN_KEYS}
	// In the collapsed sider a group opens its pop-out on click, not hover (antd Menu
	// `triggerSubMenuAction`, default hover; ADR-0014's reasons: touch, accidental opening).
	triggerSubMenuAction="click"
	// The sider draws the edge line (antd Layout, demo "Header Sider 2").
	style={{ borderInlineEnd: 0 }}
/>
```

In `components/shell/app-header.tsx`: add to `AppHeaderProps` `/** The groups the drawer's Menu opens with (admin: both, settings spec §5.1). */ navOpenKeys?: string[]`, destructure it, and pass `defaultOpenKeys={navOpenKeys}` to the drawer's `Menu`.

- [ ] **Step 5: Update the specs that named the old labels**

`e2e/admin-groups.spec.ts` (`'the admin navigation reaches the groups page'`): mobile → `page.getByRole('dialog').getByRole('link', { name: 'Groups', exact: true })` for both the visibility check and the click; desktop → `page.getByRole('complementary').getByRole('link', { name: 'Groups', exact: true }).click()`. `e2e/smoke.spec.ts`: `nav.getByRole('link', { name: 'Users', exact: true })` and the step title "the sidebar navigation offers the users page".

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/admin-nav.test.ts __tests__/i18n-locales.test.ts` → PASS. Run: `pnpm test:e2e e2e/admin-nav.spec.ts e2e/admin-groups.spec.ts e2e/smoke.spec.ts e2e/page-headers.spec.ts` → PASS on all three projects (the Branding link leads to a 404 until Task 9; these specs do not follow it).

- [ ] **Step 7: Gates and commit**

```bash
git add components/shell/admin-nav.tsx components/shell/admin-shell.tsx components/shell/app-header.tsx locales e2e/admin-nav.spec.ts e2e/admin-groups.spec.ts e2e/smoke.spec.ts __tests__/admin-nav.test.ts
git commit -m "feat(admin): group the sidebar into Management and Settings"
```

---

### Task 9: The Branding page and its save action

**Files:**

- Create: `app/(admin)/settings/page.tsx`, `app/(admin)/settings/branding/page.tsx`, `app/(admin)/settings/branding/actions.ts`, `app/(admin)/settings/branding/schemas.ts`, `components/admin/settings/branding-settings.tsx`, `components/admin/settings/branding-errors.ts`
- Modify: `locales/{en,zh,ar}/translation.json`
- Test: `__tests__/branding-actions.test.ts`, `__tests__/branding-pages.test.ts`, `__tests__/branding-errors.test.ts`

**Interfaces:**

- Consumes: `getBrandingSettings`, `saveBranding`, `isBrandingEditable`, `BrandingSettingsView`, `BrandingInput`, `ImageChange` (Task 5); `BrandLogo` (Task 7); branding rules (Task 2).
- Produces: `brandingFormSchema` (FormData entries → `BrandingInput`), `saveBrandingAction(formData: FormData): Promise<ActionResult>`, `brandingErrorKey(code)`, `imageErrorKey(kind, code)`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/branding-actions.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, refresh, saveBranding, isBrandingEditable } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	refresh: vi.fn(),
	saveBranding: vi.fn(),
	isBrandingEditable: vi.fn(),
}))
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ refresh }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/settings/branding', () => ({ saveBranding, isBrandingEditable }))

import { saveBrandingAction } from '@/app/(admin)/settings/branding/actions'

const admin = { id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' }
const form = (entries: Record<string, string | File>) => {
	const data = new FormData()
	for (const [key, value] of Object.entries(entries)) data.set(key, value)
	return data
}
const valid = { name: ' Acme ', showName: 'true', logoIntent: 'keep', faviconIntent: 'keep' }

beforeEach(() => {
	for (const fn of [getServerSession, refresh, saveBranding, isBrandingEditable]) fn.mockReset()
	getServerSession.mockResolvedValue({ user: admin })
	isBrandingEditable.mockReturnValue(true)
	saveBranding.mockResolvedValue({ ok: true, data: undefined })
})

describe('saveBrandingAction (settings spec §5.4)', () => {
	it('refuses a user-role account before anything else', async () => {
		getServerSession.mockResolvedValue({ user: { ...admin, role: 'user' } })
		expect(await saveBrandingAction(form(valid))).toEqual({ ok: false, code: 'forbidden' })
		expect(saveBranding).not.toHaveBeenCalled()
	})

	it('refuses outside database mode before reading the form', async () => {
		isBrandingEditable.mockReturnValue(false)
		expect(await saveBrandingAction(form({}))).toEqual({ ok: false, code: 'settings_not_editable' })
	})

	it('answers invalid_input with the field for a bad name or a replace without its file', async () => {
		const blank = await saveBrandingAction(form({ ...valid, name: '  ' }))
		expect(blank).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { name: expect.any(Array) },
		})
		const noFile = await saveBrandingAction(form({ ...valid, logoIntent: 'replace' }))
		expect(noFile).toMatchObject({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { logo: expect.any(Array) },
		})
		expect(saveBranding).not.toHaveBeenCalled()
	})

	it('hands the parsed form to saveBranding and refreshes on success', async () => {
		const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' })
		expect(
			await saveBrandingAction(
				form({
					...valid,
					showName: 'false',
					logoIntent: 'replace',
					logo: file,
					faviconIntent: 'remove',
				}),
			),
		).toEqual({
			ok: true,
			data: undefined,
		})
		expect(saveBranding).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), {
			name: 'Acme',
			showName: false,
			images: {
				logo: { intent: 'replace', file: expect.any(File) },
				favicon: { intent: 'remove' },
			},
		})
		expect(refresh).toHaveBeenCalledOnce()
	})

	it('does not refresh after a refusal, and turns a throw into operation_failed', async () => {
		saveBranding.mockResolvedValueOnce({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { logo: ['not_allowed'] },
		})
		expect(await saveBrandingAction(form(valid))).toMatchObject({ code: 'invalid_image' })
		saveBranding.mockRejectedValueOnce(new Error('boom'))
		expect(await saveBrandingAction(form(valid))).toEqual({ ok: false, code: 'operation_failed' })
		expect(refresh).not.toHaveBeenCalled()
	})
})
```

```ts
// __tests__/branding-pages.test.ts
import { describe, expect, it, vi } from 'vitest'

const { requireAdminUser, getBrandingSettings, redirect } = vi.hoisted(() => ({
	requireAdminUser: vi.fn(),
	getBrandingSettings: vi.fn(),
	redirect: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({ requireAdminUser }))
vi.mock('@/lib/settings/branding', () => ({ getBrandingSettings }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/components/admin/settings/branding-settings', () => ({ default: () => null }))

import BrandingPage from '@/app/(admin)/settings/branding/page'
import SettingsPage from '@/app/(admin)/settings/page'

describe('the settings pages (settings spec §5.2, §5.3)', () => {
	it('/settings sends the admin to the first area', () => {
		SettingsPage()
		expect(redirect).toHaveBeenCalledWith('/settings/branding')
	})

	it('Branding checks the admin, then loads the settings for that actor', async () => {
		const actor = { id: 'a1', email: 'a@example.com', name: null, role: 'admin' }
		requireAdminUser.mockResolvedValue(actor)
		getBrandingSettings.mockResolvedValue({ mode: 'disabled' })
		const page = await BrandingPage()
		expect(getBrandingSettings).toHaveBeenCalledWith(actor, expect.anything())
		expect(page.props.settings).toEqual({ mode: 'disabled' })
	})
})
```

```ts
// __tests__/branding-errors.test.ts
import { describe, expect, it } from 'vitest'

import { brandingErrorKey, imageErrorKey } from '@/components/admin/settings/branding-errors'

describe('the Branding page messages (charter §4.5: codes, never a server message)', () => {
	it('maps each action code to a key', () => {
		expect(brandingErrorKey('unauthorized')).toBe('common.session_expired')
		expect(brandingErrorKey('forbidden')).toBe('common.forbidden')
		expect(brandingErrorKey('settings_not_editable')).toBe('admin_settings.not_editable')
		expect(brandingErrorKey('invalid_image')).toBe('admin_settings.invalid_image')
		expect(brandingErrorKey('invalid_input')).toBe('admin_settings.invalid_input')
		expect(brandingErrorKey('operation_failed')).toBe('common.operation_failed')
	})

	it('maps an image refusal to its field message', () => {
		expect(imageErrorKey('logo', 'too_large')).toBe('admin_settings.logo_too_large')
		expect(imageErrorKey('favicon', 'too_large')).toBe('admin_settings.favicon_too_large')
		expect(imageErrorKey('logo', 'not_allowed')).toBe('admin_settings.image_not_allowed')
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run --project unit __tests__/branding-actions.test.ts __tests__/branding-pages.test.ts __tests__/branding-errors.test.ts` Expected: FAIL (modules missing).

- [ ] **Step 3: Write the schema, the action and the pages**

```ts
// app/(admin)/settings/branding/schemas.ts
import * as z from 'zod'

import type { BrandingInput, ImageChange } from '@/lib/settings/branding'
import { brandNameSchema } from '@/lib/settings/branding-rules'

export const IMAGE_INTENTS = ['keep', 'replace', 'remove'] as const

const change = (intent: (typeof IMAGE_INTENTS)[number], file: File | undefined): ImageChange =>
	intent === 'replace' && file
		? { intent, file }
		: intent === 'remove'
			? { intent }
			: { intent: 'keep' }

/**
 * The Branding form as FormData sends it (settings spec §5.4 step 3; Server Actions accept FormData with files): the name,
 * the switch, and per image an intent with its file when replaced.
 */
export const brandingFormSchema = z
	.object({
		name: brandNameSchema,
		showName: z.enum(['true', 'false']).transform(value => value === 'true'),
		logoIntent: z.enum(IMAGE_INTENTS),
		faviconIntent: z.enum(IMAGE_INTENTS),
		logo: z.instanceof(File).optional(),
		favicon: z.instanceof(File).optional(),
	})
	.refine(value => value.logoIntent !== 'replace' || value.logo !== undefined, {
		path: ['logo'],
		message: 'file_required',
	})
	.refine(value => value.faviconIntent !== 'replace' || value.favicon !== undefined, {
		path: ['favicon'],
		message: 'file_required',
	})
	.transform(
		(value): BrandingInput => ({
			name: value.name,
			showName: value.showName,
			images: {
				logo: change(value.logoIntent, value.logo),
				favicon: change(value.faviconIntent, value.favicon),
			},
		}),
	)
```

```ts
// app/(admin)/settings/branding/actions.ts
'use server'

import { refresh } from 'next/cache'

import { invalidInput, toActionFailure } from '@/lib/action-failure'
import { fail, type ActionResult } from '@/lib/action-result'
import { requireAdmin } from '@/lib/auth/session'
import { isBrandingEditable, saveBranding } from '@/lib/settings/branding'

import { brandingFormSchema } from './schemas'

/*
 * Thin Server Action (ADR-0024; settings spec §5.4): verify the admin, the mode, the form, then saveBranding (the images,
 * the name rule, one write), and refresh the route (next/cache `refresh`, as the other admin actions; the root layout is
 * dynamic, so the new brand renders at once).
 */
export async function saveBrandingAction(formData: FormData): Promise<ActionResult> {
	try {
		const actor = await requireAdmin()
		if (!isBrandingEditable()) return fail('settings_not_editable')
		const parsed = brandingFormSchema.safeParse(Object.fromEntries(formData))
		if (!parsed.success) return invalidInput(parsed.error)
		const result = await saveBranding(actor, parsed.data)
		if (result.ok) refresh()
		return result
	} catch (error) {
		return toActionFailure(error, 'saveBrandingAction')
	}
}
```

```tsx
// app/(admin)/settings/page.tsx
import { redirect } from 'next/navigation'

/** /settings has no page of its own: the first area (settings spec §5.2). The (admin) layout has gated the visitor. */
export default function SettingsPage() {
	redirect('/settings/branding')
}
```

```tsx
// app/(admin)/settings/branding/page.tsx
import builtInLogo from '@/assets/images/logo.png'
import BrandingSettings from '@/components/admin/settings/branding-settings'
import { requireAdminUser } from '@/lib/auth/session'
import { getBrandingSettings } from '@/lib/settings/branding'

/** Settings > Branding (settings spec §5.3): the server checks the admin and loads the mode and values (ADR-0020). */
export default async function BrandingPage() {
	const actor = await requireAdminUser()
	return <BrandingSettings settings={await getBrandingSettings(actor, builtInLogo)} />
}
```

- [ ] **Step 4: Write the error keys**

```ts
// components/admin/settings/branding-errors.ts
import type { ActionErrorCode } from '@/lib/action-result'
import type { BrandImageKind } from '@/lib/settings/branding-rules'

/** The save action's failure code as the message the admin reads (charter §4.5: codes, never a server message). */
export const brandingErrorKey = (code: ActionErrorCode) => {
	switch (code) {
		case 'unauthorized':
			return 'common.session_expired' as const
		case 'forbidden':
			return 'common.forbidden' as const
		case 'settings_not_editable':
			return 'admin_settings.not_editable' as const
		case 'invalid_image':
			return 'admin_settings.invalid_image' as const
		case 'invalid_input':
			return 'admin_settings.invalid_input' as const
		default:
			return 'common.operation_failed' as const
	}
}

/** An image refusal (spec §4.4) as its field message. */
export const imageErrorKey = (kind: BrandImageKind, code: string) => {
	if (code !== 'too_large') return 'admin_settings.image_not_allowed' as const
	return kind === 'logo'
		? ('admin_settings.logo_too_large' as const)
		: ('admin_settings.favicon_too_large' as const)
}
```

- [ ] **Step 5: Add the page's keys**

Add an `admin_settings` object to each locale file (after `admin_groups`).

`locales/en/translation.json`:

```json
"admin_settings": {
	"branding_title": "Branding",
	"branding_subtitle": "The hub's name, logo and browser-tab icon",
	"mode_disabled": "Branding is off. The hub uses its built-in name and logo. Set BRANDING_MODE to env or database to change it.",
	"mode_env": "Branding is set by environment variables and can't be changed here.",
	"mode_database": "Branding is stored in the database. Changes apply to every page once you save.",
	"name": "Name",
	"show_name": "Show the name beside the logo",
	"show_name_locked": "The name always shows while there is no logo.",
	"logo": "Logo",
	"logo_hint": "PNG, JPEG, WebP or SVG, up to 512 KB. Saved as a PNG of at most 768 × 192 pixels.",
	"favicon": "Browser-tab icon",
	"favicon_hint": "PNG, JPEG, WebP or SVG, up to 256 KB. Saved as a 64 × 64 PNG. Without one, the logo is used.",
	"choose_logo": "Choose logo",
	"choose_favicon": "Choose icon",
	"remove": "Remove",
	"preview": "Preview",
	"save": "Save",
	"save_success": "Branding saved",
	"last_changed": "Last changed by {{email}}",
	"last_changed_unknown": "Last changed by an account that no longer exists",
	"never_saved": "Not saved yet: the hub shows its built-in name and logo.",
	"not_editable": "Branding can be changed here only while BRANDING_MODE is database.",
	"invalid_input": "Check the highlighted fields and try again.",
	"invalid_image": "An image could not be used. Check the highlighted fields.",
	"image_not_allowed": "Use a PNG, JPEG, WebP or SVG image that opens correctly.",
	"logo_too_large": "The logo is larger than 512 KB.",
	"favicon_too_large": "The icon is larger than 256 KB.",
	"logo_required": "Turn the name on or add a logo, so the header is not empty.",
	"variable": "Variable",
	"value": "Value",
	"not_set": "Not set",
	"yes": "Yes",
	"no": "No",
	"file_error": "Could not be used ({{code}})"
}
```

`locales/zh/translation.json` (same keys, same placeholders):

```json
"admin_settings": {
	"branding_title": "品牌",
	"branding_subtitle": "平台的名称、标志和浏览器标签图标",
	"mode_disabled": "品牌设置已关闭，平台使用内置的名称和标志。将 BRANDING_MODE 设为 env 或 database 即可更改。",
	"mode_env": "品牌由环境变量设置，无法在此更改。",
	"mode_database": "品牌保存在数据库中，保存后对所有页面生效。",
	"name": "名称",
	"show_name": "在标志旁显示名称",
	"show_name_locked": "没有标志时始终显示名称。",
	"logo": "标志",
	"logo_hint": "PNG、JPEG、WebP 或 SVG，最大 512 KB。保存为不超过 768 × 192 像素的 PNG。",
	"favicon": "浏览器标签图标",
	"favicon_hint": "PNG、JPEG、WebP 或 SVG，最大 256 KB。保存为 64 × 64 的 PNG。未设置时使用标志。",
	"choose_logo": "选择标志",
	"choose_favicon": "选择图标",
	"remove": "移除",
	"preview": "预览",
	"save": "保存",
	"save_success": "品牌已保存",
	"last_changed": "最后由 {{email}} 修改",
	"last_changed_unknown": "最后由已不存在的账户修改",
	"never_saved": "尚未保存：平台显示内置的名称和标志。",
	"not_editable": "仅当 BRANDING_MODE 为 database 时才能在此更改品牌。",
	"invalid_input": "请检查标出的字段后重试。",
	"invalid_image": "有图片无法使用，请检查标出的字段。",
	"image_not_allowed": "请使用能正常打开的 PNG、JPEG、WebP 或 SVG 图片。",
	"logo_too_large": "标志超过 512 KB。",
	"favicon_too_large": "图标超过 256 KB。",
	"logo_required": "请开启名称或添加标志，以免页眉为空。",
	"variable": "变量",
	"value": "值",
	"not_set": "未设置",
	"yes": "是",
	"no": "否",
	"file_error": "无法使用（{{code}}）"
}
```

`locales/ar/translation.json` (Modern Standard Arabic, ADR-0005; numbers keep Western digits, ADR-0027 deviation 7):

```json
"admin_settings": {
	"branding_title": "العلامة التجارية",
	"branding_subtitle": "اسم المنصة وشعارها وأيقونة علامة التبويب في المتصفح",
	"mode_disabled": "العلامة التجارية معطّلة، وتستخدم المنصة اسمها وشعارها المدمجين. اضبط BRANDING_MODE على env أو database لتغييرها.",
	"mode_env": "تُضبط العلامة التجارية عبر متغيرات البيئة، ولا يمكن تغييرها هنا.",
	"mode_database": "تُحفظ العلامة التجارية في قاعدة البيانات، وتسري التغييرات على كل الصفحات بعد الحفظ.",
	"name": "الاسم",
	"show_name": "إظهار الاسم بجانب الشعار",
	"show_name_locked": "يظهر الاسم دائمًا ما دام لا يوجد شعار.",
	"logo": "الشعار",
	"logo_hint": "PNG أو JPEG أو WebP أو SVG، بحد أقصى 512 KB. يُحفظ بصيغة PNG لا تتجاوز 768 × 192 بكسل.",
	"favicon": "أيقونة علامة التبويب",
	"favicon_hint": "PNG أو JPEG أو WebP أو SVG، بحد أقصى 256 KB. تُحفظ بصيغة PNG بحجم 64 × 64، وإن لم تُضَف يُستخدم الشعار.",
	"choose_logo": "اختيار شعار",
	"choose_favicon": "اختيار أيقونة",
	"remove": "إزالة",
	"preview": "معاينة",
	"save": "حفظ",
	"save_success": "تم حفظ العلامة التجارية",
	"last_changed": "آخر تعديل بواسطة {{email}}",
	"last_changed_unknown": "آخر تعديل بواسطة حساب لم يعد موجودًا",
	"never_saved": "لم تُحفظ بعد: تعرض المنصة اسمها وشعارها المدمجين.",
	"not_editable": "لا يمكن تغيير العلامة التجارية هنا إلا عندما تكون قيمة BRANDING_MODE هي database.",
	"invalid_input": "تحقّق من الحقول المميزة وحاول مرة أخرى.",
	"invalid_image": "تعذّر استخدام إحدى الصور. تحقّق من الحقول المميزة.",
	"image_not_allowed": "استخدم صورة PNG أو JPEG أو WebP أو SVG تُفتح بشكل سليم.",
	"logo_too_large": "حجم الشعار أكبر من 512 KB.",
	"favicon_too_large": "حجم الأيقونة أكبر من 256 KB.",
	"logo_required": "فعّل إظهار الاسم أو أضف شعارًا حتى لا تكون الترويسة فارغة.",
	"variable": "المتغير",
	"value": "القيمة",
	"not_set": "غير مضبوط",
	"yes": "نعم",
	"no": "لا",
	"file_error": "تعذّر الاستخدام ({{code}})"
}
```

- [ ] **Step 6: Write the page's client component**

```tsx
// components/admin/settings/branding-settings.tsx
'use client'

import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import {
	Alert,
	App,
	Button,
	Card,
	Descriptions,
	Flex,
	Form,
	Image,
	Input,
	Switch,
	Typography,
	Upload,
	theme,
} from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { saveBrandingAction } from '@/app/(admin)/settings/branding/actions'
import ClientDateTime from '@/components/admin/client-date-time'
import BrandLogo from '@/components/shell/brand-logo'
import PageHeader from '@/components/shell/page-header'
import { useActionTransition } from '@/hooks/use-action-transition'
import type { BrandingSettingsView } from '@/lib/settings/branding'
import {
	BRAND_IMAGE_MAX_BYTES,
	BRAND_IMAGE_MIME_TYPES,
	BRAND_NAME_MAX,
	effectiveShowName,
	type BrandImageKind,
} from '@/lib/settings/branding-rules'

import { brandingErrorKey, imageErrorKey } from './branding-errors'

/** An image's pending change; `url` is the unsaved file's object URL for the preview (File API, URL.createObjectURL). */
type ImageDraft =
	| { intent: 'keep' }
	| { intent: 'remove' }
	| { intent: 'replace'; file: File; url: string }

const KEEP: ImageDraft = { intent: 'keep' }

/** The draft's preview URL: the new file, the saved image, or none. */
const previewOf = (draft: ImageDraft, savedSrc: string | null) =>
	draft.intent === 'replace' ? draft.url : draft.intent === 'keep' ? savedSrc : null

/** Revokes a replaced draft's object URL when it changes or the page unmounts (MDN URL.revokeObjectURL). */
const useRevokeOnChange = (draft: ImageDraft) =>
	useEffect(
		() => () => {
			if (draft.intent === 'replace') URL.revokeObjectURL(draft.url)
		},
		[draft],
	)

function ImageField({
	kind,
	savedSrc,
	draft,
	onChange,
	error,
}: {
	kind: BrandImageKind
	savedSrc: string | null
	draft: ImageDraft
	onChange: (draft: ImageDraft) => void
	error?: string
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const src = previewOf(draft, savedSrc)
	return (
		<Form.Item
			label={t(kind === 'logo' ? 'admin_settings.logo' : 'admin_settings.favicon')}
			extra={t(kind === 'logo' ? 'admin_settings.logo_hint' : 'admin_settings.favicon_hint')}
			validateStatus={error ? 'error' : undefined}
			help={error}
		>
			<Flex
				wrap
				align="center"
				gap="small"
			>
				{src && (
					// An unsaved image has no known size, which next/image needs (plan decision e).
					<Image
						src={src}
						height={kind === 'logo' ? 48 : 32}
						preview={false}
						alt=""
					/>
				)}
				<Upload
					accept={BRAND_IMAGE_MIME_TYPES.join(',')}
					showUploadList={false}
					// antd demos "Upload manually" and "Upload png file only": keep the file in the browser (return false)
					// or drop it from the list (Upload.LIST_IGNORE). A convenience only; the server decides (OWASP).
					beforeUpload={file => {
						if (!(BRAND_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
							message.error(t('admin_settings.image_not_allowed'))
							return Upload.LIST_IGNORE
						}
						if (file.size > BRAND_IMAGE_MAX_BYTES[kind]) {
							message.error(t(imageErrorKey(kind, 'too_large')))
							return Upload.LIST_IGNORE
						}
						onChange({ intent: 'replace', file, url: URL.createObjectURL(file) })
						return false
					}}
				>
					<Button icon={<UploadOutlined />}>
						{t(kind === 'logo' ? 'admin_settings.choose_logo' : 'admin_settings.choose_favicon')}
					</Button>
				</Upload>
				{src && (
					<Button
						icon={<DeleteOutlined />}
						onClick={() => onChange({ intent: 'remove' })}
					>
						{t('admin_settings.remove')}
					</Button>
				)}
			</Flex>
		</Form.Item>
	)
}

/** Settings > Branding (settings spec §5.3): the mode first, then the form, the read-only values or the built-in preview. */
export default function BrandingSettings({ settings }: { settings: BrandingSettingsView }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const [form] = Form.useForm<{ name: string; showName: boolean }>()
	const [logo, setLogo] = useState<ImageDraft>(KEEP)
	const [favicon, setFavicon] = useState<ImageDraft>(KEEP)
	const [errors, setErrors] = useState<Record<string, string[]>>({})
	useRevokeOnChange(logo)
	useRevokeOnChange(favicon)
	const { pending, run } = useActionTransition()

	const savedLogoSrc = settings.hasLogo ? (settings.current.logo?.src ?? null) : null
	const hasLogo = logo.intent === 'replace' || (logo.intent === 'keep' && settings.hasLogo)
	const name = Form.useWatch('name', form) ?? settings.name
	const showName = effectiveShowName(Form.useWatch('showName', form) ?? settings.showName, hasLogo)
	const previewSrc = previewOf(logo, savedLogoSrc)

	// Spec §4.2: the switch cannot hide the name while no logo is left.
	useEffect(() => {
		if (!hasLogo) form.setFieldValue('showName', true)
	}, [hasLogo, form])

	const submit = (values: { name: string; showName: boolean }) =>
		run(async () => {
			const data = new FormData()
			data.set('name', values.name)
			data.set('showName', String(values.showName))
			for (const [kind, draft] of [
				['logo', logo],
				['favicon', favicon],
			] as const) {
				data.set(`${kind}Intent`, draft.intent)
				if (draft.intent === 'replace') data.set(kind, draft.file)
			}
			const result = await saveBrandingAction(data)
			if (result.ok) {
				setLogo(KEEP)
				setFavicon(KEEP)
				setErrors({})
				message.success(t('admin_settings.save_success'))
				return
			}
			setErrors(result.fieldErrors ?? {})
			message.error(t(brandingErrorKey(result.code)))
		})

	const imageError = (kind: BrandImageKind) => {
		const code = errors[kind]?.[0]
		return code ? t(imageErrorKey(kind, code)) : undefined
	}

	const preview = (
		<Card
			size="small"
			title={t('admin_settings.preview')}
		>
			<Flex
				align="center"
				gap={token.marginSM}
			>
				{settings.mode === 'database' && previewSrc ? (
					<Image
						src={previewSrc}
						height={28}
						preview={false}
						alt=""
					/>
				) : (
					settings.current.logo && (
						<BrandLogo
							image={settings.current.logo}
							height={28}
							alt=""
						/>
					)
				)}
				{(settings.mode === 'database' ? showName : settings.current.showName) && (
					<Typography.Text strong>
						{settings.mode === 'database' ? name : settings.current.name}
					</Typography.Text>
				)}
			</Flex>
		</Card>
	)

	return (
		<Flex
			vertical
			gap={token.marginLG}
		>
			<PageHeader
				title={t('admin_settings.branding_title')}
				subtitle={t('admin_settings.branding_subtitle')}
			/>
			<Alert
				type="info"
				showIcon
				title={t(
					settings.mode === 'disabled'
						? 'admin_settings.mode_disabled'
						: settings.mode === 'env'
							? 'admin_settings.mode_env'
							: 'admin_settings.mode_database',
				)}
			/>
			{preview}
			{settings.mode === 'env' && settings.env && (
				<Descriptions
					bordered
					column={1}
					items={[
						{
							key: 'name',
							label: <Typography.Text code>BRANDING_NAME</Typography.Text>,
							children: settings.name,
						},
						{
							key: 'show',
							label: <Typography.Text code>BRANDING_SHOW_NAME</Typography.Text>,
							children: t(settings.showName ? 'admin_settings.yes' : 'admin_settings.no'),
						},
						...(['logo', 'favicon'] as const).map(kind => {
							const file = kind === 'logo' ? settings.env!.logoFile : settings.env!.faviconFile
							const error = settings.env!.errors[kind]
							return {
								key: kind,
								label: (
									<Typography.Text code>
										{kind === 'logo' ? 'BRANDING_LOGO_FILE' : 'BRANDING_FAVICON_FILE'}
									</Typography.Text>
								),
								children: (
									<Flex
										vertical
										gap="small"
									>
										<span>{file ?? t('admin_settings.not_set')}</span>
										{error && (
											<Typography.Text type="danger">
												{t('admin_settings.file_error', { code: error })}
											</Typography.Text>
										)}
										{kind === 'favicon' && settings.faviconSrc && (
											<Image
												src={settings.faviconSrc}
												height={32}
												preview={false}
												alt=""
											/>
										)}
									</Flex>
								),
							}
						}),
					]}
				/>
			)}
			{settings.mode === 'database' && (
				<Card>
					<Form
						form={form}
						layout="vertical"
						initialValues={{ name: settings.name, showName: settings.showName }}
						onFinish={submit}
					>
						<Form.Item
							name="name"
							label={t('admin_settings.name')}
							rules={[{ required: true, whitespace: true, max: BRAND_NAME_MAX }]}
						>
							<Input
								showCount
								maxLength={BRAND_NAME_MAX}
							/>
						</Form.Item>
						<Form.Item
							name="showName"
							label={t('admin_settings.show_name')}
							valuePropName="checked"
							extra={hasLogo ? undefined : t('admin_settings.show_name_locked')}
							validateStatus={errors.showName ? 'error' : undefined}
							help={errors.showName ? t('admin_settings.logo_required') : undefined}
						>
							<Switch disabled={!hasLogo} />
						</Form.Item>
						<ImageField
							kind="logo"
							savedSrc={savedLogoSrc}
							draft={logo}
							onChange={setLogo}
							error={imageError('logo')}
						/>
						<ImageField
							kind="favicon"
							savedSrc={settings.faviconSrc}
							draft={favicon}
							onChange={setFavicon}
							error={imageError('favicon')}
						/>
						<Flex
							wrap
							align="center"
							justify="space-between"
							gap="small"
						>
							<Typography.Text type="secondary">
								{settings.updatedAt ? (
									<>
										{settings.updatedByEmail
											? t('admin_settings.last_changed', { email: settings.updatedByEmail })
											: t('admin_settings.last_changed_unknown')}{' '}
										<ClientDateTime value={settings.updatedAt} />
									</>
								) : (
									t('admin_settings.never_saved')
								)}
							</Typography.Text>
							<Button
								type="primary"
								htmlType="submit"
								loading={pending}
							>
								{t('admin_settings.save')}
							</Button>
						</Flex>
					</Form>
				</Card>
			)}
		</Flex>
	)
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm exec vitest run --project unit __tests__/branding-actions.test.ts __tests__/branding-pages.test.ts __tests__/branding-errors.test.ts __tests__/i18n-locales.test.ts` Expected: PASS. Then `pnpm exec next typegen && pnpm exec tsc --noEmit` (the typed i18n keys catch a misspelt key) and `pnpm test`.

- [ ] **Step 8: Gates and commit**

```bash
git add "app/(admin)/settings" components/admin/settings locales __tests__/branding-actions.test.ts __tests__/branding-pages.test.ts __tests__/branding-errors.test.ts
git commit -m "feat(settings): add the Branding page and its save action"
```

---

### Task 10: e2e coverage of the Branding page

**Files:**

- Create: `e2e/fixtures/branding.ts`
- Modify: `.env.e2e`, `e2e/branding.spec.ts`

**Interfaces:**

- Consumes: the e2e fixtures `withDb`, `seedUser`, `deleteUsersLike`, `signInAs`.
- Produces: `resetBranding(): Promise<unknown>`, `pngOf(width, height, color?): Promise<Buffer>`.

- [ ] **Step 1: Put the e2e server in database mode**

Add to `.env.e2e`: `BRANDING_MODE=database`. With no row saved, the brand stays built-in, so `e2e/auth.spec.ts` (heading "Dify App Hub") and Task 7's specs still pass.

- [ ] **Step 2: Write the fixture**

```ts
// e2e/fixtures/branding.ts
import sharp from 'sharp'

import { withDb } from './db'

/**
 * Back to the built-in brand: the branding row and, through ON DELETE CASCADE, its files. The brand is global state and
 * the suite runs serially (workers: 1), so each branding test ends here (settings spec §8).
 */
export const resetBranding = () =>
	withDb(db => db.execute("DELETE FROM instance_settings WHERE area = 'branding'"))

/** A PNG made on the spot, so the repository holds no binary fixture. */
export const pngOf = (width: number, height: number, color = '#1677ff') =>
	sharp({ create: { width, height, channels: 4, background: color } })
		.png()
		.toBuffer()
```

- [ ] **Step 3: Write the failing specs**

Append to `e2e/branding.spec.ts` (add the imports at the top: `pngOf`, `resetBranding` from `./fixtures/branding`; `deleteUsersLike`, `seedUser`, `signInAs` from `./fixtures/users`; `type Page` from `@playwright/test`):

```ts
const nameOf = () => `Acme ${test.info().project.name}`

/** Chooses a file through the Upload button; retried until hydration has wired the button (Playwright "File chooser"). */
const chooseFile = async (
	page: Page,
	button: string,
	file: { name: string; mimeType: string; buffer: Buffer },
) => {
	await expect(async () => {
		const chooser = page.waitForEvent('filechooser', { timeout: 2_000 })
		await page.getByRole('button', { name: button }).click()
		await (await chooser).setFiles(file)
	}).toPass()
}

test.describe('the Branding page (settings spec §5.3)', () => {
	test.afterEach(async () => {
		await resetBranding()
	})

	test('an admin reaches it from the navigation', async ({ page, isMobile }) => {
		await page.goto('/app-management')
		if (isMobile) {
			await expect(async () => {
				await page.getByRole('button', { name: 'Menu' }).click()
				await expect(page.getByRole('dialog').getByRole('link', { name: 'Branding' })).toBeVisible({
					timeout: 1_000,
				})
			}).toPass()
			await page.getByRole('dialog').getByRole('link', { name: 'Branding' }).click()
		} else {
			await page.getByRole('complementary').getByRole('link', { name: 'Branding' }).click()
		}
		await expect(page).toHaveURL(/\/settings\/branding$/)
		await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible()
		await expect(page.getByText('Branding is stored in the database.')).toBeVisible()
		await page.goto('/settings')
		await expect(page).toHaveURL(/\/settings\/branding$/)
	})

	test('a saved name and logo reach the header, the tab and the login page', async ({
		page,
		browser,
	}) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose logo', {
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: await pngOf(400, 100),
		})
		await page.getByLabel('Name', { exact: true }).fill(nameOf())
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()

		const home = page.getByRole('banner').getByRole('link', { name: nameOf() })
		await expect(home).toBeVisible()
		await expect(home.locator('img')).toHaveAttribute(
			'src',
			/\/api\/branding\/logo\?v=[0-9a-f]{16}/,
		)
		await expect(page).toHaveTitle(nameOf())
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			'href',
			/\/api\/branding\/favicon\?v=[0-9a-f]{16}/,
		)

		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		const login = await context.newPage()
		await login.goto('/login')
		await expect(login.getByRole('heading', { name: nameOf() })).toBeVisible()
		const image = await login.request.get('/api/branding/logo')
		expect(image.status()).toBe(200)
		expect(image.headers()['content-type']).toBe('image/png')
		await context.close()
	})

	test('with the name hidden, the header shows the logo alone and keeps the name for assistive technology', async ({
		page,
	}) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose logo', {
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: await pngOf(400, 100),
		})
		await page.getByLabel('Name', { exact: true }).fill(nameOf())
		await page.getByRole('switch', { name: 'Show the name beside the logo' }).click()
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()
		const home = page.getByRole('banner').getByRole('link', { name: nameOf() })
		await expect(home.locator('img')).toBeVisible()
		await expect(home.getByText(nameOf())).toHaveCount(0)
	})

	test('removing the logo leaves the name, and the tab falls back to the built-in icon', async ({
		page,
	}) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose logo', {
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: await pngOf(400, 100),
		})
		await page.getByLabel('Name', { exact: true }).fill(nameOf())
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()
		await page.getByRole('button', { name: 'Remove' }).click()
		await expect(page.getByRole('switch', { name: 'Show the name beside the logo' })).toBeDisabled()
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(
			page.getByRole('banner').getByRole('link', { name: nameOf() }).locator('img'),
		).toHaveCount(0)
		await expect(page.getByRole('banner').getByText(nameOf())).toBeVisible()
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			'href',
			/\/_next\/static\/media\/logo/,
		)
	})

	test('the browser refuses a file type the hub does not take', async ({ page }) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose icon', {
			name: 'icon.gif',
			mimeType: 'image/gif',
			buffer: Buffer.from('GIF89a'),
		})
		await expect(
			page.getByText('Use a PNG, JPEG, WebP or SVG image that opens correctly.'),
		).toBeVisible()
	})
})

test.describe('a user-role account', () => {
	test.use({ storageState: { cookies: [], origins: [] } })
	const emailOf = () => `branding-${test.info().project.name}@e2e.local`

	test.afterEach(async () => {
		await deleteUsersLike(`branding-${test.info().project.name}%`)
	})

	test('is sent away from the settings pages', async ({ page }) => {
		await seedUser({ email: emailOf(), password: 'user-pass-1' })
		await signInAs(page, emailOf(), 'user-pass-1')
		for (const path of ['/settings', '/settings/branding']) {
			await page.goto(path)
			await expect(page).toHaveURL(/\/apps$/)
		}
	})
})
```

- [ ] **Step 4: Run them**

Run: `pnpm test:e2e e2e/branding.spec.ts` Expected: PASS on all three projects. A failure here is a product defect from Tasks 5–9 (fix it there, test-first), not a reason to loosen the spec.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test:e2e` Expected: the B3b baseline (554 passed, 20 skipped, 0 failed) plus the new specs, 0 failed.

- [ ] **Step 6: Gates and commit**

```bash
git add .env.e2e e2e/fixtures/branding.ts e2e/branding.spec.ts
git commit -m "test(e2e): cover the Branding page in database mode"
```

---

### Task 11: Records and operator docs

**Files:**

- Create: `docs/decisions/0030-set-each-settings-area-from-the-environment-or-the-admin-page.md`, `docs/settings.md`
- Modify: `docs/decisions/0028-navigate-the-admin-area-in-a-sidebar-shared-with-the-chat.md`, `docs/decisions/README.md`, `CLAUDE.md`, and `.cii-assessment.md` only if a criterion changed

- [ ] **Step 1: Write ADR-0030** with the project's ADR skill (`.claude/skills/adr-skill`), in the MADR shape of ADR-0028 (front matter `status: proposed`, `date: 2026-10-11`, `decision-makers: LovingCivilian (fork owner)`, `consulted: Claude Code session`). It must state:
  - **Context:** settings lived only in `lib/env.ts`; the owner asked for two ways to set them, by environment variables or on an admin page, per area, before building branding (owner, 2026-10-11).
  - **Drivers:** the deployment must always know which value wins; documented approaches (ADR-0002); several hub containers; OWASP File Upload and Cryptographic Storage.
  - **Options:** one JSON document per area (chosen); a typed table per area; key/value rows; with the evidence from `docs/superpowers/research/2026-10-11-settings/reference-projects.md` (Documenso, Grafana, n8n, Mattermost; GitLab, Cal.com, Payload; Twenty, Gitea, Discourse, Open WebUI, Plane, Keycloak). For env versus UI: env locks the area (n8n `*_MANAGED_BY_ENV`, Mattermost's banner) over database-wins (Grafana, Twenty) and env-seeds-once (Open WebUI, Plane).
  - **Outcome:** `<AREA>_MODE` = `disabled` | `env` | `database`; `instance_settings` and `instance_setting_files`; images decoded and re-encoded to PNG by sharp, a new direct dependency pinned exactly at Next's version (`sharp@0.35.4`); the secret rules for SMTP and LDAP (AES-256-GCM, write-only fields).
  - **The recorded deviation:** `SETTINGS_ENCRYPTION_KEY` stays an environment variable (owner, 2026-10-11: "keep encryption key in env"), against OWASP's "Avoid storing keys in environment variables" and its advice to keep keys in the filesystem; Docker documents secrets as files under `/run/secrets/`.
  - **Consequences, Implementation Plan, Verification:** point to the spec and this plan; verification is the unit and e2e suites and the Docker gate.
- [ ] **Step 2: Add a dated note to ADR-0028** at the end of "More Information": `Note, 2026-10-11 (owner, settings and branding): the sidebar's flat list became two groups, Management (Apps, Users, Groups) and Settings (Branding), as antd Layout's "Sider" demo groups its items; children carry no icons, both groups open by default, and in the collapsed sider a group opens on click (antd Menu triggerSubMenuAction="click", ADR-0014's reasons). The pages keep their URLs. ADR-0030, docs/superpowers/specs/2026-10-11-settings-and-branding-design.md §5.1.`
- [ ] **Step 3: Add the ADR-0030 row** to `docs/decisions/README.md` (`| [0030](0030-…md) | Set each settings area from the environment or the admin page | proposed | 2026-10-11 |`).
- [ ] **Step 4: Write `docs/settings.md`** for operators:

````markdown
# Settings

Each settings area is set in one of two ways, chosen by one environment variable per area (ADR-0030):

| Mode | Where the values come from | What Settings shows |
| --- | --- | --- |
| `disabled` (also when unset) | Nowhere: the area is off. For branding, the built-in name and logo. | A notice and, for branding, the built-in preview. |
| `env` | Environment variables (and mounted files). | The values, read-only, each beside its variable, with any file that could not be used. |
| `database` | The admin page (Settings in the admin sidebar), stored in the database. The area's environment variables are ignored. | A form. The owner and admins can edit it. |

Changing a mode, or any value in `env` mode, takes a restart of the hub container. A value saved in `database` mode applies on the next page load in every hub container. A row saved in `database` mode is kept when you switch to another mode, and comes back when you switch back.

## Branding

`BRANDING_MODE=disabled|env|database`.

In `env` mode:

| Variable | Meaning |
| --- | --- |
| `BRANDING_NAME` | Required. 1–64 characters: the header, the login card, the browser tab. |
| `BRANDING_SHOW_NAME` | `true` (default) or `false`: the name beside the logo. `false` needs a logo file (a wordmark). |
| `BRANDING_LOGO_FILE` | Optional. Path inside the container to a PNG, JPEG, WebP or SVG of up to 512 KB. |
| `BRANDING_FAVICON_FILE` | Optional. The browser-tab icon, up to 256 KB. Without it, the logo is used. |

Mount the files read-only, for example in `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      BRANDING_MODE: env
      BRANDING_NAME: Acme AI Hub
      BRANDING_LOGO_FILE: /branding/logo.svg
    volumes:
      - ./branding:/branding:ro
```

Every image, uploaded or mounted, is decoded and saved again as a PNG (a logo at most 768 × 192 pixels, an icon 64 × 64), so the hub never serves the original file. A file that cannot be read or is not an accepted image is logged at startup by its variable (`BRANDING_LOGO_FILE could not be used: { code: 'ENOENT' }`) and shown on the Branding page; the hub runs without it.

The images are served at `/api/branding/logo` and `/api/branding/favicon`, without sign-in, because the login page shows them.
````

- [ ] **Step 5: Update `CLAUDE.md`** (rules and pointers only, keep it short):
  - In "Decisions", add: `- ADR-0030 Settings per area from the environment or the admin page, chosen by <AREA>_MODE (disabled, env, database); one JSON document per area in instance_settings (+ instance_setting_files); images re-encoded to PNG with sharp; branding first; SMTP and LDAP follow; the settings key stays in env (recorded deviation); proposed in the settings PR.`
  - In "Where things are", add: `Settings (ADR-0030): lib/settings/ (modes, branding-rules, images, branding, image-response), lib/data/settings.ts, db/schema/settings.ts, app/api/branding/{logo,favicon}, app/(admin)/settings/, components/admin/settings/, components/shell/{admin-nav,brand-logo}.tsx, components/providers/branding-context.tsx, docs/settings.md.`
  - In "Next step": B3b is merged (PR #33); the settings-and-branding branch `feat/settings-branding` (spec and plan paths); then SMTP and LDAP onto the layer.
  - In "Open follow-ups": SMTP and LDAP onto the settings layer (spec §6); a key-rotation command; encrypting the Dify API keys with the settings key; an apple-touch icon; the zh and ar wording of `admin_settings.*` and the menu keys for the owner's review.
- [ ] **Step 6: Re-check `.cii-assessment.md`** against AGENTS.md's rule (each criterion's result). If nothing changed, leave it. If something did, update the row and the change log and commit it on its own (`docs: update CII assessment`).
- [ ] **Step 7: Commit**

```bash
git add docs/decisions docs/settings.md CLAUDE.md
git commit -m "docs: record the settings layer and branding"
```

---

### Task 12: Verification gates

**Files:** none new.

- [ ] **Step 1: Static gates**

Run: `pnpm exec next typegen && pnpm exec tsc --noEmit && pnpm exec oxlint && pnpm exec oxfmt --check .` Expected: clean (oxlint's existing baseline only).

- [ ] **Step 2: Unit suite**

Run: `pnpm test` Expected: all pass (B3b baseline 128 files / 1,623 tests plus this plan's files).

- [ ] **Step 3: e2e suite** (stop `pnpm dev` first)

Run: `pnpm test:e2e` Expected: 0 failed.

- [ ] **Step 4: Docker gate** (CLAUDE.md "Docker stack"; take the old app container down first)

```bash
docker compose -f docker-compose.local.yml stop app && docker compose -f docker-compose.local.yml rm -f app
docker compose -f docker-compose.local.yml up -d --build app
```

Then the CLAUDE.md curl list, plus:

- `curl -s -o /dev/null -w '%{http_code}' localhost:5300/api/branding/logo` → `404` (the local `.env` has no `BRANDING_MODE`, so `disabled`), and its body `{"code":"not_found",…}`;
- `curl -s -o /dev/null -w '%{http_code}' localhost:5300/settings/branding` signed out → `307` to `/login?callbackUrl=%2Fsettings%2Fbranding`;
- `curl -s localhost:5300/login | grep -o '<link rel="icon"[^>]*>'` → an `/_next/static/media/logo.…png` link;
- `docker compose -f docker-compose.local.yml logs app | grep -i sharp` → no load error (sharp's native module loads in the Alpine image).

- [ ] **Step 5: Report** the gate results to the owner with the browser checks left for them: set `BRANDING_MODE=database` in `.env`, restart, save a name and a logo on Settings > Branding; then `env` mode with a mounted file.
