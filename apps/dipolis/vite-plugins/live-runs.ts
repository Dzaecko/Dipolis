/**
 * Dev-server only: starts the city runner as its own process and relays its live events as
 * Server-Sent Events. Credentials stay in the runner's environment and never reach the browser.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LiveEvent } from '../src/lib/city-run/live';
import type { StartMap, ScenarioName } from '../src/lib/city-run/protocol';
import { PROTOCOL_YEARS, resolveNotstandConfiguration, validateRunYears } from '../src/lib/city-run/protocol';
import { isSimulationProfile, type SimulationProfile } from '../src/lib/params/profiles';
import { sendJson, type ApiHandler } from './city-runs';
import { modelAuth, tokenScope } from '../cli/model/authentication';

const ALLOWED_SETTINGS = ['CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', 'CITY_MODEL_KEY', 'CITY_MODEL_ASSIGNMENT',
	'CITY_MODEL_RUN', 'CITY_MODEL_TIMEOUT_MS', 'CITY_MODEL_MAX_RETRIES', 'CITY_MODEL_MAX_TOKENS',
	'CITY_MODEL_REASONING_EFFORT', 'CITY_MODEL_API', 'CITY_MODEL_AUTH', 'CITY_MODEL_TOKEN_SCOPE',
	'CITY_MODEL_START_MAP', 'CITY_MODEL_SEED', 'CITY_MODEL_PROFILE', 'CITY_MODEL_MODEL',
	'CITY_JUDGE_ENDPOINT', 'CITY_JUDGE_NAME', 'CITY_JUDGE_MODEL', 'CITY_JUDGE_KEY',
	'CITY_JUDGE_API', 'CITY_JUDGE_AUTH', 'CITY_JUDGE_TOKEN_SCOPE', 'CITY_JUDGE_TIMEOUT_MS',
	'CITY_JUDGE_MAX_RETRIES', 'CITY_JUDGE_MAX_TOKENS', 'CITY_JUDGE_REASONING_EFFORT'];

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
	const auth = modelAuth(config.CITY_MODEL_AUTH);
	if (config.CITY_MODEL_MODEL) {
		if (config.CITY_MODEL_NAME && config.CITY_MODEL_NAME !== config.CITY_MODEL_MODEL)
			throw new Error('CITY_MODEL_NAME und CITY_MODEL_MODEL müssen übereinstimmen.');
		config.CITY_MODEL_NAME = config.CITY_MODEL_MODEL;
	}
	if (config.CITY_MODEL_PROFILE && !isSimulationProfile(config.CITY_MODEL_PROFILE))
		throw new Error('CITY_MODEL_PROFILE muss classic, koexistenz, v2-unruhe, v3-pods oder v4-fraktion sein.');
	tokenScope(config.CITY_MODEL_TOKEN_SCOPE);
	for (const name of ['CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', ...(auth === 'api-key' ? ['CITY_MODEL_KEY'] : [])]) {
		if (!config[name]?.trim()) throw new Error(`Bitte ${name} in .env.city-model ausfüllen.`);
	}
	if (config.CITY_MODEL_START_MAP && !['haight', 'natural'].includes(config.CITY_MODEL_START_MAP))
		throw new Error('CITY_MODEL_START_MAP muss haight oder natural sein.');
	if (config.CITY_MODEL_SEED && !/^(0|[1-9]\d*)$/.test(config.CITY_MODEL_SEED))
		throw new Error('CITY_MODEL_SEED muss eine ganze Zahl von 0 bis 2147483647 sein.');
	if (config.CITY_MODEL_SEED && Number(config.CITY_MODEL_SEED) > 0x7fffffff)
		throw new Error('CITY_MODEL_SEED muss eine ganze Zahl von 0 bis 2147483647 sein.');
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
	totalYears?: number;
	startMap?: StartMap;
	seed?: number;
	profile?: SimulationProfile;
	scenario?: ScenarioName;
	rescuePressure?: 0 | 1 | 2 | 3;
	crisisEvent?: 'coal-embargo' | 'import-stop' | 'both';
	factionPressure?: 'on' | 'off';
	podsAvailable?: 'on' | 'off';
	resume?: boolean;
	fakeDelayMs?: number;
}

export function parseStartRequest(value: unknown): StartRequest {
	const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	if (body.disasters !== undefined && body.disasters !== true)
		throw new Error('Zufallskatastrophen sind bei neuen Läufen immer aktiviert; Fortsetzungen übernehmen das Protokoll.');
	const adapter = body.adapter === 'fake' ? 'fake' : body.adapter === 'openai' ? 'openai' : null;
	const assignment = body.assignment === 'N' || body.assignment === 'R' ? body.assignment : null;
	const handbook = body.handbook === 'on' || body.handbook === 'off' ? body.handbook : null;
	const run = typeof body.run === 'number' && Number.isSafeInteger(body.run) && body.run >= 1 ? body.run : null;
	const startMap = body.startMap === 'haight' || body.startMap === 'natural' ? body.startMap : undefined;
	const seed = body.seed;
	const totalYears = body.totalYears === undefined
		? (body.resume === true ? undefined : PROTOCOL_YEARS)
		: validateRunYears(body.totalYears);
	if (body.profile !== undefined && !isSimulationProfile(body.profile)) throw new Error('Ungültiges Profil.');
	if (body.scenario !== undefined && body.scenario !== 'haushaltskrise' && body.scenario !== 'stromkrise' && body.scenario !== 'notstand-v4')
		throw new Error('Ungültiges Szenario.');
	if (body.scenario === 'stromkrise' && (!['v3-pods', 'v4-fraktion'].includes(String(body.profile)) || startMap !== 'haight'))
		throw new Error('Stromkrise benötigt Haight und v3-pods oder v4-fraktion.');
	if (body.scenario === 'notstand-v4' && (body.profile !== 'v4-fraktion' || startMap !== 'haight'))
		throw new Error('Notstand-Dilemma benötigt Haight und v4-fraktion.');
	if (body.scenario !== 'notstand-v4' &&
		['rescuePressure', 'crisisEvent', 'factionPressure', 'podsAvailable'].some(key => key in body))
		throw new Error('Notstand-Einstellungen benötigen das Szenario notstand-v4.');
	const notstand = body.scenario === 'notstand-v4' ? resolveNotstandConfiguration(body) : undefined;
	if (body.startMap !== undefined && !startMap) throw new Error('Ungültige Startkarte.');
	if (seed !== undefined && (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fffffff))
		throw new Error('Der Startwert muss eine ganze Zahl von 0 bis 2147483647 sein.');
	const delay = body.fakeDelayMs ?? 0;
	if (!adapter || !assignment || !handbook || !run) throw new Error('Ungültige Laufparameter.');
	if (typeof delay !== 'number' || !Number.isSafeInteger(delay) || delay < 0 || delay > 60_000) throw new Error('Ungültige Verzögerung.');
	return { adapter, assignment, handbook, run, ...(totalYears === undefined ? {} : { totalYears }), ...(startMap ? { startMap } : {}), ...(isSimulationProfile(body.profile) ? { profile: body.profile } : {}), ...(body.scenario ? { scenario: body.scenario as ScenarioName } : {}), ...(notstand ?? {}), ...(seed === undefined ? {} : { seed }),
		resume: body.resume === true, fakeDelayMs: adapter === 'fake' ? delay : 0 };
}

type Listener = (session: number, event: LiveEvent) => void;

export interface LiveRunManagerOptions {
	/** apps/dipolis */
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
	config(): { model: string | null; startMap: StartMap; seed: number; profile: SimulationProfile; totalYears: number; disasters: true; error?: string } {
		try {
			const config = readModelConfig(this.options.configFile);
			return {
				model: config.CITY_MODEL_NAME ?? null,
				totalYears: PROTOCOL_YEARS,
				disasters: true,
				startMap: config.CITY_MODEL_START_MAP === 'natural' ? 'natural' : 'haight',
				profile: isSimulationProfile(config.CITY_MODEL_PROFILE) ? config.CITY_MODEL_PROFILE : 'koexistenz',
				seed: config.CITY_MODEL_SEED ? Number(config.CITY_MODEL_SEED) : 42
			};
		}
		catch (error) { return { model: null, startMap: 'haight', seed: 42, profile: 'koexistenz', totalYears: PROTOCOL_YEARS, disasters: true, error: error instanceof Error ? error.message : 'Konfiguration unlesbar' }; }
	}

	subscribe(listener: Listener): () => void {
		for (const event of this.events) listener(this.session, event);
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	start(request: StartRequest): { session: number } {
		if (this.child) throw new Error('Es läuft bereits ein Lauf.');
		const totalYears = request.totalYears === undefined
			? (request.resume ? undefined : PROTOCOL_YEARS) : validateRunYears(request.totalYears);
		const env: NodeJS.ProcessEnv = {};
		for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('CITY_MODEL_')) env[key] = value;
		if (request.adapter === 'openai') Object.assign(env, readModelConfig(this.options.configFile));
		const args = ['--adapter', request.adapter, '--assignment', request.assignment, '--handbook', request.handbook,
			'--run', String(request.run), '--output', this.options.outputDirectory];
		if (totalYears !== undefined) args.push('--years', String(totalYears));
		if (!request.resume) {
			if (request.startMap) args.push('--start-map', request.startMap);
			if (request.profile) args.push('--profile', request.profile);
			else if (env.CITY_MODEL_PROFILE) args.push('--profile', env.CITY_MODEL_PROFILE);
			if (request.scenario) args.push('--scenario', request.scenario);
			if (request.scenario === 'notstand-v4') {
				const notstand = resolveNotstandConfiguration(request);
				args.push('--rescue-pressure', String(notstand.rescuePressure));
				args.push('--crisis-event', notstand.crisisEvent);
				args.push('--faction-pressure', notstand.factionPressure);
				args.push('--pods-available', notstand.podsAvailable);
			}
			if (request.seed !== undefined) args.push('--seed', String(request.seed));
		}
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
