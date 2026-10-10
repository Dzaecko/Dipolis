import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAdapter, ChatRequest, ToolDefinition } from './adapter';
import { AdapterError, createEnvironmentAdapter, inspectRequestBytes, OpenAIAdapter } from './openai-adapter';

// Deliberately fake credentials; every test stubs fetch, so none can contact a provider.
const key = 'fake-test-secret';
const endpoint = 'https://provider.invalid/custom/chat/completions?tenant=test';
const env = { CITY_MODEL_ENDPOINT: endpoint, CITY_MODEL_NAME: 'test-model', CITY_MODEL_KEY: key, CITY_MODEL_MAX_RETRIES: '0' };
const tools: ToolDefinition[] = [
	{ name: 'budget.set-funding', description: 'Set funding', parameters: { type: 'object', properties: { amount: { type: 'number' } } } },
	{ name: 'report.get', description: 'Read report', parameters: { type: 'object', properties: {} } }
];
const request: ChatRequest = { messages: [{ role: 'user', content: 'Inspect the city' }], tools };
const call = (name = 'budget_set_funding', args = '{"amount":70}', id = 'call-1') => ({
	id, type: 'function', function: { name, arguments: args }
});
const completion = (message: unknown = { role: 'assistant', content: 'Ready' }, finishReason = 'stop') => ({
	choices: [{ message, finish_reason: finishReason }]
});

