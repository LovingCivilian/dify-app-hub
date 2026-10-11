import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BrandingEnv } from '@/lib/env'

const { envState, data, logs, fsSpies } = vi.hoisted(() => ({
	envState: { branding: { mode: 'disabled', values: null } as BrandingEnv },
	data: {
		readInstanceSetting: vi.fn(),
		readInstanceSettingChange: vi.fn(),
		readInstanceSettingFile: vi.fn(),
		writeInstanceSetting: vi.fn(),
	},
	logs: { logSettingsError: vi.fn(), logActionError: vi.fn() },
	fsSpies: { readFile: vi.fn() },
}))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/env', () => ({ env: () => envState }))
vi.mock('@/lib/data/settings', () => data)
// The factories hand back the same hoisted spies after each vi.resetModules() (Vitest `vi.mock`, `vi.hoisted`).
vi.mock('@/lib/error-log', () => logs)
// The real readFile behind a spy, so a test can tell whether a file was read (Vitest `vi.mock` with `importOriginal`).
vi.mock('node:fs/promises', async importOriginal => {
	const original = await importOriginal<typeof import('node:fs/promises')>()
	fsSpies.readFile.mockImplementation(original.readFile)
	return { ...original, readFile: fsSpies.readFile }
})
const { logSettingsError, logActionError } = logs

/** A fresh module per test: env mode keeps its processed files for the process. */
const load = async () => {
	vi.resetModules()
	return import('@/lib/settings/branding')
}

/** A temporary directory for the test's files (R3: `fs.mkdtemp` under `os.tmpdir()`), removed after it. */
const tempDirs: string[] = []
const tempDir = async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'branding-'))
	tempDirs.push(dir)
	return dir
}

const builtInImage = { src: '/_next/static/media/logo.abc.png', width: 81, height: 83 }
const admin = { id: 'a1', email: 'admin@example.com', name: null, role: 'admin' as const }
const sha = (char: string) => char.repeat(64)
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const png = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 4, background: '#1677ff' } })
		.png()
		.toBuffer()

type Build = (current: unknown) => unknown

/**
 * writeInstanceSetting as the DAL runs it (lib/data/settings.ts): `build` against the document read under the row lock,
 * nothing written and `false` when it answers undefined. `attempts` re-runs it as a deadlock re-issue does. Answers what
 * each run built.
 */
const lockedDocument = (current: unknown, attempts = 1) => {
	const built: unknown[] = []
	data.writeInstanceSetting.mockImplementation(async (_actor, _area, build: Build) => {
		for (let attempt = 0; attempt < attempts; attempt += 1) built.push(build(current))
		return built.at(-1) !== undefined
	})
	return built
}

beforeEach(() => {
	envState.branding = { mode: 'disabled', values: null }
	for (const fn of Object.values(data)) fn.mockReset()
	logSettingsError.mockClear()
	logActionError.mockClear()
	// mockClear keeps the real implementation the factory gave the spy.
	fsSpies.readFile.mockClear()
})

