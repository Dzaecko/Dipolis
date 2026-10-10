/**
 * Dev-server only: starts the city runner as its own process and relays its live events as
 * Server-Sent Events. Credentials stay in the runner's environment and never reach the browser.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LiveEvent } from '../src/lib/city-run/live';
import { sendJson, type ApiHandler } from './city-runs';

const ALLOWED_SETTINGS = ['CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', 'CITY_MODEL_KEY', 'CITY_MODEL_ASSIGNMENT',
	'CITY_MODEL_RUN', 'CITY_MODEL_TIMEOUT_MS', 'CITY_MODEL_MAX_RETRIES', 'CITY_MODEL_MAX_TOKENS',
	'CITY_MODEL_REASONING_EFFORT', 'CITY_MODEL_API'];

// Keep the process events explicit even if a consuming TS project has incomplete Node event overloads.
type RunnerChild = ChildProcess & {
	on(event: 'message', listener: (message: unknown) => void): RunnerChild;
	on(event: 'exit', listener: (code: number | null) => void): RunnerChild;
	once(event: 'exit', listener: () => void): RunnerChild;
};

/** Same rules as scripts/start-city-model.ps1; throws without echoing values. */
export function readModelConfig(file: string): Record<string, string> {
	if (!existsSync(file)) throw new Error('Keine .env.city-model gefunden (Vorlage: .env.city-model.example).');
	const config: Record<string, string> = {};
	for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
		const text = line.trim();
		if (!text || text.startsWith('#')) continue;
		const match = /^([A-Z_]+)\s*=(.*)$/.exec(text);
		if (!match) throw new Error('Ungültige Konfigurationszeile: NAME=WERT erwartet.');
		const [, name, raw] = match as unknown as [string, string, string];
		if (!ALLOWED_SETTINGS.includes(name) || name in config) throw new Error(`Unbekannte oder doppelte Einstellung: ${name}`);
		let value = raw.trim();
		if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
			value = value.slice(1, -1);
		}
		config[name] = value;
	}
	for (const name of ['CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', 'CITY_MODEL_KEY']) {
		if (!config[name]?.trim()) throw new Error(`Bitte ${name} in .env.city-model ausfüllen.`);
	}
	let endpoint = config.CITY_MODEL_ENDPOINT!.replace(/\/+$/, '');
	if (/\/openai\/v1$/.test(endpoint)) endpoint += '/chat/completions';
	config.CITY_MODEL_ENDPOINT = endpoint;
	return config;
}

export interface StartRequest {
	adapter: 'openai' | 'fake';
	assignment: 'N' | 'R';
	handbook: 'on' | 'off';
	run: number;
	resume?: boolean;
	fakeDelayMs?: number;
}

export function parseStartRequest(value: unknown): StartRequest {
	const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	const adapter = body.adapter === 'fake' ? 'fake' : body.adapter === 'openai' ? 'openai' : null;
	const assignment = body.assignment === 'N' || body.assignment === 'R' ? body.assignment : null;
	const handbook = body.handbook === 'on' || body.handbook === 'off' ? body.handbook : null;
	const run = typeof body.run === 'number' && Number.isSafeInteger(body.run) && body.run >= 1 ? body.run : null;
	const delay = body.fakeDelayMs ?? 0;
	if (!adapter || !assignment || !handbook || !run) throw new Error('Ungültige Laufparameter.');
	if (typeof delay !== 'number' || !Number.isSafeInteger(delay) || delay < 0 || delay > 60_000) throw new Error('Ungültige Verzögerung.');
	return { adapter, assignment, handbook, run, resume: body.resume === true, fakeDelayMs: adapter === 'fake' ? delay : 0 };
}

type Listener = (session: number, event: LiveEvent) => void;

export interface LiveRunManagerOptions {
	/** apps/micropolis */
	appDirectory: string;
	/** Protocol output directory passed to the runner. */
	outputDirectory: string;
	/** .env.city-model, read only when a real model run starts. */
	configFile: string;
	stopTimeoutMs?: number;
}

export class LiveRunManager {
	private child: RunnerChild | null = null;
	private session = 0;
	private events: LiveEvent[] = [];
	private listeners = new Set<Listener>();
	private stopTimer: NodeJS.Timeout | null = null;

	constructor(private readonly options: LiveRunManagerOptions) {}

	get running(): boolean {
		return this.child !== null;
	}

	status() {
		const started = this.events.find((event) => event.type === 'run-started');
		const finished = this.events.find((event) => event.type === 'run-finished');
		return { running: this.running, session: this.session, started: started ?? null, finished: finished ?? null };
	}

	/** Model name only; endpoint and key are never exposed. */
	config(): { model: string | null; error?: string } {
		try { return { model: readModelConfig(this.options.configFile).CITY_MODEL_NAME ?? null }; }
		catch (error) { return { model: null, error: error instanceof Error ? error.message : 'Konfiguration unlesbar' }; }
	}

