import type { IFile, IFileType } from '@/lib/api'

/**
 * Dify 支持的文件类型和对应的格式
 */
export const FileTypeMap: Map<IFileType, string[]> = new Map()

FileTypeMap.set('document', [
	'txt',
	'md',
	'markdown',
	'pdf',
	'html',
	'xlsx',
	'xls',
	'doc',
	'docx',
	'csv',
	'eml',
	'msg',
	'pptx',
	'ppt',
	'xml',
	'epub',
])
FileTypeMap.set('image', ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'])
FileTypeMap.set('audio', ['mp3', 'm4a', 'wav', 'webm', 'amr'])
FileTypeMap.set('video', ['mp4', 'mov', 'mpeg', 'mpga'])
FileTypeMap.set('custom', [])

/**
 * 获取文件扩展名
 */
export const getFileExtByName = (filename: string) => {
	return filename.split('.').pop()
}

export const getFileTypeByName = (filename: string): IFileType => {
	const ext = filename?.split('.')?.pop()

	// 使用文件扩展名和 FileTypeMap 进行匹配
	let fileType: IFileType = 'custom'
	FileTypeMap.forEach((extensions, type) => {
		if (extensions.indexOf(ext as string) > -1) {
			fileType = type
		}
	})
	return fileType
}

/**
 * 获取文件类型
 * 如果 allowedFileTypes 长度为 1, 则直接返回该类型
 * 否则, 根据文件扩展名进行匹配
 * @param filename 文件名
 * @param allowedFileTypes 允许的文件类型
 */
export const getDifyFileType = (filename: string, allowedFileTypes: IFileType[]): IFileType => {
	if (allowedFileTypes.length === 1) {
		return allowedFileTypes[0]
	}
	return getFileTypeByName(filename)
}

/**
 * 格式化文件大小, 原始单位为 Byte
 * 如果大于 1M, 则显示为 MB, 否则显示为 KB
 * @param size 文件大小
 */
export const formatSize = (size: number) => {
	if (size > 1024 * 1024) {
		return `${(size / 1024 / 1024).toFixed(2)} MB`
	}
	return `${(size / 1024).toFixed(2)} KB`
}

/** A file name's extension, lower-case and without the dot; '' when it has none. */
export const extensionOf = (name: string) => {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * The app's file rules (GET /parameters `file_upload`, a file input's own fields, a human input's fields):
 * `types` are Dify's categories, none meaning any file; `extensions` are the "allowed file extensions when
 * `allowed_file_types` includes `custom`", written "with the leading `.`" (OpenAPI, GET /form/human_input).
 */
export interface FileRules {
	types: readonly IFileType[]
	extensions: readonly string[]
}

const customExtensions = ({ types, extensions }: FileRules) =>
	types.includes('custom') ? extensions.map(ext => ext.replace(/^\./, '').toLowerCase()) : []

/**
 * The Dify type a file goes as (an allowed category its extension belongs to, else `custom` when the custom
 * extensions list it), or undefined when the rules refuse it (Dify checks the same on the server).
 */
export const fileTypeFor = (name: string, rules: FileRules): IFileType | undefined => {
	const ext = extensionOf(name)
	if (!rules.types.length) return getFileTypeByName(`.${ext}`)
	const category = rules.types.find(
		type => type !== 'custom' && (FileTypeMap.get(type) ?? []).includes(ext),
	)
	if (category) return category
	return ext && customExtensions(rules).includes(ext) ? 'custom' : undefined
}

/** The extensions the rules accept, lower-case without the dot (none listed: any file). */
export const acceptedExtensions = (rules: FileRules) => [
	...new Set([
		...rules.types.flatMap(type => (type === 'custom' ? [] : (FileTypeMap.get(type) ?? []))),
		...customExtensions(rules),
	]),
]

/** The file input's `accept` format (".png,.jpg,…"), undefined when any file goes. */
export const acceptFormatOf = (rules: FileRules) => {
	const extensions = acceptedExtensions(rules)
	return extensions.length ? extensions.map(ext => `.${ext}`).join(',') : undefined
}

/** Local uploads are allowed unless the app lists its upload methods without `local_file`. */
export const allowsLocalUpload = (methods?: readonly string[]) =>
	!methods?.length || methods.includes('local_file')

/** The files that still fit next to `current` ones under `limit` (none: no limit), and how many do not. */
export const withinLimit = <T>(files: readonly T[], current: number, limit?: number) => {
	const room = limit === undefined ? files.length : Math.max(0, limit - current)
	return { accepted: files.slice(0, room), refused: Math.max(0, files.length - room) }
}

/** A file as the file control holds it: antd's upload item plus Dify's file fields. */
export interface UploadedFile {
	type?: string
	transfer_method?: string
	upload_file_id?: string
	remote_url?: string
	url?: string
}

/**
 * Dify's file object for a held file (OpenAPI InputFileObject: `{ type, transfer_method: local_file,
 * upload_file_id }` or `{ type, transfer_method: remote_url, url }`); undefined while it has neither, e.g.
 * while it uploads.
 */
export const toFileMapping = (file: UploadedFile): IFile | undefined => {
	const type = file.type as IFileType
	if (file.transfer_method === 'remote_url') {
		const url = file.remote_url || file.url
		return url ? { type, transfer_method: 'remote_url', url } : undefined
	}
	return file.upload_file_id
		? { type, transfer_method: 'local_file', upload_file_id: file.upload_file_id }
		: undefined
}

/**
 * A conversation's stored file input in the file control's shape, as the old form's normalizeFieldValue
 * did: Dify lists it with `filename`, `remote_url` and `related_id` (the uploaded file's id); the control
 * reads `name`, `url`, `status` and `upload_file_id`, and antd's list keys items by `uid`. A value the
 * control holds already keeps its fields.
 */
export const toControlFile = (file: Record<string, unknown>, index: number) => {
	const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
	return {
		...file,
		uid: text(file.uid) ?? text(file.related_id) ?? text(file.id) ?? `stored-${index}`,
		name: text(file.name) ?? text(file.filename) ?? '',
		url: text(file.url) ?? text(file.remote_url),
		status: text(file.status) ?? 'done',
		upload_file_id: text(file.upload_file_id) ?? text(file.related_id),
	}
}
