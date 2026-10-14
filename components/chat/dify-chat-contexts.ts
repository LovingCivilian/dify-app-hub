import type { AppContextValue } from './app-context'
import type { ChatAppInfo } from './chat-view/app-info-context'
import { answerLink } from './message/file-link'
import type { MarkdownLinkRewrite } from './message/markdown/link-context'

/**
 * What the Dify chat provides to the pieces it shares with the shared chat (Part 2 spec §5.1): the app as the sidebar
 * and the welcome name it (Dify's site settings first, the app record second, as AppAvatar and AppInfoBlock read them
 * before), and the answers' link rewrite (a Dify file link through the app's remote-file route, charter §4.1;
 * anything else as written: answerLink). Built once when the app has loaded, so the providers' values keep their
 * identity across renders (react.dev useContext: a provider whose `value` changes re-renders every reader).
 */
export const difyChatContexts = ({
	app,
	site,
	difyApi,
}: Pick<AppContextValue, 'app' | 'site' | 'difyApi'>): {
	appInfo: ChatAppInfo
	rewriteLink: MarkdownLinkRewrite
} => ({
	appInfo: {
		id: app.id,
		name: site.title || app.name,
		description: site.description || app.description,
		hasIcon: app.hasIcon,
	},
	rewriteLink: url => answerLink(url, difyApi),
})
