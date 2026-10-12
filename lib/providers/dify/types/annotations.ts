export interface AnnotationItem {
	id: string
	question: string
	answer: string
	hit_count: number
	created_at: number
}

export interface AnnotationsQuery {
	page?: number
	limit?: number
	keyword?: string
}

export interface AnnotationsPage {
	data: AnnotationItem[]
	has_more: boolean
	limit: number
	total: number
	page: number
}

export interface AnnotationInput {
	question: string
	answer: string
}
