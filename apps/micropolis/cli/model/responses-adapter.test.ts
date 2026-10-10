import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, JSONObject, ToolDefinition } from './adapter';
import { createEnvironmentAdapter, inspectRequestBytes, OpenAIAdapter } from './openai-adapter';
import { decideYear } from './runner';

// Fake configuration only. All fetch calls are mocked; never read environment files.
const key = 'fake-responses-secret';
const endpoint = 'https://provider.invalid/openai/v1/chat/completions?tenant=test&version=1';
const options = { endpoint, model: 'test-model', key, maxRetries: 0, api: 'responses' as const };
const env = { CITY_MODEL_ENDPOINT: endpoint, CITY_MODEL_NAME: options.model, CITY_MODEL_KEY: key,
	CITY_MODEL_MAX_RETRIES: '0', CITY_MODEL_API: 'responses' };
const tools: ToolDefinition[] = [
	{ name: 'budget.set-funding', description: 'Set funding', parameters: { type: 'object', properties: {} } },
	{ name: 'report.get', description: 'Read report', parameters: { type: 'object', properties: {} } }
];
const request: ChatRequest = { tools, messages: [
	{ role: 'system', content: 'Use tools' }, { role: 'user', content: 'Inspect the city 🏙️' }
] };
const message = (text = 'Ready'): JSONObject => ({ type: 'message', id: 'msg-1', role: 'assistant',
	status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const call = (name = 'budget_set_funding', args = '{"amount":70}', id = 'call-1'): JSONObject => ({
	type: 'function_call', id: `fc-${id}`, call_id: id, name, arguments: args, status: 'completed'
});
const reasoning: JSONObject = { type: 'reasoning', id: 'rs-1', encrypted_content: 'opaque-encrypted-reasoning',
	summary: [], future_field: { untouched: [true, null, { nested: 'value' }] } };
const completed = (output: JSONObject[] = [message()], usage?: unknown) => ({ status: 'completed', output, usage });

describe('optional Responses API adapter', () => {
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
	function respond(value: unknown = completed()) {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify(value), { status: 200 }));
	}
	function sent(index = 0) {
		const [url, init] = fetchMock.mock.calls[index];
		return { url, init: init!, body: JSON.parse(init!.body as string) };
	}

	it.each([
		[endpoint, 'https://provider.invalid/openai/v1/responses?tenant=test&version=1'],
		['https://provider.invalid/v1/chat/completions?api-version=preview', 'https://provider.invalid/v1/responses?api-version=preview'],
		['https://provider.invalid/openai/v1?tenant=test', 'https://provider.invalid/openai/v1/responses?tenant=test'],
		['https://provider.invalid/openai/v1/?tenant=test', 'https://provider.invalid/openai/v1/responses?tenant=test'],
		['https://provider.invalid/custom/responses?tenant=a%2Fb&x=1', 'https://provider.invalid/custom/responses?tenant=a%2Fb&x=1'],
		['http://localhost:8080/custom/responses', 'http://localhost:8080/custom/responses']
	])('normalizes only recognized Responses paths, preserving query (%#)', async (url, expected) => {
		respond();
		await new OpenAIAdapter({ ...options, endpoint: url }).chat(request);
		expect(sent().url).toBe(expected);
	});

	it('selects Responses through explicit environment configuration and flattens tools', async () => {
		respond();
		const adapter = createEnvironmentAdapter(env);
		const metadata = vi.fn();
		const result = await adapter.chat({ ...request, onRequestMetadata: metadata });
		const { init, body } = sent();
		expect(body).toEqual({ model: options.model, input: request.messages, store: false,
			include: ['reasoning.encrypted_content'], tools: tools.map(tool => ({ type: 'function',
				name: tool.name.replace(/[.-]/g, '_'), description: tool.description, parameters: tool.parameters, strict: false })) });
		expect(init.method).toBe('POST');
		expect(init.redirect).toBe('error');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` });
		expect(init.body).not.toContain(key);
		expect(JSON.stringify(adapter)).not.toContain(key);
		expect(JSON.stringify(adapter)).not.toContain(endpoint);
		const bytes = Buffer.byteLength(init.body as string, 'utf8');
		expect(result.requestBytes).toBe(bytes);
		expect(adapter.requestBytes).toBe(bytes);
		expect(metadata).toHaveBeenCalledWith({ attempts: 1, requestBytes: bytes });
	});

	it('uses optional reasoning low and max_output_tokens, never chat-only fields', async () => {
		respond();
		await createEnvironmentAdapter({ ...env, CITY_MODEL_REASONING_EFFORT: 'low', CITY_MODEL_MAX_TOKENS: '1234' }).chat(request);
		expect(sent().body.reasoning).toEqual({ effort: 'low' });
		expect(sent().body.max_output_tokens).toBe(1234);
		expect(sent().body).not.toHaveProperty('reasoning_effort');
		expect(sent().body).not.toHaveProperty('max_tokens');
		fetchMock.mockClear();
		await new OpenAIAdapter(options).chat(request);
		expect(sent().body).not.toHaveProperty('reasoning');
		expect(sent().body).not.toHaveProperty('max_output_tokens');
	});

	it.each(['', 'unknown', 'Responses', 'responses '])('rejects invalid API selection without a fetch (%#)', api => {
		expect(() => createEnvironmentAdapter({ ...env, CITY_MODEL_API: api })).toThrow('CITY_MODEL_API');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([undefined, 'chat'] as const)('keeps the default/explicit chat wire encoder and byte estimator unchanged (%s)', async api => {
		respond({ choices: [{ message: { role: 'assistant', content: 'Ready' }, finish_reason: 'stop' }] });
		const result = await createEnvironmentAdapter({ ...env, CITY_MODEL_API: api }).chat(request);
		expect(sent().url).toBe(endpoint);
		expect(sent().body).toEqual({ model: options.model, messages: request.messages, tools: tools.map(tool => ({
			type: 'function', function: { name: tool.name.replace(/[.-]/g, '_'), description: tool.description, parameters: tool.parameters }
		})) });
		expect(result).not.toHaveProperty('providerItems');
		expect(result.requestBytes).toBe(inspectRequestBytes(request, options.model));
	});

	it('maps tool results back to dotted BusIDs using call_id, not the output item ID', async () => {
		const output = [reasoning, call(), call('report_get', '{}', 'call-2'), message('Working')];
		respond(completed(output));
		const result = await new OpenAIAdapter(options).chat(request);
		expect(result).toMatchObject({ content: 'Working', toolCalls: [
			{ id: 'call-1', name: 'budget.set-funding', arguments: { amount: 70 } },
			{ id: 'call-2', name: 'report.get', arguments: {} }
		], providerItems: output });
	});

	it.each(['{broken', 'null', '[]', '42', 'true', '"text"'])('retains unknown names and malformed/non-object arguments (%s)', async args => {
		respond(completed([call('unknown_command', args)]));
		const result = await new OpenAIAdapter(options).chat(request);
		expect(result.toolCalls).toEqual([{ id: 'call-1', name: 'unknown_command',
			arguments: args === '{broken' ? args : JSON.parse(args) }]);
	});

	it('uses a per-request tool registry for reverse mapping', async () => {
		respond(completed([call()]));
		const adapter = new OpenAIAdapter(options);
		expect((await adapter.chat(request)).toolCalls[0].name).toBe('budget.set-funding');
		expect((await adapter.chat({ ...request, tools: [] })).toolCalls[0].name).toBe('budget_set_funding');
	});

	it('encodes assistant text/calls without provider items and tool outputs', async () => {
		respond();
		await new OpenAIAdapter(options).chat({ tools, messages: [
			...request.messages,
			{ role: 'assistant', content: 'Working', toolCalls: [
				{ id: 'call-1', name: 'budget.set-funding', arguments: { amount: 70 } },
				{ id: 'call-2', name: 'report.get', arguments: '{broken' },
				{ id: 'call-3', name: 'unknown/name', arguments: '{}' }
			] },
			{ role: 'tool', toolCallId: 'call-1', name: 'budget.set-funding', content: '{"handled":true}' },
			{ role: 'assistant', content: 'Done' }
		] });
		expect(sent().body.input.slice(2)).toEqual([
			{ role: 'assistant', content: 'Working' },
			{ type: 'function_call', call_id: 'call-1', name: 'budget_set_funding', arguments: '{"amount":70}' },
			{ type: 'function_call', call_id: 'call-2', name: 'report_get', arguments: '{broken' },
			{ type: 'function_call', call_id: 'call-3', name: 'unknown/name', arguments: '{}' },
			{ type: 'function_call_output', call_id: 'call-1', output: '{"handled":true}' },
			{ role: 'assistant', content: 'Done' }
		]);
	});

	it('keeps reasoning and the entire opaque output exactly once on every runner continuation, never in logs', async () => {
		const first = [reasoning, call('tax_set', '{"rate":9}'), message('First')];
		const second = [{ ...reasoning, id: 'rs-2', encrypted_content: 'second-encrypted-reasoning' },
			call('tax_set', '{"rate":7}', 'call-2'), { ...message('Second'), id: 'msg-2' }];
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(completed(first))))
			.mockResolvedValueOnce(new Response(JSON.stringify(completed(second))))
			.mockResolvedValueOnce(new Response(JSON.stringify(completed())));
		const journal = vi.fn();
		const events = vi.fn();
		const dispatch = vi.fn(async () => ({ handled: true, data: { rate: 9 } }));
		const result = await decideYear(new OpenAIAdapter(options), dispatch,
			{ year: 1, report: {}, history: [] }, 'N', journal, events);
		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(dispatch.mock.calls[0]).toEqual(['tax.set', { rate: 9 }]);
		expect(sent(1).body.input.slice(2)).toEqual([...first,
			{ type: 'function_call_output', call_id: 'call-1', output: '{"handled":true,"data":{"rate":9}}' }]);
		expect(sent(2).body.input.slice(2)).toEqual([...first,
			{ type: 'function_call_output', call_id: 'call-1', output: '{"handled":true,"data":{"rate":9}}' }, ...second,
			{ type: 'function_call_output', call_id: 'call-2', output: '{"handled":true,"data":{"rate":9}}' }]);
		for (let index = 0; index < 3; index++) {
			expect(sent(index).body.store).toBe(false);
			expect(sent(index).body.include).toEqual(['reasoning.encrypted_content']);
			expect(sent(index).body).not.toHaveProperty('previous_response_id');
		}
		const persisted = JSON.stringify({ result, journal: journal.mock.calls, events: events.mock.calls });
		for (const forbidden of ['providerItems', 'encrypted_content', 'opaque-encrypted-reasoning', 'second-encrypted-reasoning', 'future_field']) {
			expect(persisted).not.toContain(forbidden);
		}
	});

	it('treats even an empty providerItems array as authoritative instead of duplicating synthetic content', async () => {
		respond();
		await new OpenAIAdapter(options).chat({ tools, messages: [{ role: 'assistant', content: 'Not replayed',
			toolCalls: [{ id: 'call-1', name: 'report.get', arguments: {} }], providerItems: [] }] });
		expect(sent().body.input).toEqual([]);
	});

	it('joins output_text and refusal parts in output order while preserving message metadata', async () => {
		const output: JSONObject[] = [{ ...message('First'), content: [
			{ type: 'output_text', text: 'First', annotations: [{ opaque: true }] },
			{ type: 'refusal', refusal: 'Cannot comply' }
		] }, { ...message('Last'), id: 'msg-2' }];
		respond(completed(output));
		expect(await new OpenAIAdapter(options).chat(request)).toMatchObject({
			content: 'First\nCannot comply\nLast', toolCalls: [], providerItems: output
		});
	});

	it.each([
		[undefined, 0, 0, false], [null, 0, 0, false],
		[{ input_tokens: 12, output_tokens: 7 }, 12, 7, true],
		[{ input_tokens: 0, output_tokens: 0 }, 0, 0, true],
		[{ input_tokens: 0 }, 0, 0, true], [{ output_tokens: 4 }, 0, 4, true],
		[{ input_tokens: -1, output_tokens: '9' }, 0, 0, false],
		[{ input_tokens: 1.5, output_tokens: Number.MAX_SAFE_INTEGER + 1 }, 0, 0, false],
		[{ prompt_tokens: 10, completion_tokens: 3 }, 0, 0, false]
	])('normalizes Responses token usage, preserving reported zero (%#)', async (usage, inputTokens, outputTokens, usageReported) => {
		respond(completed([message()], usage));
		expect(await new OpenAIAdapter(options).chat(request)).toMatchObject({
			usage: { inputTokens, outputTokens }, usageReported
		});
	});

	it.each([
		null, {}, { status: 'completed' }, { status: 'completed', output: {} },
		{ status: 'completed', output: [null] }, { status: 'completed', output: [{}] },
		completed([{ ...call(), id: '' }]), completed([{ ...call(), id: null }]),
		completed([{ ...call(), call_id: '' }]), completed([{ ...call(), call_id: 3 }]),
		completed([{ ...call(), name: '' }]), completed([{ ...call(), name: null }]),
		completed([{ ...call(), arguments: {} }]), completed([call(), call()]),
		completed([call(), { ...call('report_get', '{}', 'call-2'), id: 'fc-call-1' }]),
		completed([call(), { ...call(), id: 'fc-other' }]),
		completed([{ ...message(), role: 'user' }]), completed([{ ...message(), content: {} }]),
		completed([{ ...message(), content: [null] }]),
		completed([{ ...message(), content: [{ type: 'output_text', text: 3 }] }]),
		completed([{ ...message(), content: [{ type: 'refusal', refusal: null }] }])
	])('rejects malformed output as a sanitized protocol error without retrying (%#)', async value => {
		respond(value);
		await expect(new OpenAIAdapter({ ...options, maxRetries: 5 }).chat(request)).rejects.toMatchObject({
			kind: 'protocol', message: 'Invalid model response', status: 200, attempts: 1
		});
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it.each(['incomplete', 'failed', 'in_progress', 'queued', 'cancelled', undefined])('rejects non-completed status before partial calls can execute (%s)', async status => {
		respond({ ...completed([call()]), status, incomplete_details: { reason: 'max_output_tokens' }, error: { message: key } });
		await expect(new OpenAIAdapter(options).chat(request)).rejects.toMatchObject({
			kind: 'protocol', message: 'Invalid model response'
		});
	});

	it('rejects tool-name collisions and serialization failures without sending a request', async () => {
		const adapter = new OpenAIAdapter(options);
		await expect(adapter.chat({ ...request, tools: [tools[0], { ...tools[0], name: 'budget_set_funding' }] }))
			.rejects.toMatchObject({ kind: 'request', attempts: 0 });
		await expect(adapter.chat({ tools, messages: [{ role: 'assistant', content: '',
			toolCalls: [{ id: 'call-1', name: 'report.get', arguments: undefined }] }] }))
			.rejects.toThrow('Invalid tool arguments JSON');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reuses HTTP retries, fresh signals, metadata and redaction', async () => {
		fetchMock.mockResolvedValueOnce(new Response(`${key} ${endpoint} Bearer other-secret`, { status: 429 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(completed())));
		const onError = vi.fn();
		const metadata = vi.fn();
		const result = await new OpenAIAdapter({ ...options, maxRetries: 1, retryDelayMs: 0 })
			.chat({ ...request, onError, onRequestMetadata: metadata });
		expect(result.content).toBe('Ready');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(sent(0).init.body).toBe(sent(1).init.body);
		expect(sent(0).init.signal).not.toBe(sent(1).init.signal);
		expect(metadata.mock.calls.map(([value]) => value.attempts)).toEqual([1, 2]);
		expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'http', status: 429, attempts: 1 });
		for (const secret of [key, endpoint, 'provider.invalid', 'other-secret']) {
			expect(JSON.stringify(onError.mock.calls)).not.toContain(secret);
		}
	});

	it('reuses timeout bounds even when fetch ignores abort', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementation(() => new Promise(() => {}));
		const assertion = expect(new OpenAIAdapter({ ...options, timeoutMs: 10 }).chat(request))
			.rejects.toMatchObject({ kind: 'timeout', attempts: 1 });
		await vi.advanceTimersByTimeAsync(10);
		await assertion;
		expect(sent().init.signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('reuses cancellation without forwarding sensitive caller reasons', async () => {
		const controller = new AbortController();
		controller.abort(key);
		await expect(new OpenAIAdapter(options).chat({ ...request, signal: controller.signal }))
			.rejects.toMatchObject({ kind: 'cancelled', message: 'Model request aborted', attempts: 0 });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});