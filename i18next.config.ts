import { defineConfig } from 'i18next-cli'

export default defineConfig({
	locales: ['en', 'zh'],
	extract: {
		input: [
			'app/**/*.{ts,tsx}',
			'components/**/*.{ts,tsx}',
			'hooks/**/*.{ts,tsx}',
			'lib/**/*.{ts,tsx}',
		],
		output: 'locales/{{language}}/{{namespace}}.json',
		defaultNS: 'translation',
		primaryLanguage: 'en',
		removeUnusedKeys: false,
	},
})