afterEach(async () => {
	// Node docs, `fsPromises.rm`: `recursive` removes the directory with its files, `force` ignores a missing path.
	await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
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
		expect(await getBranding()).toMatchObject({
			mode: 'database',
			builtIn: true,
			name: 'Dify App Hub',
		})
		const logo = { sha256: sha('a'), width: 400, height: 100 }
		data.readInstanceSetting.mockResolvedValueOnce({
			data: { name: 'Acme', showName: false, logo, favicon: null },
		})
		expect(await (await load()).getBranding()).toEqual({
			mode: 'database',
			builtIn: false,
			name: 'Acme',
			showName: false,
			logo,
			favicon: null,
		})
		expect(data.readInstanceSetting).toHaveBeenCalledWith('branding')
	})

	it('falls back to the built-in brand and logs a document the schema refuses', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({ data: { name: '' } })
		expect(await (await load()).getBranding()).toMatchObject({ builtIn: true })
		expect(logSettingsError).toHaveBeenCalledWith('instance_settings.branding', 'invalid_document')
	})

	it('falls back to the built-in brand when the database does not answer (Review Focus 1)', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockRejectedValue(
			Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
		)
		expect(await (await load()).getBranding()).toMatchObject({ mode: 'database', builtIn: true })
		expect(logActionError).toHaveBeenCalledWith(expect.any(Error), 'getBranding')
	})

	it('reads env mode from the variables and the processed files', async () => {
		const dir = await tempDir()
		const logoFile = path.join(dir, 'logo.png')
		await writeFile(logoFile, await png(800, 200))
		envState.branding = {
			mode: 'env',
			values: { name: 'Acme', showName: true, logoFile, faviconFile: null },
		}
		const branding = await (await load()).getBranding()
		expect(branding).toMatchObject({
			mode: 'env',
			builtIn: false,
			name: 'Acme',
			showName: true,
			favicon: null,
		})
		expect(branding.logo).toEqual({
			sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
			width: 768,
			height: 192,
		})
		expect(fsSpies.readFile).toHaveBeenCalledWith(logoFile)
		expect(data.readInstanceSetting).not.toHaveBeenCalled()
	})

	it('runs without an env file it cannot use, logging the variable and the code, never the path (Review Focus 5)', async () => {
		const dir = await tempDir()
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
		// A directory is not a regular file: refused by its type, before any read.
		expect(logSettingsError).toHaveBeenCalledWith('BRANDING_FAVICON_FILE', 'not_allowed')
		expect(JSON.stringify(logSettingsError.mock.calls)).not.toContain(dir)
		const settings = await getBrandingSettings(admin, builtInImage)
		expect(settings.env?.errors).toEqual({ logo: 'ENOENT', favicon: 'not_allowed' })
		// Spec §4.2: the name shows while the logo is unavailable, although BRANDING_SHOW_NAME is false.
		expect(settings.current.showName).toBe(true)
		// The files are read once for the process (spec §4.2), so each refusal is logged once.
		expect(logSettingsError).toHaveBeenCalledTimes(2)
		expect(fsSpies.readFile).not.toHaveBeenCalled()
		expect(data.readInstanceSettingChange).not.toHaveBeenCalled()
	})

	it.skipIf(process.platform === 'win32')(
		'refuses a FIFO by its type without opening it, as its size of 0 would pass the size check',
		async () => {
			const dir = await tempDir()
			const logoFile = path.join(dir, 'logo.png')
			// mkfifo(1) is POSIX; Windows has no named pipes in the file system, hence the skip there.
			execFileSync('mkfifo', [logoFile])
			envState.branding = {
				mode: 'env',
				values: { name: 'Acme', showName: true, logoFile, faviconFile: null },
			}
			expect(await (await load()).getBranding()).toMatchObject({ logo: null })
			expect(logSettingsError).toHaveBeenCalledWith('BRANDING_LOGO_FILE', 'not_allowed')
			expect(fsSpies.readFile).not.toHaveBeenCalled()
		},
	)

	it('refuses an oversized env file by its size, without reading it', async () => {
		const dir = await tempDir()
		const faviconFile = path.join(dir, 'big.png')
		await writeFile(faviconFile, Buffer.alloc(256 * 1024 + 1))
		envState.branding = {
			mode: 'env',
			values: { name: 'Acme', showName: true, logoFile: null, faviconFile },
		}
		await (await load()).getBranding()
		expect(logSettingsError).toHaveBeenCalledWith('BRANDING_FAVICON_FILE', 'too_large')
		expect(fsSpies.readFile).not.toHaveBeenCalled()
	})
})

describe('brandingView (spec §4.6)', () => {
	const base = {
		mode: 'database' as const,
		builtIn: false,
		name: 'Acme',
		showName: true,
		logo: null,
		favicon: null,
	}

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
		expect(brandingView({ ...base, logo }, builtInImage).faviconSrc).toBe(
			`/api/branding/favicon?v=${'1'.repeat(16)}`,
		)
		expect(brandingView(base, builtInImage).faviconSrc).toBe(builtInImage.src)
	})

	it('shows the name whenever there is no logo', async () => {
		const { brandingView } = await load()
		expect(brandingView({ ...base, showName: false }, builtInImage)).toMatchObject({
			showName: true,
			logo: null,
		})
	})
})

