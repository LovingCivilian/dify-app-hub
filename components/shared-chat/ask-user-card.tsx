'use client'

import { CloseOutlined } from '@ant-design/icons'
import { Prompts } from '@ant-design/x'
import { Button, Card, Flex, Input, Space, Tag, Typography } from 'antd'
import type { InputRef } from 'antd'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ASK_USER_ANSWER_MAX, type AskUserAnswer } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

import {
	answerStep,
	DIGIT_KEYS,
	dismissSteps,
	optionIndexOfKey,
	questionSteps,
	SKIPPED,
	type StepResult,
} from './ask-user-steps'
import type { ToolAnswer } from './provider/ag-ui-chat-provider'

export interface AskUserCardProps {
	/** The open `ask_user` calls without an answer yet, in call order (TurnOpenItems.questions). */
	questions: ToolPart[]
	disabled: boolean
	/** Every call with its transcript ('' for an invalid call), in call order, once the last step has an answer. */
	onAnswer: (answers: ToolAnswer[]) => void
}

/**
 * The hub's `ask_user` card above the composer (spec §6.2), the full-stack template's `QuestionPrompt` on antd and X:
 * "Question 2 of 5" across the calls (plan call P4), the question, its options as X Prompts (`vertical`,
 * `onItemClick`), each with its digit key shown as a keyboard key (antd `Typography.Text keyboard`), an antd Input for a
 * free answer when the question allows one, Skip (this question) and an icon-only Dismiss (the rest). Like the
 * template's `onComplete`, it hands every call over at once when its last step has an answer. The card starts over
 * when the set of calls changes: React resets a component's state when its `key` changes (react.dev "Resetting all
 * state when a prop changes").
 */
export default function AskUserCard({ questions, disabled, onAnswer }: AskUserCardProps) {
	if (!questions.length) return null
	return (
		<QuestionStepper
			key={questions.map(call => call.toolCallId).join(' ')}
			questions={questions}
			disabled={disabled}
			onAnswer={onAnswer}
		/>
	)
}

function QuestionStepper({ questions, disabled, onAnswer }: AskUserCardProps) {
	const { t } = useTranslation()
	const steps = useMemo(() => questionSteps(questions), [questions])
	// One answer per step, from the first (the template's answersRef); the current step is the next one.
	const [given, setGiven] = useState<AskUserAnswer[]>([])
	const [text, setText] = useState('')
	const groupRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<InputRef>(null)
	// Handed over, the calls leave the card (their answers are in the draft) or their request runs (`disabled`). A
	// finished card still shown while nothing runs had its answers sent and refused, so it asks again (plan call P13:
	// after a failed send the cards start over).
	const progress = !disabled && given.length >= steps.length ? [] : given
	const index = progress.length
	const question = steps[index]?.question

	// The template focuses each new question: the free-answer field when there is nothing to pick, else the group, so
	// the digit keys work at once (React: focusing a DOM node is an Effect's work, synchronising with the DOM).
	useEffect(() => {
		const current = steps[index]?.question
		if (current && current.options.length === 0 && current.allow_custom) inputRef.current?.focus()
		else groupRef.current?.focus()
	}, [steps, index])

	const apply = ({ answers, complete }: StepResult) => {
		setGiven(answers)
		setText('')
		if (complete) onAnswer(complete)
	}
	const commit = (answer: AskUserAnswer) => apply(answerStep(questions, progress, answer))
	const submitText = () => {
		// Plan call P3: a free answer is at most ASK_USER_ANSWER_MAX characters (the Input's maxLength; the slice is the
		// same cap for a value that got past it).
		const answer = text.trim().slice(0, ASK_USER_ANSWER_MAX)
		if (answer) commit({ answer, skipped: false })
	}
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Digits typed into the free-answer field are text; a shortcut with a modifier is the browser's.
		if (disabled || !question || event.target instanceof HTMLInputElement) return
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const option = optionIndexOfKey(event.key, question.options.length)
		if (option === null) return
		event.preventDefault()
		commit({ answer: question.options[option], skipped: false })
	}

	if (index >= steps.length)
		return (
			<Card size="small">
				<Tag color="success">{t('shared_chat.answer.answered')}</Tag>
			</Card>
		)

	return (
		<Card
			size="small"
			title={
				steps.length > 1
					? t('shared_chat.ask_user.progress', { current: index + 1, total: steps.length })
					: undefined
			}
			extra={
				<Button
					type="text"
					size="small"
					icon={<CloseOutlined />}
					aria-label={t('shared_chat.ask_user.dismiss')}
					disabled={disabled}
					onClick={() => apply(dismissSteps(questions, progress))}
				/>
			}
		>
			<div
				ref={groupRef}
				role="group"
				aria-label={t('shared_chat.ask_user.label')}
				tabIndex={-1}
				onKeyDown={onKeyDown}
			>
				<Flex
					vertical
					gap="small"
				>
					{question ? (
						<>
							<Typography.Text strong>{question.question}</Typography.Text>
							{question.options.length > 0 && (
								<Prompts
									vertical
									items={question.options.map((option, optionIndex) => ({
										key: String(optionIndex),
										label: option,
										icon:
											optionIndex < DIGIT_KEYS ? (
												<Typography.Text keyboard>{optionIndex + 1}</Typography.Text>
											) : undefined,
										disabled,
									}))}
									onItemClick={({ data }) =>
										commit({ answer: question.options[Number(data.key)], skipped: false })
									}
								/>
							)}
							{question.allow_custom && (
								<Space.Compact block>
									<Input
										ref={inputRef}
										value={text}
										maxLength={ASK_USER_ANSWER_MAX}
										placeholder={t('shared_chat.ask_user.custom_placeholder')}
										disabled={disabled}
										onChange={event => setText(event.target.value)}
										onPressEnter={submitText}
									/>
									<Button
										type="primary"
										disabled={disabled || !text.trim()}
										onClick={submitText}
									>
										{t('shared_chat.ask_user.send')}
									</Button>
								</Space.Compact>
							)}
							<Flex justify="flex-end">
								<Button
									size="small"
									disabled={disabled}
									onClick={() => commit(SKIPPED)}
								>
									{t('shared_chat.ask_user.skip')}
								</Button>
							</Flex>
						</>
					) : (
						<>
							<Typography.Text type="secondary">
								{t('shared_chat.ask_user.invalid')}
							</Typography.Text>
							<Flex justify="flex-end">
								<Button
									size="small"
									disabled={disabled}
									onClick={() => commit(SKIPPED)}
								>
									{t('shared_chat.answer.dismiss')}
								</Button>
							</Flex>
						</>
					)}
				</Flex>
			</div>
		</Card>
	)
}
