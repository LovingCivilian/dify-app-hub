import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

/** Key/value pairs of .env.e2e, parsed with Node's util.parseEnv (comments and blank lines skipped). */
export const e2eEnv = parseEnv(
	readFileSync(path.resolve(process.cwd(), '.env.e2e'), 'utf8'),
) as Record<string, string>

export const baseURL = e2eEnv.NEXTAUTH_URL
export const stubPort = Number(e2eEnv.E2E_DIFY_STUB_PORT)
export const stubApiBase = `http://127.0.0.1:${stubPort}/v1`