describe('readBrandImageVersion (spec §4.5; RFC 9110 §13.1.2: a conditional request needs only the validator)', () => {
	const document = {
		name: 'Acme',
		showName: true,
		logo: { sha256: sha('a'), width: 4, height: 1 },
		favicon: null,
	}

	it('answers the hash the document records in database mode, without reading the file', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({ data: document })
		const { readBrandImageVersion } = await load()
		expect(await readBrandImageVersion('logo')).toBe(sha('a'))
		expect(await readBrandImageVersion('favicon')).toBeNull()
		expect(data.readInstanceSettingFile).not.toHaveBeenCalled()
	})

	it('answers the processed file’s hash in env mode, the one readBrandImage serves', async () => {
		const dir = await tempDir()
		const logoFile = path.join(dir, 'logo.png')
		await writeFile(logoFile, await png(800, 200))
		envState.branding = {
			mode: 'env',
			values: { name: 'Acme', showName: true, logoFile, faviconFile: null },
		}
		const { readBrandImage, readBrandImageVersion } = await load()
		const version = await readBrandImageVersion('logo')
		expect(version).toMatch(/^[0-9a-f]{64}$/)
		expect(version).toBe((await readBrandImage('logo'))?.sha256)
		expect(await readBrandImageVersion('favicon')).toBeNull()
	})

	it('answers null in disabled mode, and when the database does not answer', async () => {
		expect(await (await load()).readBrandImageVersion('logo')).toBeNull()
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockRejectedValue(new Error('connect ECONNREFUSED'))
		expect(await (await load()).readBrandImageVersion('logo')).toBeNull()
	})

	it('reads afresh on each call, since the image routes run outside a render (react.dev `cache`: Server Components only)', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({ data: document })
		// A stand-in for React's `cache` inside one server render, which keeps the first answer (react.dev `cache`).
		vi.doMock('react', async importOriginal => ({
			...(await importOriginal<typeof import('react')>()),
			cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
				let memo: { value: R } | undefined
				return (...args: A) => (memo ??= { value: fn(...args) }).value
			},
		}))
		try {
			const { getBranding, readBrandImageVersion } = await load()
			await getBranding()
			await getBranding()
			expect(data.readInstanceSetting).toHaveBeenCalledTimes(1)
			await readBrandImageVersion('logo')
			await readBrandImageVersion('logo')
			expect(data.readInstanceSetting).toHaveBeenCalledTimes(3)
		} finally {
			vi.doUnmock('react')
		}
	})
})

describe('readBrandImage (spec §4.5)', () => {
	it('serves the stored file with the hash of the bytes it read, so the body always matches its ETag', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({
			data: {
				name: 'Acme',
				showName: true,
				logo: { sha256: sha('a'), width: 4, height: 1 },
				favicon: null,
			},
		})
		data.readInstanceSettingFile.mockResolvedValue({ bytes: Buffer.from([7]), mime: 'image/png' })
		const { readBrandImage } = await load()
		// A save that replaced the file after the document was read: the hash follows the bytes, not the document.
		expect(await readBrandImage('logo')).toEqual({
			bytes: Buffer.from([7]),
			sha256: sha256(Buffer.from([7])),
		})
		expect(data.readInstanceSettingFile).toHaveBeenCalledWith('branding', 'logo')
		expect(await readBrandImage('favicon')).toBeNull()
		expect(data.readInstanceSettingFile).toHaveBeenCalledTimes(1)
	})

	it('answers null and logs when the document names a file that is not there', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue({
			data: {
				name: 'Acme',
				showName: true,
				logo: { sha256: sha('a'), width: 4, height: 1 },
				favicon: null,
			},
		})
		data.readInstanceSettingFile.mockResolvedValue(null)
		expect(await (await load()).readBrandImage('logo')).toBeNull()
		expect(logSettingsError).toHaveBeenCalledWith(
			'instance_setting_files.branding.logo',
			'missing_file',
		)
	})

	it('serves the processed file in env mode', async () => {
		const dir = await tempDir()
		const logoFile = path.join(dir, 'logo.png')
		await writeFile(logoFile, await png(800, 200))
		envState.branding = {
			mode: 'env',
			values: { name: 'Acme', showName: true, logoFile, faviconFile: null },
		}
		const { getBranding, readBrandImage } = await load()
		const image = await readBrandImage('logo')
		expect(image?.sha256).toBe((await getBranding()).logo?.sha256)
		expect(image && sha256(image.bytes)).toBe(image?.sha256)
		expect((await sharp(image?.bytes).metadata()).format).toBe('png')
		expect(await readBrandImage('favicon')).toBeNull()
	})

	it('serves nothing in disabled mode', async () => {
		expect(await (await load()).readBrandImage('logo')).toBeNull()
	})
})

