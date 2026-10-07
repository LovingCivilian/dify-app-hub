import type { SiteSettings } from '@/lib/dify/types'

/** The site settings used when GET /site fails (Dify's 403 for an app without a site, or a Dify before 1.4). */
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
	title: '',
	chat_color_theme: '',
	chat_color_theme_inverted: false,
	icon_type: 'emoji',
	icon: '🤖',
	icon_background: '#1C64F2',
	icon_url: null,
	description: '',
	copyright: '',
	privacy_policy: '',
	custom_disclaimer: '',
	default_language: 'en-US',
	show_workflow_steps: false,
	use_icon_as_answer_icon: false,
}
