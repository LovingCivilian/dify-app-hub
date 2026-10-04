import { Spin, Tooltip } from 'antd'
import classNames from 'classnames'
import React from 'react'

interface IActionButtonProps {
	/**
	 * 标题
	 */
	title?: string
	/**
	 * 是否禁用
	 */
	disabled?: boolean
	/**
	 * 是否激活
	 */
	active?: boolean
	/**
	 * 激活时的颜色，默认主题色；点赞用 success，点踩用 danger
	 */
	activeColor?: 'primary' | 'success' | 'danger'
	/**
	 * 是否加载中
	 */
	loading?: boolean
	/**
	 * 点击事件
	 */
	onClick?: () => void
	/**
	 * 图标
	 */
	icon: React.ReactElement
}

// Tailwind 需要能静态扫描到完整类名，所以用字面量映射
const activeClassNames = {
	primary: '!text-primary',
	success: 'text-(color:--theme-success-color)!',
	danger: 'text-(color:--theme-danger-color)!',
}

/**
 * 操作按钮
 */
export default function ActionButton(props: IActionButtonProps) {
	const {
		title,
		disabled,
		icon,
		loading = false,
		active = false,
		activeColor = 'primary',
		onClick,
	} = props

	const Icon = React.cloneElement(icon, {
		// @ts-expect-error FIXME: React19 类型错误，待解决
		className: classNames({
			[activeClassNames[activeColor]]: active,
			'text-theme-text': true,
		}),
	})

	return (
		<div className="relative flex items-center">
			<Tooltip title={title}>
				<div
					className={classNames({
						'text-desc': disabled,
						'cursor-pointer hover:bg-gray-100 w-5 h-5 flex items-center justify-center rounded': true,
					})}
					onClick={() => {
						if (!disabled) {
							onClick?.()
						}
					}}
				>
					{Icon}
				</div>
			</Tooltip>
			{loading && (
				<Spin
					className="!absolute top-0 left-0 h-full w-full"
					spinning={loading}
				/>
			)}
		</div>
	)
}
