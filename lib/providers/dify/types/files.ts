/** Dify's file categories (endpoint map §2.1, §2.2). */
export type FileType = 'document' | 'image' | 'audio' | 'video' | 'custom'

export type TransferMethod = 'remote_url' | 'local_file'

export interface RemoteFileInput {
	type: FileType
	transfer_method: 'remote_url'
	url?: string
	/** legacy alias of url */
	remote_url?: string
	/** accepted beside remote_url for persisted references */
	upload_file_id?: string
}

export interface LocalFileInput {
	type: FileType
	transfer_method: 'local_file'
	upload_file_id: string
}

/** A `files[]` item of chat, completion and workflow requests (endpoint map §2.2). */
export type FileInput = RemoteFileInput | LocalFileInput

/** POST /files/upload, 201 (endpoint map §1.6). */
export interface FileUploadResponse {
	id: string
	name: string
	size: number
	extension: string | null
	mime_type: string
	created_by: string | null
	created_at: number
	preview_url?: string | null
	source_url?: string | null
	original_url?: string | null
	conversation_id?: string | null
}
