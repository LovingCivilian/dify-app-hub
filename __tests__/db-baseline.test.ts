import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const folders = readdirSync('db/migrations')
const sql = () => readFileSync(path.join('db/migrations', folders[0]!, 'migration.sql'), 'utf8')

describe('the PostgreSQL baseline (Part 0 spec §3.3)', () => {
	it('is the only migration: the MySQL history is gone (a fresh start, decision 14)', () => {
		expect(folders).toHaveLength(1)
		expect(folders[0]).toMatch(/^\d{14}_baseline$/)
	})

	it('creates the six enum types for the static sets', () => {
		for (const type of [
			`CREATE TYPE "access_mode" AS ENUM('everyone', 'restricted');`,
			`CREATE TYPE "account_source" AS ENUM('local', 'ldap');`,
			`CREATE TYPE "membership_source" AS ENUM('manual', 'directory');`,
			`CREATE TYPE "sync_outcome" AS ENUM('running', 'succeeded', 'failed', 'empty', 'id_attribute_changed');`,
			`CREATE TYPE "sync_trigger" AS ENUM('schedule', 'startup', 'manual');`,
			`CREATE TYPE "user_role" AS ENUM('owner', 'admin', 'user');`,
		])
			expect(sql()).toContain(type)
	})

	it('creates the eleven tables, with their names kept', () => {
		for (const table of [
			'app_group_grants',
			'app_user_grants',
			'dify_apps',
			'directory_sync_runs',
			'instance_setting_files',
			'instance_settings',
			'password_reset_tokens',
			'user_group_directory_links',
			'user_group_members',
			'user_groups',
			'users',
		])
			expect(sql()).toContain(`CREATE TABLE "${table}" (`)
		expect(sql().match(/CREATE TABLE/g)).toHaveLength(11)
	})

	// PostgreSQL 18 "Indexes on Expressions": a unique index on lower(col1) "would prevent creation of rows whose col1
	// values differ only in case" (spec §3.4).
	it('keeps emails unique whatever their case', () => {
		expect(sql()).toContain('CREATE UNIQUE INDEX "users_email_key" ON "users" (lower("email"));')
	})

	// MySQL's collation compared group names without case too (Plan decision e).
	it('keeps group names unique whatever their case', () => {
		expect(sql()).toContain(
			'CREATE UNIQUE INDEX "user_groups_name_key" ON "user_groups" (lower("name"));',
		)
	})

	// PostgreSQL 18 "Partial Indexes", Example 11.3 (spec §3.4).
	it('allows one owner through a partial unique index', () => {
		expect(sql()).toContain(
			`CREATE UNIQUE INDEX "users_one_owner" ON "users" ("role") WHERE "role" = 'owner';`,
		)
	})

	// ADR-0029: a local account has a hub password and no directory key; a directory account has a key, the attribute
	// that produced it, and no hub password (spec §6, "the CHECKs"; __tests__/db/schema.db.test.ts refuses both live).
	it('ties the credentials to the account source through the users CHECK', () => {
		expect(sql()).toContain(
			`CONSTRAINT "users_source_credentials" CHECK (("source" = 'local' AND "password" IS NOT NULL AND "directory_id" IS NULL) OR ("source" = 'ldap' AND "password" IS NULL AND "directory_id" IS NOT NULL AND "directory_id_attribute" IS NOT NULL))`,
		)
	})

	// PostgreSQL 18 "Foreign Keys": "the declaration of a foreign key constraint does not automatically create an index
	// on the referencing columns"; InnoDB created one (spec §3.2).
	it('indexes the referencing columns that no primary key leads with', () => {
		for (const index of [
			'CREATE INDEX "app_group_grants_group_id_idx" ON "app_group_grants" ("group_id");',
			'CREATE INDEX "app_user_grants_user_id_idx" ON "app_user_grants" ("user_id");',
			'CREATE INDEX "user_group_members_user_id_idx" ON "user_group_members" ("user_id");',
		])
			expect(sql()).toContain(index)
	})

	it('cascades all eight foreign keys on delete', () => {
		expect(sql().match(/FOREIGN KEY/g)).toHaveLength(8)
		expect(
			sql().match(/FOREIGN KEY \("[a-z_]+"\) REFERENCES "[a-z_]+"\("[a-z_]+"\) ON DELETE CASCADE/g),
		).toHaveLength(8)
	})

	// DV 2a, 2b, 2c, 11: timestamptz without a precision, text, bytea; nothing MySQL-shaped is left.
	it('uses PostgreSQL types only', () => {
		expect(sql()).toContain('"created_at" timestamp with time zone DEFAULT now() NOT NULL')
		expect(sql()).not.toMatch(/timestamp\(|varchar|datetime|mediumblob|`/)
	})
})
