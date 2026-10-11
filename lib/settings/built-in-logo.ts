import logo from '@/assets/images/logo.png'

import type { BrandImageSource } from './branding-rules'

/** The built-in brand image (settings spec §4.1), trimmed to what the browser needs (ADR-0020): no blurDataURL. */
export const BUILT_IN_LOGO: BrandImageSource = {
	src: logo.src,
	width: logo.width,
	height: logo.height,
}
