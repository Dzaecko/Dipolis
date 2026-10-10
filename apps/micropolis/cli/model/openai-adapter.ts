import { Buffer } from 'node:buffer';
import { AdapterError, type ChatAdapter, type ChatRequest, type ChatResponse, type JSONObject, type ToolCall } from './adapter';
export { AdapterError } from './adapter';

export interface OpenAIAdapterOptions {
	/** Full endpoint URL; HTTPS, or HTTP on a literal loopback host. */
	endpoint: string;
	/** Wire protocol; defaults to the existing Chat Completions API. */
	api?: 'chat' | 'responses';
	model: string;
	key: string;
	/** Integer milliseconds, 1–300000; defaults to 60000. */
	timeoutMs?: number;
	/** Optional integer token limit, 1–1000000; omitted from the request by default. */
	maxTokens?: number;
	/** Additional attempts, 0–5; defaults to 5. */
	maxRetries?: number;
	/** Initial exponential backoff in milliseconds, 0–60000; defaults to 1000. */
	retryDelayMs?: number;
	/** Optional provider-supported reasoning setting; omitted by default. */
	reasoningEffort?: string;
}

type Environment = Readonly<Record<string, string | undefined>>;
type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function required(value: unknown, variable: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${variable} is required`);
	}
	return value;
}

function boundedInteger(value: number, maximum: number, variable: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new Error(`${variable} must be an integer between 1 and ${maximum}`);
	}
	return value;
}

function optionalInteger(env: Environment, variable: string, maximum: number): number | undefined {
	const value = env[variable];
	if (value === undefined) return undefined;
	if (!/^\d+$/.test(value)) throw new Error(`${variable} must be a positive integer`);
	return boundedInteger(Number(value), maximum, variable);
}

function validateEndpoint(endpoint: string): string {
	let url: URL;
	try {
		if (!/^https?:\/\//i.test(endpoint)) throw new Error();
		url = new URL(endpoint);
	} catch {
		throw new Error('CITY_MODEL_ENDPOINT must be a full chat-completions URL');
	}
	const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' ||
		/^127(?:\.\d{1,3}){3}$/.test(url.hostname);
	if (url.username || url.password || url.hash ||
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
		throw new Error('CITY_MODEL_ENDPOINT requires HTTPS or HTTP loopback without credentials or a fragment');
	}
	// Do not append a path or infer a provider; the caller supplies the full endpoint.
	return url.href;
}

function functionName(busId: string): string {
	const name = busId.replace(/[.-]/g, '_');
	if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) {
		throw new Error('Invalid tool function name');
	}
	return name;
}

function serializeArguments(args: unknown): string {
	try {
		const encoded = typeof args === 'string' ? args : JSON.stringify(args);
		if (encoded === undefined) throw new Error();
		return encoded;
	} catch {
		throw new Error('Invalid tool arguments JSON');
	}
}

function encodeRequest(request: ChatRequest, model: string, maxTokens?: number, reasoningEffort?: string) {
	const originals = new Map<string, string>();
	const tools = request.tools.map((tool) => {
		const name = functionName(tool.name);
		if (originals.has(name)) throw new Error('Tool function name collision');
		originals.set(name, tool.name);
		return { type: 'function', function: { name, description: tool.description, parameters: tool.parameters } };
	});
	const messages = request.messages.map((message) => {
		if (message.role === 'tool') {
			return { role: 'tool', tool_call_id: message.toolCallId,
				...(request.tools.some(tool => tool.name === message.name) ? { name: functionName(message.name) } : {}),
				content: message.content };
		}
		if (message.role === 'assistant' && message.toolCalls?.length) {
			return {
				role: 'assistant', content: message.content,
				tool_calls: message.toolCalls.map((call) => ({
					id: call.id, type: 'function',
					function: {
						name: request.tools.some(tool => tool.name === call.name) ? functionName(call.name) : call.name,
						arguments: serializeArguments(call.arguments)
					}
				}))
			};
		}
		return { role: message.role, content: message.content };
	});
	let body: string;
	try {
		body = JSON.stringify({ model, messages, tools, ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
			...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }) });
	} catch {
		throw new Error('Invalid chat request JSON');
	}
	return { body, originals, requestBytes: Buffer.byteLength(body, 'utf8') };
}

function encodeResponses(request: ChatRequest, model: string, maxTokens?: number, reasoningEffort?: string) {
	const originals = new Map<string, string>();
	const tools = request.tools.map((tool) => {
		const name = functionName(tool.name);
		if (originals.has(name)) throw new Error('Tool function name collision');
		originals.set(name, tool.name);
		return { type: 'function', name, description: tool.description, parameters: tool.parameters, strict: false };
	});
	const input: RecordValue[] = [];
	for (const message of request.messages) {
		if (message.role === 'tool') {
			input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
		} else if (message.role === 'assistant') {
			if (message.providerItems !== undefined) {
				// Replay the complete opaque output instead of duplicating text or calls.
				input.push(...message.providerItems);
				continue;
			}
			if (message.content || !message.toolCalls?.length) input.push({ role: 'assistant', content: message.content });
			for (const call of message.toolCalls ?? []) {
				input.push({ type: 'function_call', call_id: call.id,
					name: request.tools.some(tool => tool.name === call.name) ? functionName(call.name) : call.name,
					arguments: serializeArguments(call.arguments) });
			}
		} else {
			input.push({ role: message.role, content: message.content });
		}
	}
	let body: string;
	try {
		body = JSON.stringify({ model, input, tools, store: false, include: ['reasoning.encrypted_content'],
			...(maxTokens === undefined ? {} : { max_output_tokens: maxTokens }),
			...(reasoningEffort === undefined ? {} : { reasoning: { effort: reasoningEffort } }) });
	} catch {
		throw new Error('Invalid responses request JSON');
	}
	return { body, originals, requestBytes: Buffer.byteLength(body, 'utf8') };
}

/** Offline estimate using the identical wire encoder; no key or endpoint needed. */
export function inspectRequestBytes(request: ChatRequest, model: string, maxTokens?: number): number {
	return encodeRequest(request, model, maxTokens).requestBytes;
}

function invalidResponse(): never {
	throw new AdapterError('protocol', 'Invalid model response');
}

function decodeResponse(value: unknown, originals: Map<string, string>): ChatResponse {
	if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length === 0) invalidResponse();
	const choice: unknown = value.choices[0];
	if (!isRecord(choice)) invalidResponse();
	if (choice.finish_reason === 'length') throw new AdapterError('protocol', 'Model response exceeded token limit');
	if (choice.finish_reason !== undefined && choice.finish_reason !== 'stop' && choice.finish_reason !== 'tool_calls') {
		invalidResponse();
	}
	const message = choice.message;
	if (!isRecord(message) || message.role !== 'assistant') invalidResponse();
	if (message.content !== null && typeof message.content !== 'string') invalidResponse();
	if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) invalidResponse();
	const calls: unknown[] = message.tool_calls ?? [];
	const ids = new Set<string>();
	const toolCalls = calls.map((call): ToolCall => {
		if (!isRecord(call) || typeof call.id !== 'string' || !call.id || ids.has(call.id) ||
			call.type !== 'function' || !isRecord(call.function) ||
			typeof call.function.name !== 'string' || !call.function.name ||
			typeof call.function.arguments !== 'string') invalidResponse();
		ids.add(call.id);
		let args: unknown = call.function.arguments;
		try { args = JSON.parse(call.function.arguments); } catch { /* Runner validates malformed JSON. */ }
		return { id: call.id, name: originals.get(call.function.name) ?? call.function.name, arguments: args };
	});
	if (message.content === null && toolCalls.length === 0) invalidResponse();
	const usage = isRecord(value.usage) ? value.usage : {};
	const validTokens = (tokens: unknown): tokens is number =>
		typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0;
	return { content: message.content ?? '', toolCalls,
		usage: { inputTokens: validTokens(usage.prompt_tokens) ? usage.prompt_tokens : 0,
			outputTokens: validTokens(usage.completion_tokens) ? usage.completion_tokens : 0 },
		usageReported: validTokens(usage.prompt_tokens) || validTokens(usage.completion_tokens) };
}

function decodeResponses(value: unknown, originals: Map<string, string>): ChatResponse {
	if (!isRecord(value) || value.status !== 'completed' || !Array.isArray(value.output)) invalidResponse();
	const text: string[] = [];
	const toolCalls: ToolCall[] = [];
	const ids = new Set<string>();
	const callIds = new Set<string>();
	for (const item of value.output) {
		if (!isRecord(item) || typeof item.type !== 'string' || !item.type) invalidResponse();
		if (item.type === 'function_call') {
			if (typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
				typeof item.call_id !== 'string' || !item.call_id || callIds.has(item.call_id) ||
				typeof item.name !== 'string' || !item.name || typeof item.arguments !== 'string') invalidResponse();
			ids.add(item.id);
			callIds.add(item.call_id);
			let args: unknown = item.arguments;
			try { args = JSON.parse(item.arguments); } catch { /* Runner validates malformed JSON. */ }
			toolCalls.push({ id: item.call_id, name: originals.get(item.name) ?? item.name, arguments: args });
		} else if (item.type === 'message') {
			if (item.role !== 'assistant' || !Array.isArray(item.content)) invalidResponse();
			for (const part of item.content) {
				if (!isRecord(part)) invalidResponse();
				if (part.type === 'output_text' && typeof part.text === 'string') text.push(part.text);
				else if (part.type === 'refusal' && typeof part.refusal === 'string') text.push(part.refusal);
				else invalidResponse();
			}
		}
	}
	const usage = isRecord(value.usage) ? value.usage : {};
	const validTokens = (tokens: unknown): tokens is number =>
		typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens >= 0;
	return { content: text.join('\n'), toolCalls, providerItems: value.output as JSONObject[],
		usage: { inputTokens: validTokens(usage.input_tokens) ? usage.input_tokens : 0,
			outputTokens: validTokens(usage.output_tokens) ? usage.output_tokens : 0 },
		usageReported: validTokens(usage.input_tokens) || validTokens(usage.output_tokens) };
}

/** No SDK, engine imports, logging, or provider-specific URL/model defaults. */
export class OpenAIAdapter implements ChatAdapter {
	readonly model: string;
	#endpoint: string;
	#key: string;
	#timeoutMs: number;
	#maxTokens: number | undefined;
	#maxRetries: number;
	#retryDelayMs: number;
	#requestBytes: number | undefined;
	#reasoningEffort: string | undefined;
	#api: 'chat' | 'responses';

	get requestBytes(): number | undefined { return this.#requestBytes; }

	constructor(options: OpenAIAdapterOptions) {
		this.#api = options.api ?? 'chat';
		if (this.#api !== 'chat' && this.#api !== 'responses') throw new Error('CITY_MODEL_API must be chat or responses');
		this.#endpoint = validateEndpoint(required(options.endpoint, 'CITY_MODEL_ENDPOINT'));
		if (this.#api === 'responses') {
			const url = new URL(this.#endpoint);
			url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '/responses')
				.replace(/\/openai\/v1\/?$/, '/openai/v1/responses');
			this.#endpoint = url.href;
		}
		this.model = required(options.model, 'CITY_MODEL_NAME');
		this.#key = required(options.key, 'CITY_MODEL_KEY');
		if (/[\r\n]/.test(this.#key)) throw new Error('Invalid CITY_MODEL_KEY');
		this.#timeoutMs = boundedInteger(options.timeoutMs ?? 60_000, 300_000, 'CITY_MODEL_TIMEOUT_MS');
		this.#maxTokens = options.maxTokens === undefined ? undefined :
			boundedInteger(options.maxTokens, 1_000_000, 'CITY_MODEL_MAX_TOKENS');
		this.#maxRetries = options.maxRetries ?? 5;
		this.#retryDelayMs = options.retryDelayMs ?? 1000;
		if (options.reasoningEffort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(options.reasoningEffort)) {
			throw new Error('CITY_MODEL_REASONING_EFFORT must be none, minimal, low, medium, high or xhigh');
		}
		this.#reasoningEffort = options.reasoningEffort;
		for (const [value, maximum, name] of [
			[this.#maxRetries, 5, 'CITY_MODEL_MAX_RETRIES'],
			[this.#retryDelayMs, 60_000, 'retryDelayMs']
		] as const) {
			if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
				throw new Error(`${name} must be an integer between 0 and ${maximum}`);
			}
		}
	}

	async chat(request: ChatRequest): Promise<ChatResponse> {
		if (request.signal?.aborted) throw this.#abortError(0);
		let encoded: ReturnType<typeof encodeRequest>;
		try { encoded = (this.#api === 'responses' ? encodeResponses : encodeRequest)(
			request, this.model, this.#maxTokens, this.#reasoningEffort); }
		catch (error) {
			throw new AdapterError('request', this.#redact(error instanceof Error ? error.message : 'Invalid chat request'), { attempts: 0 });
		}
		const { body, originals, requestBytes } = encoded;
		this.#requestBytes = requestBytes;
		for (let attempts = 1; ; attempts++) {
			if (request.signal?.aborted) throw this.#abortError(attempts - 1, requestBytes);
			request.onRequestMetadata?.({ requestBytes, attempts });
			let retryAfterMs = 0;
			try {
				const result = await this.#attempt(request, body, originals, attempts, requestBytes,
					(delay) => { retryAfterMs = delay; });
				return { ...result, requestBytes };
			} catch (error) {
				if (request.signal?.aborted) throw this.#abortError(attempts, requestBytes);
				if (!(error instanceof AdapterError)) throw error;
				request.onError?.(error);
				const retryable = error.kind === 'timeout' || (error.kind === 'http' &&
					(error.status === 429 || (error.status !== undefined && error.status >= 500 && error.status <= 599)));
				if (!retryable || attempts > this.#maxRetries) throw error;
				await this.#backoff(Math.min(60_000, Math.max(retryAfterMs,
					this.#retryDelayMs * 2 ** (attempts - 1))), request.signal, attempts, requestBytes);
			}
		}
	}

	async #attempt(request: ChatRequest, body: string, originals: Map<string, string>,
		attempts: number, requestBytes: number, retryAfter: (delay: number) => void): Promise<ChatResponse> {
		const controller = new AbortController();
		let cancel!: (error: Error) => void;
		const cancelled = new Promise<never>((_, reject) => { cancel = reject; });
		const onAbort = () => {
			cancel(this.#abortError(attempts, requestBytes));
			controller.abort(); // Never forward a caller's potentially sensitive abort reason.
		};
		request.signal?.addEventListener('abort', onAbort, { once: true });
		if (request.signal?.aborted) onAbort();
		const timer = setTimeout(() => {
			cancel(new AdapterError('timeout', 'Model request timed out', { attempts, requestBytes }));
			controller.abort();
		}, this.#timeoutMs);
		try {
			if (request.signal?.aborted) return await cancelled;
			return await Promise.race([this.#complete(body, originals, controller.signal, retryAfter), cancelled]);
		} catch (error) {
			if (error instanceof AdapterError) {
				error.attempts = attempts;
				error.requestBytes = requestBytes;
			}
			throw error;
		} finally {
			clearTimeout(timer);
			request.signal?.removeEventListener('abort', onAbort);
		}
	}

	#abortError(attempts: number, requestBytes?: number): AdapterError {
		return new AdapterError('cancelled', 'Model request aborted', { attempts, requestBytes });
	}

	#backoff(delay: number, signal: AbortSignal | undefined, attempts: number, requestBytes: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const onAbort = () => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				reject(this.#abortError(attempts, requestBytes));
			};
			const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, delay);
			signal?.addEventListener('abort', onAbort, { once: true });
			if (signal?.aborted) onAbort();
		});
	}

	#redact(text: string): string {
		const url = new URL(this.#endpoint);
		const secrets = [this.#key, this.#endpoint, url.host];
		url.searchParams.forEach(value => { if (value) secrets.push(value); });
		// Redact encoded/decoded forms too; never disclose credential query fragments.
		for (const secret of secrets.sort((a, b) => b.length - a.length)) {
			for (const variant of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) {
				text = text.split(variant).join('[REDACTED]');
			}
		}
		return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED]')
			.replace(/\bBearer\s+[^\s"',;}]+/gi, 'Bearer [REDACTED]')
			.replace(/(["']?(?:api[_-]?key|authorization|token|password|secret)["']?\s*[:=]\s*)["']?[^\s"',;}]+["']?/gi, '$1[REDACTED]')
			.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 4000);
	}

	async #complete(body: string, originals: Map<string, string>, signal: AbortSignal,
		retryAfter: (delay: number) => void): Promise<ChatResponse> {
		let response: Response;
		try {
			response = await fetch(this.#endpoint, {
				method: 'POST', redirect: 'error', signal,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#key}` }, body
			});
		} catch {
			// Fetch errors may include URLs, headers, credentials, or caller abort reasons.
			throw new AdapterError('network', 'Model request failed');
		}
		if (!response.ok) {
			const header = response.headers?.get('Retry-After');
			if (header) {
				const delay = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - Date.now();
				if (Number.isFinite(delay)) retryAfter(Math.max(0, Math.min(60_000, delay)));
			}
			let responseText = '';
			try { responseText = this.#redact(await response.text()); } catch { /* Preserve the known HTTP status. */ }
			throw new AdapterError('http', `Model request failed (HTTP ${response.status})${responseText ? `: ${responseText}` : ''}`,
				{ status: response.status, responseText });
		}
		let value: unknown;
		try { value = await response.json(); }
		catch { throw new AdapterError('protocol', 'Invalid model response', { status: response.status }); }
		try { return (this.#api === 'responses' ? decodeResponses : decodeResponse)(value, originals); }
		catch (error) {
			if (error instanceof AdapterError) error.status = response.status;
			throw error;
		}
	}
}

/** Required: CITY_MODEL_ENDPOINT, CITY_MODEL_NAME, CITY_MODEL_KEY. No network I/O. */
export function createEnvironmentAdapter(env: Environment = process.env): ChatAdapter {
	const retries = env.CITY_MODEL_MAX_RETRIES;
	if (retries !== undefined && !/^[0-5]$/.test(retries)) {
		throw new Error('CITY_MODEL_MAX_RETRIES must be an integer between 0 and 5');
	}
	return new OpenAIAdapter({
		endpoint: required(env.CITY_MODEL_ENDPOINT, 'CITY_MODEL_ENDPOINT'),
		api: env.CITY_MODEL_API as OpenAIAdapterOptions['api'],
		model: required(env.CITY_MODEL_NAME, 'CITY_MODEL_NAME'),
		key: required(env.CITY_MODEL_KEY, 'CITY_MODEL_KEY'),
		timeoutMs: optionalInteger(env, 'CITY_MODEL_TIMEOUT_MS', 300_000),
		maxTokens: optionalInteger(env, 'CITY_MODEL_MAX_TOKENS', 1_000_000),
		maxRetries: retries === undefined ? 5 : Number(retries),
		reasoningEffort: env.CITY_MODEL_REASONING_EFFORT?.trim() || undefined
	});
}