describe('OpenAI-compatible chat adapter', () => {
	const fetchMock = vi.fn<typeof fetch>();
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});
	function respond(value: unknown = completion()) {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify(value), { status: 200 }));
	}
	function sent() {
		const [url, init] = fetchMock.mock.calls[0];
		return { url, init: init!, body: JSON.parse(init!.body as string) };
	}

	it('implements the neutral interface and sends only explicit provider configuration', async () => {
		respond();
		const adapter: ChatAdapter = createEnvironmentAdapter(env);
		expect(adapter.model).toBe('test-model');
		await expect(adapter.chat({ ...request, messages: [
			{ role: 'system', content: 'Use the supplied tools' }, ...request.messages
		] })).resolves.toMatchObject({ content: 'Ready', toolCalls: [],
			usage: { inputTokens: 0, outputTokens: 0 }, usageReported: false });
		const { url, init, body } = sent();
		expect(url).toBe(endpoint);
		expect(init.method).toBe('POST');
		expect(init.redirect).toBe('error');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` });
		expect(body.model).toBe('test-model');
		expect(body.messages).toEqual([{ role: 'system', content: 'Use the supplied tools' }, ...request.messages]);
		expect(body.tools).toEqual(tools.map((tool) => ({ type: 'function', function: {
			name: tool.name.replace(/[.-]/g, '_'), description: tool.description, parameters: tool.parameters
		} })));
		expect(body).not.toHaveProperty('max_tokens');
		expect(JSON.stringify(body)).not.toContain(key);
		expect(JSON.stringify(adapter)).not.toContain(key);
		expect(JSON.stringify(adapter)).not.toContain(endpoint);
	});

	it.each(['CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', 'CITY_MODEL_KEY'] as const)('requires %s without defaults', (variable) => {
		for (const value of [undefined, '', '   ']) {
			expect(() => createEnvironmentAdapter({ ...env, [variable]: value })).toThrow(`${variable} is required`);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('supports the default process environment factory without contacting a provider', () => {
		for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
		try { expect(createEnvironmentAdapter().model).toBe('test-model'); }
		finally { vi.unstubAllEnvs(); }
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		'https://other-provider.invalid/v1/chat/completions',
		'http://localhost:8080/v1/chat/completions',
		'http://127.0.0.1:8080/completions', 'http://127.0.0.2:8080/completions',
		'http://[::1]:8080/completions'
	])('accepts secure or loopback endpoint %s', (url) => {
		expect(createEnvironmentAdapter({ ...env, CITY_MODEL_ENDPOINT: url }).model).toBe('test-model');
	});

	it.each([
		'not-a-url', '/v1/chat/completions', 'https:provider.invalid/chat/completions',
		'http://provider.invalid/chat/completions',
		'http://localhost.provider.invalid/chat/completions', 'http://192.168.1.1/chat/completions',
		'http://[::2]/chat/completions', 'ftp://localhost/chat/completions',
		`https://user:${key}@provider.invalid/chat/completions`,
		`https://provider.invalid/chat/completions#${key}`
	])('rejects invalid or insecure endpoints without echoing them (%#)', (url) => {
		try {
			createEnvironmentAdapter({ ...env, CITY_MODEL_ENDPOINT: url });
			throw new Error('Expected configuration failure');
		} catch (error) {
			expect(String(error)).toContain('CITY_MODEL_ENDPOINT');
			expect(String(error)).not.toContain(url);
			expect(String(error)).not.toContain(key);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(['CITY_MODEL_TIMEOUT_MS', 'CITY_MODEL_MAX_TOKENS'] as const)('validates bounded integer %s', (variable) => {
		const maximum = variable === 'CITY_MODEL_TIMEOUT_MS' ? 300_000 : 1_000_000;
		for (const value of ['', '0', '-1', '1.5', 'Infinity', 'NaN', '1e3', ' 60 ', key, String(maximum + 1)]) {
			expect(() => createEnvironmentAdapter({ ...env, [variable]: value })).toThrow(variable);
		}
		for (const value of ['1', String(maximum)]) {
			expect(() => createEnvironmentAdapter({ ...env, [variable]: value })).not.toThrow();
		}
	});

	it('passes the configured max token limit', async () => {
		respond();
		await createEnvironmentAdapter({ ...env, CITY_MODEL_MAX_TOKENS: '1234' }).chat(request);
		expect(sent().body.max_tokens).toBe(1234);
	});

	it('validates direct constructor options and rejects header injection', () => {
		const options = { endpoint, model: 'test-model', key };
		for (const timeoutMs of [0, -1, 1.5, Infinity, NaN, 300_001]) {
			expect(() => new OpenAIAdapter({ ...options, timeoutMs })).toThrow('CITY_MODEL_TIMEOUT_MS');
		}
		for (const maxTokens of [0, 1.5, 1_000_001]) {
			expect(() => new OpenAIAdapter({ ...options, maxTokens })).toThrow('CITY_MODEL_MAX_TOKENS');
		}
		expect(() => new OpenAIAdapter({ ...options, key: `${key}\r\nInjected: value` })).toThrow('Invalid CITY_MODEL_KEY');
	});

	it('reversibly maps tool names and parses arguments', async () => {
		respond(completion({ role: 'assistant', content: null, tool_calls: [call(), call('report_get', '{}', 'call-2')] }, 'tool_calls'));
		await expect(createEnvironmentAdapter(env).chat(request)).resolves.toMatchObject({
			content: '', toolCalls: [
				{ id: 'call-1', name: 'budget.set-funding', arguments: { amount: 70 } },
				{ id: 'call-2', name: 'report.get', arguments: {} }
			]
		});
	});

	it('keeps unknown names and malformed arguments for runner validation', async () => {
		respond(completion({ role: 'assistant', content: 'Check this', tool_calls: [call('unknown_command', '{broken')] }, 'tool_calls'));
		await expect(createEnvironmentAdapter(env).chat(request)).resolves.toMatchObject({
			content: 'Check this', toolCalls: [{ id: 'call-1', name: 'unknown_command', arguments: '{broken' }]
		});
	});

	it.each(['null', '[]', '42', 'true', '"text"'])('leaves parsed non-object JSON %s to runner validation', async (args) => {
		respond(completion({ role: 'assistant', content: null, tool_calls: [call('report_get', args)] }, 'tool_calls'));
		const result = await createEnvironmentAdapter(env).chat(request);
		expect(result.toolCalls[0].arguments).toEqual(JSON.parse(args));
	});

	it('feeds assistant calls and tool results back with exact wire names and IDs', async () => {
		respond();
		await createEnvironmentAdapter(env).chat({ tools, messages: [
			...request.messages,
			{ role: 'assistant', content: '', toolCalls: [
				{ id: 'call-1', name: 'budget.set-funding', arguments: { amount: 70 } },
				{ id: 'call-2', name: 'report.get', arguments: '{broken' }
			] },
			{ role: 'tool', toolCallId: 'call-1', name: 'budget.set-funding', content: '{"ok":true}' },
			{ role: 'tool', toolCallId: 'call-2', name: 'report.get', content: 'Invalid arguments' }
		] });
		expect(sent().body.messages.slice(1)).toEqual([
			{ role: 'assistant', content: '', tool_calls: [call(), call('report_get', '{broken', 'call-2')] },
			{ role: 'tool', tool_call_id: 'call-1', name: 'budget_set_funding', content: '{"ok":true}' },
			{ role: 'tool', tool_call_id: 'call-2', name: 'report_get', content: 'Invalid arguments' }
		]);
	});

	it('sanitizes serialization failures and never sends incomplete assistant arguments', async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		for (const args of [undefined, circular, { toJSON() { throw new Error(key); } }]) {
			const result = createEnvironmentAdapter(env).chat({ ...request, messages: [
				{ role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'report.get', arguments: args }] }
			] });
			await expect(result).rejects.toThrow(/^Invalid tool arguments JSON$/);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(['budget_set_funding', 'budget-set.funding', 'budget.set-funding'])('rejects normalized collisions including duplicates (%s)', async (name) => {
		await expect(createEnvironmentAdapter(env).chat({ ...request, tools: [tools[0], { ...tools[0], name }] })).rejects.toThrow('collision');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(['', 'invalid/name', 'name with spaces', 'a'.repeat(65)])('rejects invalid function names (%#)', async (name) => {
		await expect(createEnvironmentAdapter(env).chat({ ...request, tools: [{ ...tools[0], name }] })).rejects.toThrow('Invalid tool function name');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('uses a per-request registry rather than heuristically converting unknown names', async () => {
		respond(completion({ role: 'assistant', content: null, tool_calls: [call()] }, 'tool_calls'));
		const adapter = createEnvironmentAdapter(env);
		expect((await adapter.chat(request)).toolCalls[0].name).toBe('budget.set-funding');
		expect((await adapter.chat({ ...request, tools: [] })).toolCalls[0].name).toBe('budget_set_funding');
	});

	it.each([400, 401, 429, 500, 302])('reports structured HTTP status %s and sanitized provider body', async (status) => {
		const json = vi.fn();
		const text = vi.fn().mockResolvedValue(`denied ${key} ${endpoint}`);
		fetchMock.mockResolvedValue({ ok: false, status, statusText: key, json, text } as unknown as Response);
		const error = await createEnvironmentAdapter(env).chat(request).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(AdapterError);
		expect(error).toMatchObject({ kind: 'http', status, attempts: 1,
			responseText: 'denied [REDACTED] [REDACTED]', requestBytes: inspectRequestBytes(request, env.CITY_MODEL_NAME) });
		expect(String(error)).toContain(`Model request failed (HTTP ${status})`);
		expect(String(error)).not.toContain(key);
		expect(String(error)).not.toContain(endpoint);
		expect(error).not.toHaveProperty('cause');
		expect(json).not.toHaveBeenCalled();
		expect(text).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('sanitizes network errors and does not log or attach the underlying error', async () => {
		const log = vi.spyOn(console, 'log');
		const warn = vi.spyOn(console, 'warn');
		const errorLog = vi.spyOn(console, 'error');
		fetchMock.mockRejectedValue(new Error(`${endpoint} Authorization: Bearer ${key}`));
		const error = await createEnvironmentAdapter(env).chat(request).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(Error);
		expect(String(error)).toBe('AdapterError: Model request failed');
		expect(error).toMatchObject({ kind: 'network', attempts: 1 });
		expect(error).not.toHaveProperty('cause');
		expect(log).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(errorLog).not.toHaveBeenCalled();
	});

	it('sanitizes JSON decoding errors', async () => {
		fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new Error(`${key} ${endpoint}`); } } as unknown as Response);
		await expect(createEnvironmentAdapter(env).chat(request)).rejects.toThrow(/^Invalid model response$/);
	});

	it.each([
		null, {}, { choices: {} }, { choices: [] }, { choices: [null] },
		completion(null), completion({ role: 'user', content: 'wrong role' }),
		completion({ role: 'assistant' }), completion({ role: 'assistant', content: 123 }),
		completion({ role: 'assistant', content: null }),
		completion({ role: 'assistant', content: '', tool_calls: {} }),
		completion({ role: 'assistant', content: '', tool_calls: [null] }),
		completion({ role: 'assistant', content: '', tool_calls: [{ ...call(), id: '' }] }),
		completion({ role: 'assistant', content: '', tool_calls: [{ ...call(), type: 'other' }] }),
		completion({ role: 'assistant', content: '', tool_calls: [{ ...call(), function: { name: '', arguments: '{}' } }] }),
		completion({ role: 'assistant', content: '', tool_calls: [{ ...call(), function: { name: 'report_get', arguments: {} } }] }),
		completion({ role: 'assistant', content: '', tool_calls: [call(), call()] }),
		completion({ role: 'assistant', content: 'blocked' }, 'content_filter')
	])('rejects malformed responses (%#)', async (value) => {
		respond(value);
		await expect(createEnvironmentAdapter(env).chat(request)).rejects.toThrow('Invalid model response');
	});

	it('rejects truncated responses rather than executing partial calls', async () => {
		respond(completion({ role: 'assistant', content: key, tool_calls: [call()] }, 'length'));
		await expect(createEnvironmentAdapter(env).chat(request)).rejects.toThrow(/^Model response exceeded token limit$/);
	});

	it('does not send a pre-aborted request or disclose its reason', async () => {
		const controller = new AbortController();
		controller.abort(new Error(key));
		await expect(createEnvironmentAdapter(env).chat({ ...request, signal: controller.signal })).rejects.toMatchObject({
			name: 'AbortError', message: 'Model request aborted'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('propagates caller cancellation and removes the listener and timeout', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(() => new Promise(() => {}));
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, 'removeEventListener');
		const result = createEnvironmentAdapter(env).chat({ ...request, signal: controller.signal });
		const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError', message: 'Model request aborted' });
		controller.abort(key);
		await assertion;
		expect(sent().init.signal?.aborted).toBe(true);
		expect(sent().init.signal?.reason).not.toBe(key);
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([undefined, '25'])('times out even when fetch ignores abort (configured %s)', async (timeout) => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(() => new Promise(() => {}));
		const adapter = createEnvironmentAdapter({ ...env, CITY_MODEL_TIMEOUT_MS: timeout });
		const assertion = expect(adapter.chat(request)).rejects.toThrow(/^Model request timed out$/);
		await vi.advanceTimersByTimeAsync(timeout === undefined ? 60_000 : Number(timeout));
		await assertion;
		expect(sent().init.signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('also bounds response-body reading', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as unknown as Response);
		const assertion = expect(createEnvironmentAdapter({ ...env, CITY_MODEL_TIMEOUT_MS: '10' }).chat(request)).rejects.toThrow('timed out');
		await vi.advanceTimersByTimeAsync(10);
		await assertion;
		expect(sent().init.signal?.aborted).toBe(true);
	});

	it.each([
		[undefined, 0, 0, false],
		[{ prompt_tokens: 12, completion_tokens: 7 }, 12, 7, true],
		[{ prompt_tokens: 0 }, 0, 0, true],
		[{ completion_tokens: 4 }, 0, 4, true],
		[{ prompt_tokens: -1, completion_tokens: '9' }, 0, 0, false],
		[{ prompt_tokens: 1.5, completion_tokens: Number.MAX_SAFE_INTEGER + 1 }, 0, 0, false],
		[null, 0, 0, false]
	])('normalizes usage safely (%#)', async (usage, inputTokens, outputTokens, usageReported) => {
		respond({ ...completion(), usage });
		expect(await createEnvironmentAdapter(env).chat(request)).toMatchObject({
			usage: { inputTokens, outputTokens }, usageReported
		});
	});

	it('measures exact UTF-8 bytes offline and reports each latest request without credentials', async () => {
		respond();
		const adapter = new OpenAIAdapter({ endpoint, model: '測試', key, maxTokens: 17 });
		expect(adapter.requestBytes).toBeUndefined();
		const onRequestMetadata = vi.fn();
		const unicodeRequest = { ...request, messages: [{ role: 'user' as const, content: 'Stadt 🏙️ 漢字' }], onRequestMetadata };
		const estimate = inspectRequestBytes(unicodeRequest, adapter.model, 17);
		expect(fetchMock).not.toHaveBeenCalled();
		const result = await adapter.chat(unicodeRequest);
		const body = sent().init.body as string;
		expect(estimate).toBe(Buffer.byteLength(body, 'utf8'));
		expect(estimate).toBeGreaterThan(body.length);
		expect(result.requestBytes).toBe(estimate);
		expect(adapter.requestBytes).toBe(estimate);
		expect(onRequestMetadata).toHaveBeenCalledOnce();
		expect(onRequestMetadata).toHaveBeenCalledWith({ requestBytes: estimate, attempts: 1 });
		const next = await adapter.chat(request);
		expect(adapter.requestBytes).toBe(next.requestBytes);
		expect(next.requestBytes).not.toBe(estimate);
	});

	it('redacts secrets and encoded endpoint credential fragments before bounding the HTTP body', async () => {
		const credential = 'endpoint-secret/with+spaces';
		const sensitiveEndpoint = `https://provider.invalid/chat?api_key=${encodeURIComponent(credential)}`;
		fetchMock.mockResolvedValue(new Response(
			`${key} ${encodeURIComponent(key)} ${sensitiveEndpoint} ${encodeURIComponent(sensitiveEndpoint)} ` +
			`${credential} ${encodeURIComponent(credential)} Bearer another-secret https://other.invalid/secret\n` + 'x'.repeat(5000),
			{ status: 401 }));
		const error = await new OpenAIAdapter({ endpoint: sensitiveEndpoint, model: 'test', key, maxRetries: 0 })
			.chat(request).catch((error: AdapterError) => error);
		expect(error).toBeInstanceOf(AdapterError);
		const details = error as AdapterError;
		expect(details.responseText).toHaveLength(4000);
		for (const secret of [key, credential, encodeURIComponent(credential), sensitiveEndpoint,
			encodeURIComponent(sensitiveEndpoint), 'another-secret', 'provider.invalid', 'other.invalid']) {
			expect(String(details)).not.toContain(secret);
			expect(JSON.stringify(details)).not.toContain(secret);
			expect(details.stack).not.toContain(secret);
		}
	});

	it('keeps the HTTP status if reading its body fails', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => { throw new Error(key); } } as unknown as Response);
		await expect(createEnvironmentAdapter(env).chat(request)).rejects.toMatchObject({
			kind: 'http', status: 403, responseText: '', attempts: 1
		});
	});

	it.each([429, 500, 503, 599])('retries HTTP %s with increasing backoff and a fresh signal', async (status) => {
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce(async () => new Response('busy', { status }))
			.mockImplementationOnce(async () => new Response('busy', { status }))
			.mockImplementation(async () => new Response(JSON.stringify(completion()), { status: 200 }));
		const metadata = vi.fn();
		const result = new OpenAIAdapter({ endpoint, model: 'test', key, retryDelayMs: 10 })
			.chat({ ...request, onRequestMetadata: metadata });
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(9);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(19);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(await result).toMatchObject({ content: 'Ready' });
		const signals = fetchMock.mock.calls.map(([, init]) => init!.signal);
		expect(new Set(signals).size).toBe(3);
		expect(metadata.mock.calls.map(([value]) => value.attempts)).toEqual([1, 2, 3]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('defaults the factory to five additional attempts and preserves the final HTTP error', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(async () => new Response('still busy', { status: 429 }));
		const assertion = expect(createEnvironmentAdapter({ ...env, CITY_MODEL_MAX_RETRIES: undefined }).chat(request))
			.rejects.toMatchObject({ kind: 'http', status: 429, responseText: 'still busy', attempts: 6,
				requestBytes: inspectRequestBytes(request, env.CITY_MODEL_NAME) });
		await vi.runAllTimersAsync();
		await assertion;
		expect(fetchMock).toHaveBeenCalledTimes(6);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['999999', 'Thu, 01 Jan 2099 00:00:00 GMT', '2', 'invalid', '-1'])
		('bounds Retry-After %s and falls back to exponential delay', async (header) => {
			vi.useFakeTimers();
			fetchMock.mockImplementationOnce(async () => new Response('busy', { status: 429, headers: { 'Retry-After': header } }))
				.mockImplementation(async () => new Response(JSON.stringify(completion()), { status: 200 }));
			const result = new OpenAIAdapter({ endpoint, model: 'test', key, retryDelayMs: 10 }).chat(request);
			const delay = header === '2' ? 2000 : header === 'invalid' || header === '-1' ? 10 : 60_000;
			await vi.advanceTimersByTimeAsync(delay - 1);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			await result;
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

	it('retries timeouts even if fetch ignores abort and stops at the configured limit', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(() => new Promise(() => {}));
		const adapter = new OpenAIAdapter({ endpoint, model: 'test', key, timeoutMs: 10, retryDelayMs: 5, maxRetries: 2 });
		const assertion = expect(adapter.chat(request)).rejects.toMatchObject({ kind: 'timeout', attempts: 3,
			requestBytes: inspectRequestBytes(request, adapter.model) });
		await vi.runAllTimersAsync();
		await assertion;
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const signals = fetchMock.mock.calls.map(([, init]) => init!.signal!);
		expect(new Set(signals).size).toBe(3);
		expect(signals.every(signal => signal.aborted)).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('can succeed after a timeout with a fresh non-aborted signal', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce(() => new Promise(() => {}))
			.mockImplementation(async () => new Response(JSON.stringify(completion()), { status: 200 }));
		const result = new OpenAIAdapter({ endpoint, model: 'test', key, timeoutMs: 10, retryDelayMs: 1 }).chat(request);
		await vi.advanceTimersByTimeAsync(11);
		await expect(result).resolves.toMatchObject({ content: 'Ready' });
		expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
		expect(fetchMock.mock.calls[1][1]!.signal!.aborted).toBe(false);
	});

	it.each(['http', 'network', 'protocol'])('never retries non-transient %s failures', async (kind) => {
		vi.useFakeTimers();
		if (kind === 'http') fetchMock.mockResolvedValue(new Response('denied', { status: 401 }));
		else if (kind === 'network') fetchMock.mockRejectedValue(new Error(`${key} ${endpoint}`));
		else respond({ error: { message: key } });
		await expect(new OpenAIAdapter({ endpoint, model: 'test', key }).chat(request)).rejects.toMatchObject({ kind, attempts: 1 });
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['attempt', 'backoff'])('does not retry external cancellation during %s', async (phase) => {
		vi.useFakeTimers();
		if (phase === 'attempt') fetchMock.mockImplementation(() => new Promise(() => {}));
		else fetchMock.mockResolvedValue(new Response('busy', { status: 503 }));
		const controller = new AbortController();
		const assertion = expect(new OpenAIAdapter({ endpoint, model: 'test', key })
			.chat({ ...request, signal: controller.signal })).rejects.toMatchObject({
				kind: 'cancelled', name: 'AbortError', attempts: 1, message: 'Model request aborted'
			});
		await vi.advanceTimersByTimeAsync(0);
		controller.abort(`${endpoint} ${key}`);
		await assertion;
		await vi.runAllTimersAsync();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('validates retry options, including zero delays and zero retries', () => {
		for (const maxRetries of [-1, 1.5, 6, NaN]) {
			expect(() => new OpenAIAdapter({ endpoint, model: 'test', key, maxRetries })).toThrow('CITY_MODEL_MAX_RETRIES');
		}
		for (const retryDelayMs of [-1, 1.5, 60_001, Infinity]) {
			expect(() => new OpenAIAdapter({ endpoint, model: 'test', key, retryDelayMs })).toThrow('retryDelayMs');
		}
		for (const value of ['', '-1', '6', '1.5', key]) {
			expect(() => createEnvironmentAdapter({ ...env, CITY_MODEL_MAX_RETRIES: value })).toThrow('CITY_MODEL_MAX_RETRIES');
		}
		expect(() => new OpenAIAdapter({ endpoint, model: 'test', key, maxRetries: 0, retryDelayMs: 0 })).not.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('cleans up successful requests without aborting their signal', async () => {
		vi.useFakeTimers();
		respond();
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, 'removeEventListener');
		await createEnvironmentAdapter(env).chat({ ...request, signal: controller.signal });
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
		controller.abort();
		expect(sent().init.signal?.aborted).toBe(false);
	});
});