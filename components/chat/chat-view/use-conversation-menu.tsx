'use client'

import { DeleteOutlined, EditOutlined, EllipsisOutlined } from '@ant-design/icons'
import type { ConversationItemType, ConversationsProps } from '@ant-design/x'
import type { MenuProps, ModalFuncProps } from 'antd'
import { App, Button, Form, Input } from 'antd'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/** `Conversations` `menu` as a function of the item (the prop also takes one fixed menu for all items). */
type ConversationMenu = Extract<
	ConversationsProps['menu'],
	(value: ConversationItemType) => unknown
>

export interface ConversationMenuOptions {
	/** Renames the conversation where it is stored, then in the list; rejects with the failure (describeFailure words it). */
	rename: (key: string, name: string) => Promise<void>
	/** Deletes the conversation, then removes it from the list and activates the next one; rejects like `rename`. */
	remove: (key: string) => Promise<void>
	/**
	 * Whether the conversation can be renamed yet (the Dify chat: once Dify has named it, spec §4.4; the shared chat:
	 * once the hub stores it). Keep it stable (useCallback): the menu, and so the memoised sidebar, follows it.
	 */
	canRename: (key: string) => boolean
	/**
	 * A failed rename or delete in words, for the toast (each chat words its own failures: the Dify chat with
	 * failureText, the shared chat with its own codes). Keep it stable (useCallback), as `canRename`.
	 */
	describeFailure: (error: unknown) => string
}

/**
 * The per-item menu of X `Conversations` (spec §5.2: `menu` as a function of the item, antd Menu items
 * and `onClick`). Rename and delete ask through `App.useApp().modal.confirm` (never the static `Modal`,
 * which has no App context), rename with an antd Form in the modal's content. A conversation that cannot be
 * renamed yet (`canRename`) can only be deleted.
 */
export const useConversationMenu = ({
	rename,
	remove,
	canRename,
	describeFailure,
}: ConversationMenuOptions): ConversationMenu => {
	const { t } = useTranslation()
	const { modal, message } = App.useApp()
	// Created here, connected by the Form of the rename modal; its values are set through the Form's
	// `initialValues` because the Form does not exist before the modal opens (antd Form FAQ: "Why is there
	// a form warning when used in Modal?").
	const [form] = Form.useForm<{ name: string }>()

	/** The failure's text (the chat's describeFailure); the modal stays open for another try. */
	const reportFailure = useCallback(
		(error: unknown) => {
			message.error(describeFailure(error))
		},
		[describeFailure, message],
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
				...(canRename(conversation.key)
					? [{ key: 'rename', label: t('chat.rename'), icon: <EditOutlined /> }]
					: []),
				{ key: 'delete', label: t('chat.delete'), icon: <DeleteOutlined />, danger: true },
			]
			// X's default trigger is a bare icon: neither named nor reachable by keyboard. Each row's button is
			// named after its conversation, so the list's buttons tell apart.
			const name = t('chat.menu_for', { name: String(conversation.label ?? '') })
			return {
				items,
				trigger: (
					<Button
						type="text"
						size="small"
						icon={<EllipsisOutlined />}
						aria-label={name}
						title={name}
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
		[ask, canRename, form, message, remove, rename, reportFailure, t],
	)
}
