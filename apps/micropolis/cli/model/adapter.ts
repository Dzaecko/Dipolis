/** JSON values used in provider-neutral tool parameter schemas. */
export type JSONValue = string | number | boolean | null | JSONValue[] | JSONObject;
export type JSONObject = { [key: string]: JSONValue };

export interface ToolDefinition {
	/** Exact command BusID, e.g. "budget.set-funding", not a provider function name. */
	name: string;
	description: string;
	parameters: JSONObject;
}

export interface ToolCall {
	id: string;
	/** Exact BusID for known tools; unknown provider names remain unknown. */
	name: string;
	/** Parsed JSON, or the original string if JSON parsing failed. Validate in the runner. */
	arguments: unknown;
}

export type ChatMessage =
	| { role: 'system' | 'user'; content: string }
	| { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
	| { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ChatRequest {
	messages: ChatMessage[];
	tools: ToolDefinition[];
	signal?: AbortSignal;
	/** Called before each attempt; contains no credentials or request content. */
	onRequestMetadata?: (metadata: { requestBytes: number; attempts: number }) => void;
	onError?: (error: AdapterError) => void;
}

export interface ChatResponse {
	content: string;
	toolCalls: ToolCall[];
	usage?: { inputTokens: number; outputTokens: number };
	usageReported?: boolean;
	/** UTF-8 bytes of the exact serialized request body, not headers. */
	requestBytes?: number;
}

export type AdapterErrorKind = 'http' | 'timeout' | 'network' | 'protocol' | 'cancelled' | 'request';

export interface AdapterErrorDetails {
	status?: number;
	responseText?: string;
	attempts?: number;
	requestBytes?: number;
}

/** Only sanitized messages/details belong here; never attach a raw provider error as cause. */
export class AdapterError extends Error implements AdapterErrorDetails {
	readonly kind: AdapterErrorKind;
	status?: number;
	responseText?: string;
	attempts?: number;
	requestBytes?: number;

	constructor(kind: AdapterErrorKind, message: string, details: AdapterErrorDetails = {}) {
		super(message);
		this.name = kind === 'cancelled' ? 'AbortError' : 'AdapterError';
		this.kind = kind;
		Object.assign(this, details);
	}
}

export interface ChatAdapter {
	model: string;
	/** Latest successfully encoded request body size, when supported. */
	readonly requestBytes?: number;
	chat(request: ChatRequest): Promise<ChatResponse>;
}