describe('saveBranding (spec §5.4)', () => {
	const keepBoth = { logo: { intent: 'keep' as const }, favicon: { intent: 'keep' as const } }
	const saved = { sha256: sha('a'), width: 400, height: 100 }
	const stored = { name: 'Old', showName: true, logo: saved, favicon: null }

	beforeEach(() => {
		envState.branding = { mode: 'database', values: null }
	})

	it('refuses outside database mode', async () => {
		envState.branding = {
			mode: 'env',
			values: { name: 'Acme', showName: true, logoFile: null, faviconFile: null },
		}
		const { saveBranding } = await load()
		expect(await saveBranding(admin, { name: 'Acme', showName: true, images: keepBoth })).toEqual({
			ok: false,
			code: 'settings_not_editable',
		})
		expect(data.writeInstanceSetting).not.toHaveBeenCalled()
	})

	it('keeps the stored images on keep, and writes no file change', async () => {
		const built = lockedDocument(stored)
		const { saveBranding } = await load()
		expect(await saveBranding(admin, { name: 'Acme', showName: false, images: keepBoth })).toEqual({
			ok: true,
			data: undefined,
		})
		expect(data.writeInstanceSetting).toHaveBeenCalledWith(
			admin,
			'branding',
			expect.any(Function),
			{},
		)
		expect(built).toEqual([{ name: 'Acme', showName: false, logo: saved, favicon: null }])
	})

	it('resolves keep against the document read under the lock, so a concurrent save is not undone (spec §4.3)', async () => {
		const theirs = { sha256: sha('b'), width: 300, height: 100 }
		const theirFavicon = { sha256: sha('c'), width: 64, height: 64 }
		const built = lockedDocument({ ...stored, logo: theirs, favicon: theirFavicon })
		const { saveBranding } = await load()
		await saveBranding(admin, { name: 'Acme', showName: true, images: keepBoth })
		expect(built).toEqual([{ name: 'Acme', showName: true, logo: theirs, favicon: theirFavicon }])
		expect(data.readInstanceSetting).not.toHaveBeenCalled()
	})

	it('keeps nothing from a stored document the schema refuses, or before the first save', async () => {
		const { saveBranding } = await load()
		for (const current of [{ name: '' }, null]) {
			const built = lockedDocument(current)
			await saveBranding(admin, { name: 'Acme', showName: true, images: keepBoth })
			expect(built).toEqual([{ name: 'Acme', showName: true, logo: null, favicon: null }])
		}
	})

	it('processes a replaced image and deletes a removed one', async () => {
		const built = lockedDocument(stored)
		const { saveBranding } = await load()
		const file = new File([await png(64, 64)], 'icon.png', { type: 'image/png' })
		const result = await saveBranding(admin, {
			name: 'Acme',
			showName: true,
			images: { logo: { intent: 'remove' }, favicon: { intent: 'replace', file } },
		})
		expect(result).toEqual({ ok: true, data: undefined })
		const [, , , files] = data.writeInstanceSetting.mock.calls[0]
		expect(built).toEqual([
			{
				name: 'Acme',
				showName: true,
				logo: null,
				favicon: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/), width: 64, height: 64 },
			},
		])
		expect(files).toEqual({ logo: null, favicon: { bytes: expect.any(Buffer), mime: 'image/png' } })
	})

	it('builds the same document on every attempt, as a deadlock re-issue runs it again', async () => {
		const built = lockedDocument(stored, 3)
		const { saveBranding } = await load()
		const file = new File([await png(800, 200)], 'logo.png', { type: 'image/png' })
		expect(
			await saveBranding(admin, {
				name: 'Acme',
				showName: false,
				images: { logo: { intent: 'replace', file }, favicon: { intent: 'keep' } },
			}),
		).toEqual({ ok: true, data: undefined })
		expect(built).toHaveLength(3)
		expect(built[1]).toEqual(built[0])
		expect(built[2]).toEqual(built[0])
		expect(built[0]).toMatchObject({ logo: { width: 768, height: 192 } })
	})

	it('checks the document it writes against the schema, inside the write (spec §3.3: one schema)', async () => {
		lockedDocument(stored)
		const { saveBranding } = await load()
		// A caller that skipped the action's schema: the throw rolls the write's transaction back.
		await expect(
			saveBranding(admin, { name: ' ', showName: true, images: keepBoth }),
		).rejects.toMatchObject({ name: 'ZodError' })
		expect(data.writeInstanceSetting).toHaveBeenCalledTimes(1)
		const built = lockedDocument(stored)
		await saveBranding(admin, { name: ' Acme ', showName: true, images: keepBoth })
		expect(built).toEqual([{ name: 'Acme', showName: true, logo: saved, favicon: null }])
	})

	it('names each refused image in fieldErrors and writes nothing', async () => {
		const { saveBranding } = await load()
		const text = new File(['not an image'], 'logo.png', { type: 'image/png' })
		const big = new File([Buffer.alloc(256 * 1024 + 1)], 'icon.png', { type: 'image/png' })
		expect(
			await saveBranding(admin, {
				name: 'Acme',
				showName: true,
				images: {
					logo: { intent: 'replace', file: text },
					favicon: { intent: 'replace', file: big },
				},
			}),
		).toEqual({
			ok: false,
			code: 'invalid_image',
			fieldErrors: { logo: ['not_allowed'], favicon: ['too_large'] },
		})
		expect(data.writeInstanceSetting).not.toHaveBeenCalled()
	})

	it('refuses to hide the name when no logo is left, writing nothing', async () => {
		const built = lockedDocument(stored)
		const { saveBranding } = await load()
		expect(
			await saveBranding(admin, {
				name: 'Acme',
				showName: false,
				images: { logo: { intent: 'remove' }, favicon: { intent: 'keep' } },
			}),
		).toEqual({ ok: false, code: 'invalid_input', fieldErrors: { showName: ['logo_required'] } })
		expect(built).toEqual([undefined])
	})

	it('refuses to hide the name when a concurrent save removed the kept logo', async () => {
		const built = lockedDocument({ ...stored, logo: null })
		const { saveBranding } = await load()
		expect(await saveBranding(admin, { name: 'Acme', showName: false, images: keepBoth })).toEqual({
			ok: false,
			code: 'invalid_input',
			fieldErrors: { showName: ['logo_required'] },
		})
		expect(built).toEqual([undefined])
	})

	it('refuses a user-role account', async () => {
		const { saveBranding } = await load()
		await expect(
			saveBranding({ ...admin, role: 'user' }, { name: 'Acme', showName: true, images: keepBoth }),
		).rejects.toMatchObject({ code: 'forbidden' })
		expect(data.writeInstanceSetting).not.toHaveBeenCalled()
	})
})

