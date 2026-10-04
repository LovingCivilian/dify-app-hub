import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Key/value pairs of .env.e2e (comments and blank lines skipped). */
export const e2eEnv: Record<string, string> = Object.fromEntries(
	readFileSync(path.resolve(process.cwd(), '.env.e2e'), 'utf8')
		.split('\n')
		.filter(line => line.trim() && !line.trimStart().startsWith('#'))
		.map(line => {
			const i = line.indexOf('=')
			return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
		}),
)

export const baseURL = e2eEnv.NEXTAUTH_URL
export const stubPort = Number(e2eEnv.E2E_DIFY_STUB_PORT)
export const stubApiBase = `http://127.0.0.1:${stubPort}/v1`
