import { apiBaseSchema } from '@/lib/providers/dify/schema'

/**
 * The API base field's antd Rule `validator` (Form §Rule: "Customize validation rule. Accept Promise as return"):
 * Dify's own settings schema (lib/providers/dify/schema.ts), so the browser and the server agree on every value. A
 * Docker service name such as http://api:5001/v1 passes (antd's `type: 'url'` would refuse it); a scheme-less, ftp://
 * or protocol-relative base does not. An empty value resolves: the field's `required` rule words that case.
 */
export const validateApiBase =
	(message: string) =>
	(_rule: unknown, value: unknown): Promise<void> =>
		!value || apiBaseSchema.safeParse(value).success
			? Promise.resolve()
			: Promise.reject(new Error(message))
