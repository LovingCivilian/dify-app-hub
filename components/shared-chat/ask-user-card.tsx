'use client'

import {
	CheckOutlined,
	CloseOutlined,
	EditOutlined,
	EnterOutlined,
	LeftOutlined,
	RightOutlined,
} from '@ant-design/icons'
import { Button, Card, Divider, Flex, Input, Tag, theme, Typography } from 'antd'
import type { InputRef } from 'antd'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ASK_USER_ANSWER_MAX, type AskUserAnswer, type AskUserQuestion } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

import styles from './ask-user-card.module.css'
import {
	answerStep,
	canGoBack,
	canGoForward,
	DIGIT_KEYS,
	dismissSteps,
	optionIndexOfKey,
	questionSteps,
	SKIPPED,
	stepChoice,
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
 * The hub's `ask_user` card above the composer (spec §6.2) in the layout of Claude's question prompt (owner, 2026-10-15),
 * on antd: the question as the Card's title, `‹ 1 of 3 ›` across the calls (plan call P4) and an icon-only Dismiss (the
 * rest) in its `extra`; the options as full-width text Buttons with their digit key as a Tag; under a Divider, a
 * borderless Input for a free answer when the question allows one, and Skip (this question). ‹ goes back to change an
 * earlier answer until the last step has one; then, like the full-stack template's `onComplete`, the card hands every
 * call over at once. The card starts over when the set of calls changes: React resets a component's state when its
 * `key` changes (react.dev "Resetting all state when a prop changes").
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
	const { token } = theme.useToken()
	const titleId = useId()
	const steps = useMemo(() => questionSteps(questions), [questions])
	// One answer per step, from the first (the template's answersRef; ask-user-steps.ts keeps it a prefix).
	const [given, setGiven] = useState<AskUserAnswer[]>([])
	// The step on show: the first one without an answer, or an earlier one the user went back to.
	const [current, setCurrent] = useState(0)
	// Handed over, the calls leave the card (their answers are in the draft) or their request runs (`disabled`). A
	// finished card still shown while nothing runs had its answers sent and refused, so it asks again (plan call P13:
	// after a failed send the cards start over).
	const answers = !disabled && given.length >= steps.length ? [] : given
	const index = Math.min(current, answers.length)
	const step = steps[index]

	const apply = ({ answers: next, complete, next: nextIndex }: StepResult) => {
		setGiven(next)
		setCurrent(nextIndex)
		if (complete) onAnswer(complete)
	}

	if (!step)
		return (
			<Card size="small">
				<Tag color="success">{t('shared_chat.answer.answered')}</Tag>
			</Card>
		)

	const position = { current: index + 1, total: steps.length }
	return (
		<Card
			size="small"
			title={
				<span id={titleId}>{step.question?.question ?? t('shared_chat.ask_user.invalid')}</span>
			}
			// antd Card semantic DOM (`antd semantic Card`): the title is an ellipsis by default; the question wraps
			// instead, and the header gets block padding so a wrapped title keeps the header's spacing. The body's inline
			// padding is narrow so the option rows' highlight reaches near the card's edges while their badges line up
			// with the title (the template's one column: QuestionPrompt's `px-4` on every row).
			styles={{
				header: { paddingBlock: token.paddingXS },
				title: { whiteSpace: 'normal', overflowWrap: 'anywhere' },
				extra: { alignSelf: 'flex-start' },
				body: { paddingBlock: token.paddingXS, paddingInline: token.paddingXXS },
			}}
			extra={
				<Flex
					align="center"
					gap={token.marginXXS}
				>
					{steps.length > 1 && (
						// "Question 1 of 3" names the pager for screen readers; the text shows "1 of 3".
						<Flex
							role="group"
							aria-label={t('shared_chat.ask_user.progress', position)}
							align="center"
							gap={token.marginXXS}
						>
							<Button
								type="text"
								size="small"
								icon={<LeftOutlined className={styles.directional} />}
								aria-label={t('shared_chat.ask_user.previous')}
								disabled={disabled || !canGoBack(index)}
								onClick={() => setCurrent(index - 1)}
							/>
							<Typography.Text type="secondary">
								{t('shared_chat.ask_user.position', position)}
							</Typography.Text>
							<Button
								type="text"
								size="small"
								icon={<RightOutlined className={styles.directional} />}
								aria-label={t('shared_chat.ask_user.next')}
								disabled={disabled || !canGoForward(index, answers)}
								onClick={() => setCurrent(index + 1)}
							/>
						</Flex>
					)}
					<Button
						type="text"
						size="small"
						icon={<CloseOutlined />}
						aria-label={t('shared_chat.ask_user.dismiss')}
						disabled={disabled}
						onClick={() => apply(dismissSteps(questions, answers))}
					/>
				</Flex>
			}
		>
			<QuestionStep
				// Each step starts from its own answer (React: a new `key` resets the state).
				key={index}
				question={step.question}
				answer={answers[index]}
				labelId={titleId}
				disabled={disabled}
				onCommit={answer => apply(answerStep(questions, answers, index, answer))}
			/>
		</Card>
	)
}

