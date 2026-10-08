import * as z from 'zod'

/**
 * Account fields shared by the action schemas and the antd form rules (client-safe). Eight characters minimum,
 * as every form had; the maximum bounds the input, since bcrypt reads only the first 72 bytes (decision f).
 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export const passwordField = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)
export const emailField = z.email().max(255)
export const nameField = z.string().trim().min(1).max(255)
