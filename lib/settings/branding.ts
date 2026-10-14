import 'server-only'

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

import { cache } from 'react'
import * as z from 'zod'

import { fail, ok, type ActionResult } from '@/lib/action-result'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'
import {
	readInstanceSetting,
	readInstanceSettingChange,
	readInstanceSettingFile,
	writeInstanceSetting,
	type InstanceSettingFileChanges,
} from '@/lib/data/settings'
import { env, type BrandingEnv, type BrandingEnvValues } from '@/lib/env'
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
import { ImageError, processImage, type ProcessedImage } from './images'
import type { SettingsMode } from './modes'

/** A processed image as the document records it (spec §4.3): the PNG's hash and size; the bytes are a file row. */
export const storedImageSchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
})
export type StoredImage = z.infer<typeof storedImageSchema>

/** The branding document in instance_settings (spec §4.3), checked on every read and write (saveBranding's build). */
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

/**
 * The `default` of every switch on the mode (TypeScript handbook, "Exhaustiveness checking": "no type is assignable to
 * `never`"), so a mode added to SETTINGS_MODES fails the type check here until each switch handles it.
 */
const unhandledMode = (config: never): never => {
	throw new Error(`Unhandled BRANDING_MODE: ${(config as BrandingEnv).mode}`)
}

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
	/** A Node error code (ENOENT, EACCES) or an image refusal code (too_large, or not_allowed: also not a regular file). */
	errors: Partial<Record<BrandImageKind, string>>
}

