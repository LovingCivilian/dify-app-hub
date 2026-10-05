'use client'

import { DeleteOutlined, EditOutlined, EllipsisOutlined } from '@ant-design/icons'
import type { ConversationItemType, ConversationsProps } from '@ant-design/x'
import type { MenuProps, ModalFuncProps } from 'antd'
import { App, Button, Form, Input } from 'antd'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { toDifyError } from '../hooks/dify-errors'

/** `Conversations` `menu` as a function of the item (the prop also takes one fixed menu for all items). */
type ConversationMenu = Extract<
	ConversationsProps['menu'],
	(value: ConversationItemType) => unknown
>

export interface ConversationMenuOptions {
	/** Rename on Dify, then locally; rejects with `{ status, code?, message }` (useConversations). */
	rename: (key: string, name: string) => Promise<void>
	/** Delete on Dify, then locally, activating the next conversation; rejects like `rename`. */
	remove: (key: string) => Promise<void>
	/** The Dify conversation id, undefined until a new chat's first reply named it (spec §4.4). */
	getDifyId: (key: string) => string | undefined
}

/**
 * The per-item menu of X `Conversations` (spec §5.2: `menu` as a function of the item, antd Menu items
 * and `onClick`). Rename and delete ask through `App.useApp().modal.confirm` (never the static `Modal`,
 * which has no App context), rename with an antd Form in the modal's content. A chat Dify has not named
 * yet can only be deleted: its name is Dify's to give once the first reply starts it.
 */
export const useConversationMenu = ({
	rename,
	remove,
	getDifyId,
}: ConversationMenuOptions): ConversationMenu => {
	const { t } = useTranslation()
	const { modal, message } = App.useApp()
	// Created here, connected by the Form of the rename modal; its values are set through the Form's
	// `initialValues` because the Form does not exist before the modal opens (antd Form FAQ: "Why is there
	// a form warning when used in Modal?").
	const [form] = Form.useForm<{ name: string }>()

	/** Dify's text when it gave one, else the generic one; the modal stays open for another try. */
	const reportFailure = useCallback(
		(error: unknown) => {
			message.error(toDifyError(error).message || t('common.request_failed_retry'))
		},
		[message, t],
	)

	/**
	 * Awaiting the handle (antd Modal, "Hooks only": `then`, "support `await` operation") is what keeps a
	 * modal whose `onOk` rejected open without an unhandled rejection; the answer is not needed.
	 */
	const ask = useCallback(
		async (config: ModalFuncProps) => {
			await modal.confirm(config)
		},
		[modal],
	)

	return useCallback<ConversationMenu>(
		conversation => {
			const items: MenuProps['items'] = [
				...(getDifyId(conversation.key)
					? [{ key: 'rename', label: t('chat.rename'), icon: <EditOutlined /> }]
					: []),
				{ key: 'delete', label: t('chat.delete'), icon: <DeleteOutlined />, danger: true },
			]
			return {
				items,
				// X's default trigger is a bare icon: neither named nor reachable by keyboard.
				trigger: (
					<Button
						type="text"
						size="small"
						icon={<EllipsisOutlined />}
						aria-label={t('chat.menu_for')}
						title={t('chat.menu_for')}
					/>
				),
				onClick: ({ key, domEvent }) => {
					// The row's own click activates the conversation.
					domEvent.stopPropagation()
					if (key === 'rename') {
						void ask({
							title: t('chat.rename'),
							icon: null,
							content: (
								<Form
									form={form}
									layout="vertical"
									// Unmounting the Form drops the value, so the next opening starts from its own name.
									preserve={false}
									initialValues={{ name: String(conversation.label ?? '') }}
								>
									<Form.Item
										name="name"
										rules={[
											{ required: true, whitespace: true, message: t('chat.rename_placeholder') },
										]}
									>
										<Input
											autoFocus
											placeholder={t('chat.rename_placeholder')}
											aria-label={t('chat.rename_placeholder')}
										/>
									</Form.Item>
								</Form>
							),
							okText: t('common.ok'),
							cancelText: t('common.cancel'),
							// The box takes the focus, not the OK button. antd 6.6.5 still focuses OK: ConfirmDialog reads
							// `focusable?.autoFocusButton || autoFocusButton`, so the documented `null` falls through to
							// 'ok' (the deprecated top-level prop honours `null` but logs a deprecation error). Left as
							// documented, it takes effect once antd fixes the fallthrough.
							focusable: { autoFocusButton: null },
							onOk: async () => {
								// A refused name rejects here and shows where it was typed.
								const { name } = await form.validateFields()
								try {
									await rename(conversation.key, name.trim())
								} catch (error) {
									reportFailure(error)
									throw error
								}
								message.success(t('chat.rename_success'))
							},
						})
					}
					if (key === 'delete') {
						void ask({
							title: t('chat.delete_confirm_title'),
							content: t('chat.delete_confirm_content'),
							okText: t('common.delete'),
							okButtonProps: { danger: true },
							cancelText: t('common.cancel'),
							// Deleting cannot be undone: Enter on the opened modal must not confirm it.
							focusable: { autoFocusButton: 'cancel' },
							onOk: async () => {
								try {
									await remove(conversation.key)
								} catch (error) {
									reportFailure(error)
									throw error
								}
								message.success(t('chat.delete_success'))
							},
						})
					}
				},
			}
		},
		[ask, form, getDifyId, message, remove, rename, reportFailure, t],
	)
}
