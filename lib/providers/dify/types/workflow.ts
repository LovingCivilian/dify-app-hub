import type { ResponseMode } from './chat'
import type { FileInput } from './files'

/** POST /completion-messages body without `user` (endpoint map §1.3). */
export interface CompletionRequest {
	inputs: Record<string, unknown>
	query?: string
	files?: FileInput[]
	response_mode?: ResponseMode
}

/** POST /workflows/run body without `user` (endpoint map §1.4). */
export interface WorkflowRunRequest {
	inputs: Record<string, unknown>
	files?: FileInput[]
	response_mode?: ResponseMode
}

/** GET /workflow/{workflow_run_id}/events query without `user`. */
export interface WorkflowEventsQuery {
	include_state_snapshot?: boolean
	continue_on_pause?: boolean
}

/** POST /text-to-audio body without `user` (endpoint map §1.6). */
export interface TextToAudioRequest {
	message_id?: string
	text?: string
	voice?: string
}
