import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/*
 * The PostgreSQL services as the compose files declare them (Part 0 spec §2), pinned as text, as the baseline's SQL is
 * pinned in __tests__/db-baseline.test.ts. Compose itself validates the files (`docker compose config --quiet`, Task 3);
 * these cases pin the values the image's docs require, which a slip would break without an error.
 */
const read = (file: string) => readFileSync(file, 'utf8')

describe.each(['docker-compose.local.yml', 'docker-compose.e2e.yml', 'docker-compose.yml'])(
	'%s',
	file => {
		const text = read(file)

		it('runs PostgreSQL 18 under the service name postgres', () => {
			expect(text).toMatch(/^ {2}postgres:\n {4}image: postgres:18\n/m)
		})

		// docker-library postgres, "PGDATA": the 18 images declare VOLUME /var/lib/postgresql; a mount at
		// /var/lib/postgresql/data applies to 17 and below only.
		it('keeps the data at /var/lib/postgresql, never at the path of 17 and below', () => {
			expect(text).toMatch(/^ {6}- (pgdata:)?\/var\/lib\/postgresql$/m)
			expect(text).not.toContain('/var/lib/postgresql/data')
		})

		// The image's docs, "Caveats": the default 64 MB /dev/shm can fail with "could not resize shared memory segment".
		it('gives the server 128 MB of shared memory', () => {
			expect(text).toMatch(/^ {4}shm_size: 128mb$/m)
		})

		// Compose "Control startup order" example, with -h: the first-start server listens on the socket only (DV 7d).
		it('reports healthy only once the server answers on TCP', () => {
			expect(text).toContain(
				"test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}']",
			)
		})

		it('names neither MySQL nor the old product', () => {
			expect(text.toLowerCase()).not.toContain('mysql')
			expect(text).not.toContain('dify-app-hub')
		})
	},
)

describe.each(['docker-compose.local.yml', 'docker-compose.yml'])('%s', file => {
	const text = read(file)

	// Compose "Control startup order": `condition: service_healthy` waits for the healthcheck to pass.
	it('starts the hub only once PostgreSQL is healthy', () => {
		expect(text).toMatch(/depends_on:\n {6}postgres:\n {8}condition: service_healthy/)
	})

	it('keeps the data in the named volume pgdata', () => {
		expect(text).toMatch(/^ {6}- pgdata:\/var\/lib\/postgresql$/m)
		expect(text).toMatch(/^volumes:\n {2}pgdata:/m)
	})
})

describe('docker-compose.e2e.yml', () => {
	const text = read('docker-compose.e2e.yml')

	it('keeps the throwaway database in tmpfs, published on 127.0.0.1:5433 with the test credentials', () => {
		expect(text).toMatch(/^ {4}tmpfs:\n {6}- \/var\/lib\/postgresql$/m)
		expect(text).toContain("- '127.0.0.1:5433:5432'")
		expect(text).toMatch(/POSTGRES_DB: e2e\n {6}POSTGRES_USER: e2e\n {6}POSTGRES_PASSWORD: e2e\n/)
	})
})

describe('docker-compose.dev.yml', () => {
	it("carries the hub's names", () => {
		const text = read('docker-compose.dev.yml')
		expect(text).toContain('container_name: ai-app-hub-self-deploy')
		expect(text).toContain('ai-app-hub-network')
		expect(text).not.toContain('dify-app-hub')
	})
})
