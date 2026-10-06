import { createServer } from 'node:http'

import { handle } from './router'

const port = Number(process.env.E2E_DIFY_STUB_PORT ?? 5399)

createServer((req, res) => {
	handle(req, res, port).catch(error => {
		console.error('stub error', error)
		if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
		res.end(JSON.stringify({ code: 'internal_error', message: String(error), status: 500 }))
	})
}).listen(port, '127.0.0.1', () =>
	console.log(
		`dify stub listening on http://127.0.0.1:${port}/v1 (+ /agent, /chatflow, /workflow, /completion)`,
	),
)