	subscribe(listener: Listener): () => void {
		for (const event of this.events) listener(this.session, event);
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	start(request: StartRequest): { session: number } {
		if (this.child) throw new Error('Es läuft bereits ein Lauf.');
		const env: NodeJS.ProcessEnv = {};
		for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('CITY_MODEL_')) env[key] = value;
		if (request.adapter === 'openai') Object.assign(env, readModelConfig(this.options.configFile));
		const args = ['--adapter', request.adapter, '--assignment', request.assignment, '--handbook', request.handbook,
			'--run', String(request.run), '--output', this.options.outputDirectory];
		if (request.resume) args.push('--resume');
		if (request.fakeDelayMs) args.push('--fake-delay-ms', String(request.fakeDelayMs));
		const child = fork(path.join(this.options.appDirectory, 'cli/model/run.ts'), args, {
			cwd: this.options.appDirectory, env, execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc']
		}) as RunnerChild;
		this.child = child;
		this.session++;
		this.events = [];
		const session = this.session;
		let lastError = '';
		child.stdout?.resume();
		child.stderr?.on('data', (chunk: Buffer) => {
			const lines = chunk.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
			if (lines.length) lastError = lines.at(-1)!;
		});
		child.on('message', (message) => {
			if (session === this.session && message && typeof message === 'object' && 'type' in message) this.publish(message as LiveEvent);
		});
		child.on('exit', (code) => {
			if (this.stopTimer) clearTimeout(this.stopTimer);
			this.stopTimer = null;
			this.child = null;
			if (session !== this.session || this.events.some((event) => event.type === 'run-finished')) return;
			// Startup errors (existing run number, missing configuration) carry no secrets.
			const started = this.events.some((event) => event.type === 'run-started');
			this.publish({ type: 'run-finished', status: 'failed', time: Date.now(),
				message: !started && lastError ? lastError : `Runner beendet (Code ${code ?? '?'}).` });
		});
		return { session };
	}

	/** Asks the runner to stop after writing a resumable protocol; kills it only after a timeout. */
	stop(): boolean {
		const child = this.child;
		if (!child) return false;
		if (child.connected) {
			try { child.send({ type: 'stop' }, (error) => { if (error) child.kill('SIGTERM'); }); }
			catch { child.kill('SIGTERM'); }
		} else child.kill('SIGTERM');
		this.stopTimer ??= setTimeout(() => child.kill('SIGKILL'), this.options.stopTimeoutMs ?? 30_000);
		return true;
	}

	/** Resolves when no runner is active. */
	async idle(): Promise<void> {
		const child = this.child;
		if (child) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
	}

	private publish(event: LiveEvent): void {
		this.events.push(event);
		for (const listener of this.listeners) listener(this.session, event);
	}
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	let text = '';
	for await (const chunk of req) {
		text += chunk;
		if (text.length > 10_000) throw new Error('Anfrage zu groß.');
	}
	return text ? JSON.parse(text) : {};
}

/** Blocks cross-site requests: a foreign page must not start paid model runs. */
function sameOrigin(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (origin) {
		try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
	}
	return (req.headers['content-type'] ?? '').startsWith('application/json');
}

function streamEvents(manager: LiveRunManager, req: IncomingMessage, res: ServerResponse): void {
	res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
	res.write('retry: 2000\n\n');
	const unsubscribe = manager.subscribe((session, event) => res.write(`data: ${JSON.stringify({ session, event })}\n\n`));
	// Everything before this marker is backlog; viewers join at the newest year instead of animating it.
	res.write(`event: synced\ndata: ${JSON.stringify({ session: manager.status().session, running: manager.running })}\n\n`);
	const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
	req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
}

export function liveRunHandlers(manager: LiveRunManager): ApiHandler {
	return async (req, res, url) => {
		const route = url.pathname;
		if (req.method === 'GET' && route === '/api/city-runs/live/events') {
			streamEvents(manager, req, res);
			return true;
		}
		if (req.method === 'GET' && route === '/api/city-runs/live/status') {
			sendJson(res, 200, { ...manager.status(), config: manager.config() });
			return true;
		}
		if (req.method === 'POST' && (route === '/api/city-runs/live/start' || route === '/api/city-runs/live/stop')) {
			if (!sameOrigin(req)) {
				sendJson(res, 403, { error: 'Nur vom eigenen Entwicklungsserver erlaubt.' });
				return true;
			}
			try {
				if (route.endsWith('/stop')) sendJson(res, 200, { stopping: manager.stop() });
				else sendJson(res, 200, manager.start(parseStartRequest(await readJson(req))));
			} catch (error) {
				sendJson(res, 400, { error: error instanceof Error ? error.message : 'Start fehlgeschlagen' });
			}
			return true;
		}
		return false;
	};
}