interface QuestionStepProps {
	/** null: the call's arguments are invalid (plan call P3); the step offers Dismiss only. */
	question: AskUserQuestion | null
	/** The step's answer when the user went back to it. */
	answer: AskUserAnswer | undefined
	/** The id of the card's title, which names the options. */
	labelId: string
	disabled: boolean
	onCommit: (answer: AskUserAnswer) => void
}

function QuestionStep({ question, answer, labelId, disabled, onCommit }: QuestionStepProps) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const options = question?.options ?? []
	const choice = question ? stepChoice(question, answer) : { option: null, text: '' }
	const [text, setText] = useState(choice.text)
	// The option that takes the Tab stop (roving tabindex): the chosen one when the user came back, else the first.
	const [active, setActive] = useState(choice.option ?? 0)
	const opening = choice.option ?? 0
	const groupRef = useRef<HTMLElement>(null)
	const optionsRef = useRef<HTMLElement>(null)
	const inputRef = useRef<InputRef>(null)
	const optionRefs = useRef<(HTMLElement | null)[]>([])

	// The template focuses each new question so the keys work at once: its option (the chosen one when the user came
	// back), the free-answer field when there is nothing to pick, else the group (React: focusing a DOM node is an
	// Effect's work, synchronising with the DOM).
	useEffect(() => {
		if (question && question.options.length > 0) optionRefs.current[opening]?.focus()
		else if (question?.allow_custom) inputRef.current?.focus()
		else groupRef.current?.focus()
	}, [question, opening])

	const submitText = () => {
		// Plan call P3: a free answer is at most ASK_USER_ANSWER_MAX characters (the Input's maxLength; the slice is the
		// same cap for a value that got past it).
		const value = text.trim().slice(0, ASK_USER_ANSWER_MAX)
		if (value) onCommit({ answer: value, skipped: false })
	}
	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		// Digits typed into the free-answer field are text; a shortcut with a modifier is the browser's.
		if (disabled || !question || event.target instanceof HTMLInputElement) return
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const option = optionIndexOfKey(event.key, options.length)
		if (option === null) return
		event.preventDefault()
		onCommit({ answer: options[option], skipped: false })
	}
	// WAI-ARIA APG Toolbar pattern, vertical (https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) with a roving tabindex
	// (APG "Developing a Keyboard Interface", https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
	// #kbd_roving_tabindex): Down and Up move the focus to the next and previous option without wrapping, Home and End
	// to the first and last; the options are one Tab stop. Enter (and Space) on an option is the native button's click.
	const onOptionsKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const last = options.length - 1
		const target =
			event.key === 'ArrowDown'
				? Math.min(active + 1, last)
				: event.key === 'ArrowUp'
					? Math.max(active - 1, 0)
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? last
							: null
		if (target === null) return
		event.preventDefault()
		optionRefs.current[target]?.focus()
	}

	const skip = (
		<Button
			size="small"
			disabled={disabled}
			onClick={() => onCommit(SKIPPED)}
		>
			{t(question ? 'shared_chat.ask_user.skip' : 'shared_chat.answer.dismiss')}
		</Button>
	)

	return (
		<Flex
			ref={groupRef}
			vertical
			role="group"
			aria-label={t('shared_chat.ask_user.label')}
			tabIndex={-1}
			onKeyDown={onKeyDown}
		>
			{options.length > 0 && (
				<>
					<Flex
						vertical
						gap={token.marginXXS}
						ref={optionsRef}
						// A toolbar, not a radiogroup or listbox: a click answers at once, as a toolbar's buttons act, and the APG
						// Toolbar pattern gives the arrow keys; the earlier answer is `aria-current`, not a checked state.
						role="toolbar"
						aria-orientation="vertical"
						aria-labelledby={labelId}
						className={styles.options}
						onKeyDown={onOptionsKeyDown}
					>
						{options.map((option, optionIndex) => (
							<Button
								key={optionIndex}
								ref={element => {
									optionRefs.current[optionIndex] = element
								}}
								type="text"
								block
								// The digit key as a small rounded badge (Tag's default `variant="filled"`, no border; `bordered`
								// is deprecated). Hidden from the accessible name, which stays the option's text.
								icon={
									optionIndex < DIGIT_KEYS ? (
										<Tag
											variant="filled"
											aria-hidden
											className={styles.badge}
										>
											{optionIndex + 1}
										</Tag>
									) : undefined
								}
								tabIndex={optionIndex === active ? 0 : -1}
								// The answer given when the user came back to this step (✓).
								aria-current={choice.option === optionIndex ? 'true' : undefined}
								disabled={disabled}
								className={styles.option}
								// antd Button semantic DOM (`antd semantic Button`): a long option wraps, so the row grows; the inline
								// padding puts the badge under the title (body padding + border + padding = the header's paddingSM).
								styles={{
									root: {
										height: 'auto',
										paddingBlock: token.paddingXS,
										paddingInline: token.paddingXS - token.lineWidth,
									},
								}}
								onFocus={() => setActive(optionIndex)}
								// The focus follows a moving mouse while an option has it, so the row showing ↵ is the one Enter picks;
								// the free answer and the pager keep theirs. ADR-0002: no antd or WAI-ARIA APG API covers this (the APG
								// Toolbar pattern moves the focus by keyboard only), so it follows reference projects, as the owner's
								// rule allows when the docs are silent: Radix Menu's item (`@radix-ui/react-menu` 2.1.24,
								// `dist/index.mjs`, `MenuItem`: `onPointerMove` for a mouse, then `item.focus({ preventScroll: true })`)
								// and the full-stack template's `QuestionPrompt` (`onMouseEnter={() => setFocusIdx(i)}`). On pointer
								// move, as Radix does: a row that slides under a resting pointer (‹ makes the card taller) gets
								// `mouseenter` but must not take the focus.
								onPointerMove={event => {
									const row = event.currentTarget
									if (event.pointerType !== 'mouse' || row === document.activeElement) return
									if (optionsRef.current?.contains(document.activeElement))
										row.focus({ preventScroll: true })
								}}
								onClick={() => onCommit({ answer: option, skipped: false })}
							>
								<span className={styles.row}>
									<span className={styles.text}>{option}</span>
									{choice.option === optionIndex && (
										<span className={styles.chosen}>
											<CheckOutlined aria-hidden />
										</span>
									)}
									<span className={styles.enter}>
										<EnterOutlined aria-hidden />
									</span>
								</span>
							</Button>
						))}
					</Flex>
					<Divider size="small" />
				</>
			)}
			<Flex
				align="center"
				justify="flex-end"
				gap={token.marginXS}
				// Flex resets its own padding (ADR-0020), so Skip's inset from the card's edge goes through `style`.
				style={{ paddingInlineEnd: token.paddingXS }}
			>
				{question?.allow_custom && (
					<Input
						ref={inputRef}
						variant="borderless"
						// ✎ lines up with the option badges and the title.
						style={{ paddingInline: token.paddingXS - token.lineWidth }}
						prefix={
							<span className={styles.muted}>
								<EditOutlined aria-hidden />
							</span>
						}
						suffix={
							<Button
								type="text"
								size="small"
								icon={<EnterOutlined className={styles.directional} />}
								aria-label={t('shared_chat.ask_user.send')}
								disabled={disabled || !text.trim()}
								onClick={submitText}
							/>
						}
						value={text}
						maxLength={ASK_USER_ANSWER_MAX}
						placeholder={t('shared_chat.ask_user.custom_placeholder')}
						disabled={disabled}
						onChange={event => setText(event.target.value)}
						onPressEnter={submitText}
					/>
				)}
				{skip}
			</Flex>
		</Flex>
	)
}
