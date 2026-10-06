import {
	ApiOutlined,
	AppstoreOutlined,
	BranchesOutlined,
	CodeOutlined,
	DatabaseOutlined,
	FlagOutlined,
	ForkOutlined,
	MergeCellsOutlined,
	MessageOutlined,
	PlayCircleOutlined,
	RetweetOutlined,
	RobotOutlined,
	ToolOutlined,
	UserOutlined,
} from '@ant-design/icons'

const ICONS: Record<string, typeof AppstoreOutlined> = {
	start: PlayCircleOutlined,
	end: FlagOutlined,
	answer: MessageOutlined,
	llm: RobotOutlined,
	'knowledge-retrieval': DatabaseOutlined,
	'question-classifier': BranchesOutlined,
	'if-else': ForkOutlined,
	code: CodeOutlined,
	'http-request': ApiOutlined,
	tool: ToolOutlined,
	'human-input': UserOutlined,
	'variable-aggregator': MergeCellsOutlined,
	iteration: RetweetOutlined,
	loop: RetweetOutlined,
}

/**
 * Dify node type → antd icon; unknown types get the generic app icon. Decorative: the node's title
 * sits next to it, so the icon's default English `aria-label` (its own name) is hidden from readers.
 */
export default function WorkflowNodeIcon({ type }: { type: string }) {
	const Icon = ICONS[type] ?? AppstoreOutlined
	return <Icon aria-hidden />
}
