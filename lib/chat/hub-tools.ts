import 'server-only'

import type { Tool } from '@ag-ui/core'
import * as z from 'zod'

import { ASK_USER_TOOL_NAME, askUserArgsSchema } from './ask-user'

/*
 * The hub's own tools (Part 2 spec §6.2; 2b's plan call P1): the definitions a run advertises in
 * `RunAgentInput.tools`, the application's list (AG-UI 1.0 "Tool Calls", Frontend tools: "the agent proposes a call,
 * the application executes it"). The chat adapter's `hubTools` names those an app advertises. Server-only: only the
 * run sends them.
 */

/** The names of the hub's tools (P1). */
export type HubToolName = typeof ASK_USER_TOOL_NAME

/**
 * The template's `ask_user` docstring (`backend/app/agents/assistant.py`, release 0.2.21) adapted to AG-UI's round trip:
 * the template's run waits on its socket, while an AG-UI frontend call ends the run and its answer comes back in the next
 * run's messages (spec §6.2; AG-UI 1.0 "Tool Calls", Frontend tools: "the answer can only cross a run boundary").
 */
const ASK_USER_DESCRIPTION = [
	'Ask the user one or more questions and get their answers.',
	"Use this when a decision or missing detail would materially change what you do next and you can't reasonably assume it. You may pass several questions at once — the user answers them one after another and you get all the answers back together (good for an intake/setup flow). You can also call this again later to follow up on what they said. Prefer answering directly when the request is already clear.",
	"Calling this tool ends your turn. The user answers in the chat, and their answers come back as this tool's result when the conversation continues, in the next turn: a Q/A transcript, with skipped questions marked.",
].join('\n\n')

/*
 * The arguments' JSON Schema, generated from askUserArgsSchema (zod 4 `z.toJSONSchema`), so its limits are the ones the
 * hub checks. `io: 'input'` describes what the agent sends: `options` and `allow_custom` optional with their defaults,
 * and no `additionalProperties: false`, since the schema drops unknown keys (zod 4 "JSON Schema": "When converting to
 * JSON Schema in "input" mode, additionalProperties is not set"). The `$schema` key is left out: AG-UI's "Tool
 * Structure" (concepts/tools) is `{ type, properties, required }`, as the template's Pydantic schema is.
 */
const { $schema: _dialect, ...askUserParameters } = z.toJSONSchema(askUserArgsSchema, {
	io: 'input',
})

/** AG-UI 1.0 `Tool` (`@ag-ui/core` 1.0.2: name, description, parameters as a JSON Schema): spec §6.2, P2. */
export const ASK_USER_TOOL: Tool = {
	name: ASK_USER_TOOL_NAME,
	description: ASK_USER_DESCRIPTION,
	parameters: askUserParameters,
}

const HUB_TOOLS: Record<HubToolName, Tool> = { [ASK_USER_TOOL_NAME]: ASK_USER_TOOL }

/** The named tools' definitions in the order given (spec §6.2: `[ASK_USER_TOOL]` while askUser is on, else `[]`). */
export const hubToolDefinitions = (names: readonly HubToolName[]): Tool[] =>
	names.map(name => HUB_TOOLS[name])
