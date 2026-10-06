import { describe, expect, it } from 'vitest'

import {
	acceptFormatOf,
	acceptedExtensions,
	allowsLocalUpload,
	fileTypeFor,
	toControlFile,
	toFileMapping,
	withinLimit,
} from '@/components/chat/chat-view/file-types'

// Dify's rules (OpenAPI, GET /form/human_input inputs, and GET /parameters file_upload): `allowed_file_types`
// are categories; `allowed_file_extensions` ("with the leading `.`") apply when the types include `custom`.
describe('fileTypeFor', () => {
	const imagesAndDocuments = { types: ['image', 'document'] as const, extensions: [] }

	it('gives an accepted file the category its extension belongs to, whatever its case', () => {
		expect(fileTypeFor('photo.PNG', imagesAndDocuments)).toBe('image')
		expect(fileTypeFor('note.txt', imagesAndDocuments)).toBe('document')
	})
	it('refuses a file outside the allowed categories', () => {
		expect(fileTypeFor('song.mp3', imagesAndDocuments)).toBeUndefined()
		expect(fileTypeFor('README', imagesAndDocuments)).toBeUndefined()
	})
	it('reads the extension list only for custom files', () => {
		// The stub app lists extensions without `custom`: they widen nothing.
		expect(
			fileTypeFor('song.mp3', { types: ['image', 'document'], extensions: ['.mp3'] }),
		).toBeUndefined()
		const custom = { types: ['document', 'custom'] as const, extensions: ['.MD', 'xyz'] }
		expect(fileTypeFor('a.xyz', custom)).toBe('custom')
		expect(fileTypeFor('b.pdf', custom)).toBe('document')
		expect(fileTypeFor('c.md', { types: ['custom'], extensions: ['.md'] })).toBe('custom')
		expect(fileTypeFor('d.exe', custom)).toBeUndefined()
		expect(fileTypeFor('e.md', { types: ['custom'], extensions: [] })).toBeUndefined()
	})
	it('accepts any file when the app names no type, typed by its extension', () => {
		const any = { types: [], extensions: [] }
		expect(fileTypeFor('clip.mp4', any)).toBe('video')
		expect(fileTypeFor('archive.zip', any)).toBe('custom')
	})
})

describe('accepted extensions', () => {
	it('lists the categories and the custom extensions, lower-case without the dot', () => {
		expect(acceptedExtensions({ types: ['image', 'custom'], extensions: ['.MD'] })).toEqual([
			'jpg',
			'jpeg',
			'png',
			'gif',
			'svg',
			'webp',
			'md',
		])
	})
	it("gives the file input's accept format, none when anything goes", () => {
		expect(acceptFormatOf({ types: ['image'], extensions: [] })).toBe(
			'.jpg,.jpeg,.png,.gif,.svg,.webp',
		)
		expect(acceptFormatOf({ types: [], extensions: [] })).toBeUndefined()
	})
})

describe('allowsLocalUpload', () => {
	it('allows uploads unless the app lists methods without local files', () => {
		expect(allowsLocalUpload(undefined)).toBe(true)
		expect(allowsLocalUpload([])).toBe(true)
		expect(allowsLocalUpload(['local_file', 'remote_url'])).toBe(true)
		expect(allowsLocalUpload(['remote_url'])).toBe(false)
	})
})

describe('withinLimit', () => {
	it('takes files until the limit and counts the rest', () => {
		expect(withinLimit(['a', 'b', 'c'], 1, 3)).toEqual({ accepted: ['a', 'b'], refused: 1 })
		expect(withinLimit(['a'], 3, 3)).toEqual({ accepted: [], refused: 1 })
		expect(withinLimit(['a', 'b'], 5, undefined)).toEqual({ accepted: ['a', 'b'], refused: 0 })
	})
})

// OpenAPI InputFileObject: `{ type, transfer_method: local_file, upload_file_id }` or
// `{ type, transfer_method: remote_url, url }`.
describe('toFileMapping', () => {
	it('maps an uploaded file and a remote one, and nothing without an id or a URL', () => {
		expect(
			toFileMapping({ type: 'image', transfer_method: 'local_file', upload_file_id: 'u1' }),
		).toEqual({ type: 'image', transfer_method: 'local_file', upload_file_id: 'u1' })
		expect(
			toFileMapping({ type: 'document', transfer_method: 'remote_url', remote_url: 'https://x/a' }),
		).toEqual({ type: 'document', transfer_method: 'remote_url', url: 'https://x/a' })
		expect(toFileMapping({ type: 'image', transfer_method: 'local_file' })).toBeUndefined()
		expect(toFileMapping({ type: 'image', transfer_method: 'remote_url' })).toBeUndefined()
	})
})

// A conversation's stored file input as Dify lists it (GET /conversations `inputs`; the shape the old form
// read, components/chatbox/types.ts IDifyConversationInputFile), mapped the way the old normalizeFieldValue did.
describe('toControlFile', () => {
	const stored = {
		dify_model_identity: '__dify__file__',
		id: null,
		tenant_id: 't1',
		type: 'document',
		transfer_method: 'local_file',
		remote_url: '',
		related_id: 'up-1',
		filename: 'brief.pdf',
		extension: '.pdf',
		mime_type: 'application/pdf',
		size: 12,
		url: '/files/up-1/file-preview?sign=x',
	}
	it('names the file, keeps its link and its upload id, and marks it done', () => {
		expect(toControlFile(stored, 0)).toMatchObject({
			uid: 'up-1',
			name: 'brief.pdf',
			url: '/files/up-1/file-preview?sign=x',
			status: 'done',
			upload_file_id: 'up-1',
			type: 'document',
			transfer_method: 'local_file',
		})
	})
	it('takes a remote file’s address as its link', () => {
		expect(
			toControlFile(
				{ ...stored, transfer_method: 'remote_url', remote_url: 'https://x/a.pdf', url: undefined },
				2,
			),
		).toMatchObject({ url: 'https://x/a.pdf', name: 'brief.pdf' })
	})
	it('leaves a value the control holds already as it is', () => {
		const control = {
			uid: 'rc-1',
			name: 'a.txt',
			status: 'done' as const,
			type: 'document',
			transfer_method: 'local_file' as const,
			upload_file_id: 'u9',
		}
		expect(toControlFile(control, 0)).toEqual(control)
	})
	it('gives a file without any id a key from its position', () => {
		expect(toControlFile({ filename: 'x.txt' }, 3).uid).toBe('stored-3')
	})
})