/** A refusal's own code, or a file error's string code (Node: "error.code is the most stable way to identify an error"). */
const errorCode = (error: unknown): string => {
	if (error instanceof ImageError) return error.code
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
 * path, and the hub runs without it (spec §4.2, as LDAP_CA_FILE: lib/directory/connection.ts). Its type and size are
 * checked before it is read (Node `fs.stat`), so a wrong path to a large file, a FIFO or a device is never read.
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
			const stats = await stat(file)
			// A regular file only (Node `stats.isFile()`: "describes a regular file"): a FIFO or a device reports a size of 0
			// and readFile would read it without end, and a directory is no image. `stat` follows a symbolic link, so a file
			// mounted behind one still counts.
			if (!stats.isFile()) throw new ImageError('not_allowed')
			if (stats.size > BRAND_IMAGE_MAX_BYTES[kind]) throw new ImageError('too_large')
			result.images[kind] = await processImage(kind, await readFile(file))
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
 * The brand in effect (spec §3.3), read afresh on each call. A database that does not answer gives the built-in brand,
 * so the login page still renders (Review Focus 1). The image routes call this one directly: they run outside a render,
 * and react.dev documents `cache` "only for use in Server Components".
 */
const readBranding = async (): Promise<Branding> => {
	const config = env().branding
	switch (config.mode) {
		case 'disabled':
			return builtInBranding(config.mode)
		case 'env': {
			const { images } = await envImages(config.values)
			return {
				mode: config.mode,
				builtIn: false,
				name: config.values.name,
				showName: config.values.showName,
				logo: stored(images.logo),
				favicon: stored(images.favicon),
			}
		}
		case 'database':
			try {
				const row = await readInstanceSetting('branding')
				return row ? fromDocument(config.mode, row.data) : builtInBranding(config.mode)
			} catch (error) {
				logActionError(error, 'getBranding')
				return builtInBranding(config.mode)
			}
		default:
			return unhandledMode(config)
	}
}

/**
 * The brand for this request (spec §3.5): one read shared by generateMetadata, the layouts and the pages (React `cache`,
 * generate-metadata.md:195; react.dev `cache`: "React will invalidate the cache for all memoized functions for each
 * server request"). readBranding catches a database failure itself, since `cache` would also keep a thrown error for
 * the request.
 */
export const getBranding = cache(readBranding)

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

/**
 * A custom image's SHA-256 (hex) as its route's validator (spec §4.5), or null when there is none; the favicon route falls
 * back itself. It reads no file bytes, so a route can answer a matching `If-None-Match` with a 304 from this alone (RFC
 * 9110 §13.1.2: "to enable efficient updates of cached information with a minimum amount of transaction overhead").
 */
export const readBrandImageVersion = async (kind: BrandImageKind): Promise<string | null> =>
	(await readBranding())[kind]?.sha256 ?? null

/**
 * A custom image's bytes for its route (spec §4.5), or null when there is none; the favicon route falls back itself. The
 * hash is the bytes' own, so a body always matches its ETag, even when a save lands between the document read and the
 * file read.
 */
export const readBrandImage = async (
	kind: BrandImageKind,
): Promise<{ bytes: Buffer; sha256: string } | null> => {
	const config = env().branding
	switch (config.mode) {
		case 'disabled':
			return null
		case 'env': {
			// processImage hashed these very bytes (lib/settings/images.ts).
			const image = (await envImages(config.values)).images[kind]
			return image ? { bytes: image.bytes, sha256: image.sha256 } : null
		}
		case 'database': {
			// Only a file the document names, so a row no document refers to is never served.
			if (!(await readBranding())[kind]) return null
			const file = await readInstanceSettingFile('branding', kind)
			if (!file) {
				logSettingsError(`instance_setting_files.branding.${kind}`, 'missing_file')
				return null
			}
			// Node `crypto.createHash`, as processImage hashes them.
			return { bytes: file.bytes, sha256: createHash('sha256').update(file.bytes).digest('hex') }
		}
		default:
			return unhandledMode(config)
	}
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
	const config = env().branding
	const view: BrandingSettingsView = {
		mode: config.mode,
		current: brandingView(branding, builtInImage),
		name: branding.name,
		showName: branding.showName,
		hasLogo: branding.logo !== null,
		faviconSrc: branding.favicon ? `${BRAND_FAVICON_PATH}?v=${version(branding.favicon)}` : null,
		env: null,
		updatedAt: null,
		updatedByEmail: null,
	}
	switch (config.mode) {
		case 'disabled':
			return view
		case 'env': {
			const { logoFile, faviconFile } = config.values
			const { errors } = await envImages(config.values)
			return { ...view, env: { logoFile, faviconFile, errors } }
		}
		case 'database': {
			// Who saved last comes from the DAL's gated read, never from the public one getBranding uses (ADR-0024; Next's
			// data-security.md, "Data Access Layer": "Perform authorization checks", "Return safe, minimal Data Transfer
			// Objects").
			const change = await readInstanceSettingChange(actor, 'branding')
			return {
				...view,
				updatedAt: change?.updatedAt.toISOString() ?? null,
				updatedByEmail: change?.updatedByEmail ?? null,
			}
		}
		default:
			return unhandledMode(config)
	}
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
 * Spec §5.4 steps 2 and 4–6: the mode, the images through processImage, the name rule, then one write. The role is
 * checked here and again in the DAL (ADR-0024).
 *
 * The replaced images are decoded and re-encoded first, outside the transaction, so sharp's work never runs while the
 * row is locked (PostgreSQL 18 "Explicit Locking", 13.3.4: "it is a bad idea for applications to hold transactions open
 * for long periods of time"; Documenso's `buildBrandingLogoData` and Cal.com's `updateProfile` handler likewise process
 * the image before their write). `keep` and the name rule are resolved inside `build`, against the document
 * writeInstanceSetting reads under its row lock (PostgreSQL 18 "SELECT", The Locking Clause): a save that ran in
 * between and replaced or removed an image cannot leave this document naming a file that is gone (spec §4.3), nor
 * hiding the name with no logo left (spec §4.1).
 */
export const saveBranding = async (
	actor: SessionUser,
	input: BrandingInput,
): Promise<ActionResult> => {
	assertAdmin(actor)
	if (!isBrandingEditable()) return fail('settings_not_editable')
	const replaced: Partial<Record<BrandImageKind, StoredImage>> = {}
	const files: InstanceSettingFileChanges = {}
	const fieldErrors: Record<string, string[]> = {}
	for (const kind of BRAND_IMAGE_KINDS) {
		const change = input.images[kind]
		if (change.intent === 'keep') continue
		if (change.intent === 'remove') {
			files[kind] = null
			continue
		}
		try {
			// Refused unread by its size (spec §4.4 step 1; MDN `Blob.size`), before `arrayBuffer()` copies it.
			if (change.file.size > BRAND_IMAGE_MAX_BYTES[kind]) throw new ImageError('too_large')
			const image = await processImage(kind, Buffer.from(await change.file.arrayBuffer()))
			replaced[kind] = { sha256: image.sha256, width: image.width, height: image.height }
			files[kind] = { bytes: image.bytes, mime: 'image/png' }
		} catch (error) {
			if (!(error instanceof ImageError)) throw error
			fieldErrors[kind] = [error.code]
		}
	}
	if (Object.keys(fieldErrors).length) return fail('invalid_image', fieldErrors)
	/*
	 * Pure and repeatable: writeInstanceSetting runs the whole transaction again after a deadlock (PostgreSQL 18
	 * "Serialization Failure Handling": "It is important to retry the complete transaction, including all logic that
	 * decides which SQL to issue and/or which values to use"), so this computes from `current`, the input and the images
	 * processed above only, and changes nothing outside itself. `undefined` refuses the change: nothing is written.
	 */
	const build = (current: unknown | null): BrandingData | undefined => {
		const parsed = brandingDataSchema.safeParse(current)
		const locked = parsed.success ? parsed.data : null
		const image = (kind: BrandImageKind): StoredImage | null => {
			const change = input.images[kind]
			if (change.intent === 'keep') return locked?.[kind] ?? null
			return change.intent === 'remove' ? null : (replaced[kind] ?? null)
		}
		const logo = image('logo')
		if (!input.showName && !logo) return undefined
		// The module's own check of what it stores (spec §3.3: one schema for the env parse, the row and the save), not
		// only the action's: zod `.parse` throws a ZodError on a refused document, inside the write's transaction, which
		// then writes nothing. Pure, so the build stays repeatable.
		return brandingDataSchema.parse({
			name: input.name,
			showName: input.showName,
			logo,
			favicon: image('favicon'),
		})
	}
	const written = await writeInstanceSetting(actor, 'branding', build, files)
	return written ? ok(undefined) : fail('invalid_input', { showName: ['logo_required'] })
}
