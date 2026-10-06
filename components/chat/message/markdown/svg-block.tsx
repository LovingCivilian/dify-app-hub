'use client'

import { SVG } from '@svgdotjs/svg.js'
import { Alert } from 'antd'
import DOMPurify from 'dompurify'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** ```svg fenced blocks: sanitised with DOMPurify, drawn with svg.js, never wider than the original. */
export const SvgBlock = ({ code }: { code: string }) => {
	const { t } = useTranslation()
	const svgRef = useRef<HTMLDivElement>(null)
	const [failed, setFailed] = useState(false)
	const [windowSize, setWindowSize] = useState({
		width: typeof window !== 'undefined' ? window.innerWidth : 0,
		height: typeof window !== 'undefined' ? window.innerHeight : 0,
	})

	useEffect(() => {
		const handleResize = () => {
			setWindowSize({ width: window.innerWidth, height: window.innerHeight })
		}

		window.addEventListener('resize', handleResize)
		return () => window.removeEventListener('resize', handleResize)
	}, [])

	useEffect(() => {
		if (svgRef.current) {
			try {
				svgRef.current.innerHTML = ''
				const draw = SVG().addTo(svgRef.current)

				const parser = new DOMParser()
				const svgDoc = parser.parseFromString(code, 'image/svg+xml')
				const svgElement = svgDoc.documentElement

				if (!(svgElement instanceof SVGElement)) throw new Error('Invalid SVG content')

				const originalWidth = Number.parseInt(svgElement.getAttribute('width') || '400', 10)
				const originalHeight = Number.parseInt(svgElement.getAttribute('height') || '600', 10)
				draw.viewbox(0, 0, originalWidth, originalHeight)

				svgRef.current.style.width = `${Math.min(originalWidth, 298)}px`

				draw.svg(DOMPurify.sanitize(code))
				setFailed(false)
			} catch (error) {
				console.warn('Error rendering SVG:', error)
				setFailed(true)
			}
		}
	}, [code, windowSize])

	return (
		<>
			{failed && (
				<Alert
					type="warning"
					title={t('message.svg_invalid')}
				/>
			)}
			<div
				ref={svgRef}
				style={{
					maxHeight: '80vh',
					display: failed ? 'none' : 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					wordBreak: 'break-word',
					whiteSpace: 'normal',
					margin: '0 auto',
				}}
			/>
		</>
	)
}

export default SvgBlock
