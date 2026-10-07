import { appInputSchema } from '@/app/(admin)/app-management/schemas'

/**
 * The API Base field's antd Rule `validator` (Form §Rule: "Customize validation rule. Accept Promise as return"):
 * the action's own URL check (appInputSchema), so the browser and the server agree on every value. A Docker
 * service name such as http://api:5001/v1 passes (antd's `type: 'url'` would refuse it); a scheme-less, ftp:// or
 * protocol-relative base does not. An empty value resolves: the field's `required` rule words that case.
 */
export const validateApiBase =
	(message: string) =>
	(_rule: unknown, value: unknown): Promise<void> =>
		!value || appInputSchema.shape.apiBase.safeParse(value).success
			? Promise.resolve()
			: Promise.reject(new Error(message))
