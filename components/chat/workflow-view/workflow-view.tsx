'use client'

import { App, Button, Col, Flex, Form, Row, Typography, theme } from 'antd'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import UserShell from '@/components/shell/user-shell'

import { useAppContext } from '../app-context'
import { AppInfoBlock } from '../chat-view/conversation-sidebar'
import InputsForm from '../chat-view/inputs-form'
import { decodeLinkInputs, resolveInitialInputs } from '../chat-view/inputs-values'
import { useWorkflowRun } from '../hooks/use-workflow-run'
import RunResult from './run-result'
import styles from './workflow-view.module.css'

/**
 * Workflow and completion apps (spec §5.4): the app's inputs form and the run button on the left, the run
 * on the right; one column below md (antd Grid's responsive Col spans).
 */
export default function WorkflowView() {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message: toast } = App.useApp()
	const { app, site, parameters } = useAppContext()
	const searchParams = useSearchParams()
	const [form] = Form.useForm<Record<string, unknown>>()
	const { state, run, stop } = useWorkflowRun()
	const running = state.status === 'running'
	const definition = parameters.user_input_form

	// The inputs start with the link's values (`?<variable>=<gzip>`, spec §4.7), else their defaults (the
	// chat's resolver, for a page without conversations). Once: React StrictMode runs effects twice.
	const seeded = useRef(false)
	useEffect(() => {
		if (seeded.current) return
		seeded.current = true
		const urlValues = decodeLinkInputs(
			definition,
			variable => searchParams.get(variable),
			(variable, error) =>
				toast.error(
					t('form.decompress_failed', {
						name: variable,
						error: error instanceof Error ? error.message : String(error),
					}),
				),
		)
		form.setFieldsValue(
			resolveInitialInputs({
				form: definition,
				urlValues,
				globalParams: {},
				conversationInputs: {},
				isTemp: true,
				allowUpdate: false,
				seeded: false,
			}),
		)
	}, [definition, form, searchParams, t, toast])

	const start = async () => {
		try {
			await form.validateFields()
		} catch {
			// The form shows which inputs are missing.
			return
		}
		void run(form.getFieldsValue(true))
	}

	return (
		<UserShell
			title={
				<Typography.Text
					strong
					ellipsis
				>
					{site.title || app.name}
				</Typography.Text>
			}
		>
			<div className={styles.fill}>
				<Row gutter={[token.margin, token.margin]}>
					<Col
						xs={24}
						md={12}
					>
						{/* The padding sits on a wrapper: antd's Flex resets its own padding. */}
						<div className={styles.pane}>
							<Flex
								vertical
								gap="middle"
							>
								<AppInfoBlock />
								<InputsForm
									form={form}
									definition={definition}
									disabled={running}
								/>
								<Flex
									gap="small"
									justify="flex-end"
								>
									{running && <Button onClick={stop}>{t('workflow.stop')}</Button>}
									<Button
										type="primary"
										loading={running}
										onClick={() => void start()}
									>
										{t('workflow.run')}
									</Button>
								</Flex>
							</Flex>
						</div>
					</Col>
					<Col
						xs={24}
						md={12}
					>
						<div className={styles.pane}>
							<RunResult
								state={state}
								workflowApp={app.mode === 'workflow'}
							/>
						</div>
					</Col>
				</Row>
			</div>
		</UserShell>
	)
}
