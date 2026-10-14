export type SendDecision = 'send' | 'queue' | 'ignore'

/**
 * One reply at a time per conversation. A send while this key's reply runs is ignored (Prompts and
 * regenerate are not blocked by the Sender). While the history loads, one send waits in the SDK's
 * queue (use-x-chat: queueRequest) and further ones are ignored until its reply has started: the SDK
 * sends everything queued at once, in a `setTimeout` after the history lands, which would run
 * concurrent streams on the key's one provider.
 */
export const sendDecision = ({
	isRequesting,
	isDefaultMessagesRequesting,
	queued,
}: {
	isRequesting: boolean
	isDefaultMessagesRequesting: boolean
	queued: boolean
}): SendDecision => {
	if (isRequesting || queued) return 'ignore'
	return isDefaultMessagesRequesting ? 'queue' : 'send'
}
