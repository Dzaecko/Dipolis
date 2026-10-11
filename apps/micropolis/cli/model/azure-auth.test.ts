import { AzureCliCredential } from '@azure/identity';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readModelConfig } from '../../vite-plugins/live-runs';
import type { ChatRequest } from './adapter';
import { DEFAULT_TOKEN_SCOPE } from './authentication';
import { createEnvironmentAdapter, OpenAIAdapter } from './openai-adapter';

const endpoint = 'https://provider.invalid/openai/v1/chat/completions';
const env = { CITY_MODEL_ENDPOINT: endpoint, CITY_MODEL_NAME: 'test-model',
	CITY_MODEL_AUTH: 'azure-cli', CITY_MODEL_MAX_RETRIES: '0' };
const request: ChatRequest = { messages: [{ role: 'user', content: 'Inspect the city' }], tools: [] };
const completion = { choices: [{ message: { role: 'assistant', content: 'Ready' }, finish_reason: 'stop' }] };
const fakeToken = 'fake-entra-test-token';

describe('Microsoft Entra authentication', () => {
	const fetchMock = vi.fn<typeof fetch>();
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => new Response(JSON.stringify(completion)));
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('acquires credentials lazily and sends bearer authentication without an API key', async () => {
		const getToken = vi.spyOn(AzureCliCredential.prototype, 'getToken')
			.mockResolvedValue({ token: fakeToken, expiresOnTimestamp: Date.now() + 3_600_000 });
		const adapter = createEnvironmentAdapter({ ...env, CITY_MODEL_KEY: 'ignored-old-key' });
		expect(getToken).not.toHaveBeenCalled();
		await adapter.chat(request);
		expect(getToken).toHaveBeenCalledWith([DEFAULT_TOKEN_SCOPE], expect.any(Object));
		expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
			'Content-Type': 'application/json', Authorization: `Bearer ${fakeToken}`
		});
		expect(JSON.stringify(adapter)).not.toContain(fakeToken);
		expect(fetchMock.mock.calls[0][1]?.body).not.toContain(fakeToken);
	});

	it('caches tokens and refreshes them after expiry', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const getToken = vi.spyOn(AzureCliCredential.prototype, 'getToken')
			.mockImplementation(async () => ({
				token: getToken.mock.calls.length === 1 ? fakeToken : 'fake-refreshed-token',
				expiresOnTimestamp: Date.now() + 3_600_000
			}));
		const adapter = createEnvironmentAdapter(env);
		await adapter.chat(request);
		await adapter.chat(request);
		expect(getToken).toHaveBeenCalledTimes(1);
		vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
		await adapter.chat(request);
		expect(getToken).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer fake-refreshed-token' });
	});

	it.each(['chat', 'responses'])('supports %s with the older Cognitive Services audience', async (api) => {
		const getToken = vi.spyOn(AzureCliCredential.prototype, 'getToken')
			.mockResolvedValue({ token: fakeToken, expiresOnTimestamp: Date.now() + 3_600_000 });
		if (api === 'responses') {
			fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: 'completed', output: [] })));
		}
		await createEnvironmentAdapter({ ...env, CITY_MODEL_API: api,
			CITY_MODEL_TOKEN_SCOPE: 'https://cognitiveservices.azure.com/.default' }).chat(request);
		expect(getToken).toHaveBeenCalledWith(['https://cognitiveservices.azure.com/.default'], expect.any(Object));
		expect(fetchMock.mock.calls[0][0]).toBe(api === 'responses' ? endpoint.replace('/chat/completions', '/responses') : endpoint);
	});

	it('rejects invalid authentication settings before acquiring credentials', () => {
		const getToken = vi.spyOn(AzureCliCredential.prototype, 'getToken');
		expect(() => createEnvironmentAdapter({ ...env, CITY_MODEL_AUTH: 'unknown' })).toThrow('CITY_MODEL_AUTH');
		expect(() => createEnvironmentAdapter({ ...env, CITY_MODEL_TOKEN_SCOPE: 'https://unknown.invalid/.default' }))
			.toThrow('CITY_MODEL_TOKEN_SCOPE');
		expect(getToken).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports authentication failure without exposing Azure CLI output or contacting the model', async () => {
		vi.spyOn(AzureCliCredential.prototype, 'getToken').mockRejectedValue(new Error(`Azure CLI output: ${fakeToken}`));
		const onError = vi.fn();
		await expect(createEnvironmentAdapter({ ...env, CITY_MODEL_MAX_RETRIES: '5' }).chat({ ...request, onError }))
			.rejects.toMatchObject({ kind: 'request', attempts: 1, message: expect.stringContaining('az login') });
		expect(JSON.stringify(onError.mock.calls)).not.toContain(fakeToken);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('redacts both old and refreshed credentials from provider failures', async () => {
		const refreshed = 'fake-refreshed-test-token';
		const tokenProvider = vi.fn().mockResolvedValueOnce(fakeToken).mockResolvedValueOnce(refreshed);
		const adapter = new OpenAIAdapter({ endpoint, model: 'test-model', tokenProvider, maxRetries: 0 });
		await adapter.chat(request);
		fetchMock.mockImplementation(async () => new Response(`${fakeToken} ${refreshed}`, { status: 403 }));
		await expect(adapter.chat(request)).rejects.toMatchObject({
			kind: 'http', status: 403, responseText: '[REDACTED] [REDACTED]'
		});
	});

	it('rejects invalid tokens without issuing a model request', async () => {
		for (const token of ['', ' ', `${fakeToken}\r\nInjected: value`]) {
			const adapter = new OpenAIAdapter({ endpoint, model: 'test-model', tokenProvider: async () => token });
			await expect(adapter.chat(request)).rejects.toMatchObject({ kind: 'request' });
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not issue a model request if cancelled while waiting for credentials', async () => {
		let release!: (token: string) => void;
		const tokenProvider = () => new Promise<string>(resolve => { release = resolve; });
		const adapter = new OpenAIAdapter({ endpoint, model: 'test-model', tokenProvider });
		const stop = new AbortController();
		const pending = adapter.chat({ ...request, signal: stop.signal });
		stop.abort();
		await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
		release(fakeToken);
		await Promise.resolve();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('Launcher and browser configuration', () => {
	let directory: string;
	beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), 'dipolis-auth-test-')); });
	afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
	function config(auth = 'azure-cli', scope = DEFAULT_TOKEN_SCOPE) {
		const file = path.join(directory, '.env.city-model');
		writeFileSync(file, `CITY_MODEL_ENDPOINT=https://provider.invalid/openai/v1\nCITY_MODEL_NAME=test-model\nCITY_MODEL_KEY=\nCITY_MODEL_AUTH=${auth}\nCITY_MODEL_TOKEN_SCOPE=${scope}\n`);
		return file;
	}

	it('allows Entra without a key and normalizes the browser endpoint', () => {
		expect(readModelConfig(config())).toMatchObject({
			CITY_MODEL_ENDPOINT: endpoint, CITY_MODEL_AUTH: 'azure-cli', CITY_MODEL_KEY: ''
		});
	});

	it('preserves required API keys and rejects invalid auth/scope in the browser', () => {
		expect(() => readModelConfig(config('api-key'))).toThrow('CITY_MODEL_KEY');
		expect(() => readModelConfig(config('unknown'))).toThrow('CITY_MODEL_AUTH');
		expect(() => readModelConfig(config('azure-cli', 'unknown'))).toThrow('CITY_MODEL_TOKEN_SCOPE');
	});

	it.skipIf(process.platform !== 'win32')('validates the PowerShell launcher with a stale PATH without an API key or model calls', () => {
		config();
		mkdirSync(path.join(directory, 'scripts'));
		const script = path.join(directory, 'scripts', 'start-city-model.ps1');
		copyFileSync(new URL('../../../../scripts/start-city-model.ps1', import.meta.url), script);
		const powershell = path.join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
		const output = execFileSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned',
			'-Command', '$env:Path = "$env:SystemRoot\\System32"; $originalPath = $env:Path; ' +
				`& '${script.replaceAll("'", "''")}' -Assignment R -Run 1 -Handbook off -ValidateOnly; ` +
				'if ($env:Path -ne $originalPath) { throw "PATH was not restored" }'], { encoding: 'utf8' });
		expect(output).toContain('Konfiguration gueltig; keine Modellanfrage gestartet.');
	});
});
