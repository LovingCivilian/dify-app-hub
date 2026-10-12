/**
 * @type {import('lint-staged').Configuration}
 *
 * oxfmt runs with --no-error-on-unmatched-pattern ("Do not exit with error when pattern is unmatched", `oxfmt --help`):
 * a commit whose only staged file is one oxfmt ignores (pnpm-lock.yaml) would otherwise fail with "Expected at least
 * one target file".
 */
export default {
	'*.{js,jsx,ts,tsx,mjs,cjs}': ['oxlint', 'oxfmt --no-error-on-unmatched-pattern'],
	'*.{css,less}': ['oxfmt --no-error-on-unmatched-pattern'],
	'*.{json,jsonc,html,yml,yaml,md}': ['oxfmt --no-error-on-unmatched-pattern'],
}
