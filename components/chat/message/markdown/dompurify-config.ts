import type { Config } from 'dompurify'

/**
 * Minimal, explicit sanitizer extension for Dify answers (x-markdown skill: "keep dompurifyConfig explicit
 * and minimal"). Defaults stay: DOMPurify already allows img, video, form controls, details/summary and
 * data-* attributes; it strips `target` and unknown tags such as <think> unless added here.
 *
 * SANITIZE_NAMED_PROPS (DOMPurify README, "enforce strict DOM Clobbering protection via namespace isolation"):
 * every `id` and `name` is kept with a `user-content-` prefix. Without it the default protection removes a
 * `name` that matches a document or form property, so a Dify form field such as <input name="name"> would
 * lose its name; `formFieldName` recovers the name Dify gave it.
 */
export const difyDompurifyConfig: Config = {
	ADD_TAGS: ['think'],
	ADD_ATTR: ['target', 'controls'],
	SANITIZE_NAMED_PROPS: true,
}

/** The prefix DOMPurify gives isolated `id`/`name` values (README, option SANITIZE_NAMED_PROPS). */
const NAMED_PROPS_PREFIX = 'user-content-'

/** A form control's name as Dify wrote it, from the sanitised (prefixed) attribute. */
export const formFieldName = (sanitised?: string) =>
	sanitised?.startsWith(NAMED_PROPS_PREFIX) ? sanitised.slice(NAMED_PROPS_PREFIX.length) : sanitised