describe('getBrandingSettings', () => {
	it('carries the last change in database mode, through the gated read', async () => {
		envState.branding = { mode: 'database', values: null }
		const at = new Date('2026-10-11T10:00:00.000Z')
		data.readInstanceSetting.mockResolvedValue({
			data: { name: 'Acme', showName: true, logo: null, favicon: null },
		})
		data.readInstanceSettingChange.mockResolvedValue({
			updatedAt: at,
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
		expect(data.readInstanceSettingChange).toHaveBeenCalledWith(admin, 'branding')
	})

	it('has no last change before the first save', async () => {
		envState.branding = { mode: 'database', values: null }
		data.readInstanceSetting.mockResolvedValue(null)
		data.readInstanceSettingChange.mockResolvedValue(null)
		expect(await (await load()).getBrandingSettings(admin, builtInImage)).toMatchObject({
			updatedAt: null,
			updatedByEmail: null,
		})
	})

	it('shows the mode and the built-in brand in disabled mode, with no database read', async () => {
		expect(await (await load()).getBrandingSettings(admin, builtInImage)).toMatchObject({
			mode: 'disabled',
			current: { name: 'Dify App Hub', logo: builtInImage },
			env: null,
			updatedAt: null,
		})
		expect(data.readInstanceSetting).not.toHaveBeenCalled()
		expect(data.readInstanceSettingChange).not.toHaveBeenCalled()
	})

	it('refuses a user-role account', async () => {
		await expect(
			(await load()).getBrandingSettings({ ...admin, role: 'user' }, builtInImage),
		).rejects.toMatchObject({ code: 'forbidden' })
	})
})
