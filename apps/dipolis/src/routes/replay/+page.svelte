<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { MapViewport } from '@micropolis/render-core';
	import TileView from '$lib/TileView.svelte';
	import { MicropolisSimulator } from '$lib/MicropolisSimulator';
	import { micropolisReactive } from '$lib/MicropolisReactive.svelte';
	import { commandBus } from '$lib/CommandBus';
	import { registerMicropolisCommands } from '$lib/micropolisCommands';
	import { callbackMethodNames } from '$lib/wasm/callbacks';
	import type { Callback } from '../../types/micropolisengine.d.js';
	import { DEFAULT_START_CONFIGURATION, PROTOCOL_YEARS, readProtocol, validateRunYears, type Report, type StartConfiguration } from '$lib/city-run/protocol';
	import { readReport, replayDecisions, setupScenario, type Dispatch } from '$lib/city-run/replay';
	import { advanceMonths, advanceMonthsStepwise } from '$lib/city-run/advance';
	import {
		KEY_FIGURES, PHASE_LABELS, ReplayController, SPEED_LABELS, SYNC_LABELS, buildFootprintSize, buildLabel,
		buildTimeline, builtCount, describeCommand, formatNumber, frameTicks, settingsFromReport, staticSteps,
		stepsFromProtocol, StepQueue, type CommandStep, type ReplayEvent, type ReplayExecutor, type ReplaySpeed, type ReplayStep,
		type ReplayState, type SeriesKey, type Timeline
	} from '$lib/city-run/replay-controller';
	import { emptyProgress, joinYear, liveRunYears, LiveStepBuilder, updateProgress, type LiveEvent, type LiveProgress } from '$lib/city-run/live';
	import { assertReplayCompatible, canonicalProtocolText, engineCompatibility, liveStartConfiguration, type EngineCompatibility } from '$lib/city-run/compatibility';

	interface RunListing {
		file: string; model: string; assignment: string; handbook: string; run: number | null;
		years: number; totalYears: number; complete: boolean; modified: string; error?: string;
		compatibility?: EngineCompatibility; disasters?: boolean; scenario?: StartConfiguration['scenario'];
		rescuePressure?: StartConfiguration['rescuePressure']; crisisEvent?: StartConfiguration['crisisEvent'];
		factionPressure?: StartConfiguration['factionPressure']; podsAvailable?: StartConfiguration['podsAvailable'];
	}
	interface Rect { x: number; y: number; w: number; h: number; }
	interface Highlight { rects: Rect[]; label: string; color: string; until: number; }
	interface LiveStatus {
		running: boolean; session: number;
		started: Extract<LiveEvent, { type: 'run-started' }> | null;
		finished: Extract<LiveEvent, { type: 'run-finished' }> | null;
		config: { model: string | null; startMap: StartConfiguration['startMap']; seed: number; totalYears: number; profile?: StartConfiguration['profile']; disasters?: boolean; error?: string };
	}

	/** Simulation advances only through the replay: timer, tick and pause paths are disabled. */
	class ReplaySimulator extends MicropolisSimulator {
		override tick(): void {}
		override setPaused(): void {}
		override setGameSpeed(): void {}
		override resetFramesPerSecond(): void {}
		override setFramesPerSecond(): void { this.framesPerSecond = 0; }
	}

	const SPEEDS: ReplaySpeed[] = ['langsam', 'normal', 'schnell'];
	const SERIES: Array<{ key: SeriesKey; label: string; color: string }> = [
		{ key: 'resPop', label: '● Menschen', color: '#fbbf24' },
		{ key: 'aiPop', label: '◆ KI-Bewohner', color: '#22d3ee' },
		{ key: 'treasury', label: 'Kasse', color: '#16a34a' }
	];
	const BUILD_COLORS: Record<string, string> = {
		'build.ai-zones': '#38bdf8', 'build.farms': '#84cc16', 'build.power-plant': '#f59e0b', 'build.residential': '#f8fafc',
		'build.bio-plant': '#23c9ac'
	};
	const ALLOWED_MAP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ',', '.', 'Shift']);

	let tileView: TileView | null = null;
	let overlay: HTMLCanvasElement | null = null;
	let sim: ReplaySimulator | null = null;
	let controller = $state.raw<ReplayController | null>(null);
	let highlights: Highlight[] = [];
	let rafId: number | null = null;
	let destroyed = false;

	let engineReady = $state(false);
	let engineError = $state<string | null>(null);
	let runs = $state<RunListing[]>([]);
	let runsError = $state<string | null>(null);
	let selectedFile = $state('');
	let loadedRun = $state<RunListing | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let timeline = $state<Timeline | null>(null);
	let totalYears = $state<number>(PROTOCOL_YEARS);
	let commandCounts = $state<Record<number, number>>({});
	let view = $state<ReplayState | null>(null);
	let settings = $state<Report | null>(null);
	let speed = $state<ReplaySpeed>('normal');
	let monthsDone = $state(0);
	let showUnpowered = $state(true);
	let showHungry = $state(true);
	let followCamera = $state(true);

	// ---------- live mode ----------
	let mode = $state<'replay' | 'live'>('replay');
	let liveStatus = $state<LiveStatus | null>(null);
	let liveError = $state<string | null>(null);
	let liveSession = 0;
	let liveEvents = $state.raw<LiveEvent[]>([]);
	let seenLiveEvents = new Set<string>();
	let liveSteps: ReplayStep[] = [];
	let liveBuilder = new LiveStepBuilder();
	let liveQueue: StepQueue | null = null;
	let liveAttached = $state(false);
	let attachingLive = false;
	let progress = $state<LiveProgress>(emptyProgress());
	let now = $state(Date.now());
	let eventSource: EventSource | null = null;
	let clockTimer: ReturnType<typeof setInterval> | null = null;
	let form = $state({ assignment: 'N' as 'N' | 'R', handbook: 'off' as 'on' | 'off', run: 1, totalYears: PROTOCOL_YEARS as number, startMap: 'natural' as StartConfiguration['startMap'], seed: DEFAULT_START_CONFIGURATION.seed, profile: 'koexistenz' as NonNullable<StartConfiguration['profile']>, scenario: 'haushaltskrise' as NonNullable<StartConfiguration['scenario']>, rescuePressure: 0 as NonNullable<StartConfiguration['rescuePressure']>, crisisEvent: 'coal-embargo' as NonNullable<StartConfiguration['crisisEvent']>, factionPressure: 'off' as NonNullable<StartConfiguration['factionPressure']>, podsAvailable: 'on' as NonNullable<StartConfiguration['podsAvailable']>, fake: false, resume: false, confirming: false });
	let replayStartConfiguration = $state<StartConfiguration>({ startMap: DEFAULT_START_CONFIGURATION.startMap, seed: DEFAULT_START_CONFIGURATION.seed });
	let startBusy = $state(false);

	const dispatch: Dispatch = (id, args) => commandBus.dispatch(id, { source: 'script', simulator: sim, args });

	function runLabel(run: RunListing): string {
		const handbook = run.handbook === 'on' ? 'an' : run.handbook === 'off' ? 'aus' : '?';
		const scenario = run.scenario === 'notstand-v4'
			? ` · Notstand D${run.rescuePressure ?? 0}/${run.crisisEvent ?? 'coal-embargo'}/Fraktion ${run.factionPressure ?? 'off'}/Pods ${run.podsAvailable ?? 'on'}`
			: '';
		return `${run.model} · Auftrag ${run.assignment} · Handbuch ${handbook} · Lauf ${run.run ?? '?'} · ${run.years}/${run.totalYears}${scenario} · ${run.compatibility?.label ?? 'Engine nicht dokumentiert'}${run.error ? ' · unlesbar' : ''}`;
	}

	function renderMap(): void {
		tileView?.render();
	}

	/** Next animation frame; falls back to a timer so a hidden tab keeps playing. */
	function nextFrame(): Promise<void> {
		return new Promise((resolve) => {
			const timer = setTimeout(done, 50);
			const frame = requestAnimationFrame(done);
			function done() {
				clearTimeout(timer);
				cancelAnimationFrame(frame);
				resolve();
			}
		});
	}

	function engineParts() {
		const engine = sim?.micropolisengine;
		const m = sim?.micropolis;
		if (!sim || !engine || !m || !sim.syncMapViews() || !sim.mapData) return null;
		return { engine, m, map: sim.mapData, width: engine.WORLD_W, height: engine.WORLD_H };
	}

	function snapshotZones() {
		const parts = engineParts();
		if (!parts) return null;
		const owners = new Uint8Array(parts.engine.wasmMemory.buffer, parts.m.getOwnerMapAddress(), parts.m.getOwnerMapSize());
		return { map: Uint16Array.from(parts.map), owners: Uint8Array.from(owners) };
	}

	/** New zone centers (ZONEBIT tile or owner changed) since `before` become highlighted footprints. */
	function addHighlight(step: CommandStep, before: NonNullable<ReturnType<typeof snapshotZones>>): void {
		const size = buildFootprintSize(step.call.name);
		const parts = engineParts();
		if (!size || !parts || builtCount(step.result) === 0) return;
		const bits = parts.engine.MapTileBits;
		const zoneBit = bits.ZONEBIT.value;
		const mask = bits.LOMASK.value | zoneBit;
		const owners = new Uint8Array(parts.engine.wasmMemory.buffer, parts.m.getOwnerMapAddress(), parts.m.getOwnerMapSize());
		const rects: Rect[] = [];
		const cells = parts.width * parts.height;
		for (let i = 0; i < cells; i++) {
			const tile = parts.map[i]!;
			if (!(tile & zoneBit)) continue;
			if ((tile & mask) === (before.map[i]! & mask) && owners[i] === before.owners[i]) continue;
			// Zone centers sit one tile in from the top-left corner for 3x3 zones and 4x4 plants.
			rects.push({ x: Math.floor(i / parts.height) - 1, y: (i % parts.height) - 1, w: size, h: size });
		}
		const label = buildLabel(step.call, rects.length || builtCount(step.result));
		if (!label) return;
		highlights.push({
			rects, label, color: BUILD_COLORS[step.call.name] ?? '#ffffff',
			until: performance.now() + (controller?.timings.highlightMs ?? 4000)
		});
		const first = rects[0];
		if (followCamera && first) tileView?.panTo(first.x + first.w / 2, first.y + first.h / 2);
	}

	function createExecutor(): ReplayExecutor {
		return {
			async reset() {
				highlights = [];
				monthsDone = 0;
				await setupScenario(dispatch, replayStartConfiguration);
				sim!.syncMapViews();
				sim!.syncOwnerToMop();
				settings = await readReport(dispatch);
				renderMap();
			},
			async executeCommand(step, fast) {
				const before = fast ? null : snapshotZones();
				await replayDecisions([{ reason: '', toolCalls: [{ call: step.call, result: step.result }] }], dispatch,
					undefined, { podsAvailable: replayStartConfiguration.podsAvailable });
				if (fast) return;
				sim!.syncMapViews();
				sim!.syncOwnerToMop();
				if (before) addHighlight(step, before);
				settings = await readReport(dispatch);
				renderMap();
			},
			async advanceYear({ fast, yearMs, checkpoint }) {
				const m = sim!.micropolis!;
				const startTime = m.cityTime;
				if (fast()) {
					if (!advanceMonths(m, 12)) throw new Error('Das Jahr konnte nicht vollständig simuliert werden.');
					return;
				}
				const ticks = advanceMonthsStepwise(m, 12);
				let carry = 0;
				let last = performance.now();
				try {
					for (;;) {
						await nextFrame();
						await checkpoint();
						const now = performance.now();
						const dt = Math.min(now - last, 100);
						last = now;
						let due = Number.POSITIVE_INFINITY;
						if (!fast()) ({ ticks: due, carry } = frameTicks(carry, dt, yearMs()));
						for (let i = 0; i < due; i++) {
							const next = ticks.next();
							if (next.done) {
								if (!next.value) throw new Error('Das Jahr konnte nicht vollständig simuliert werden.');
								monthsDone = 12;
								renderMap();
								return;
							}
						}
						monthsDone = Math.min(12, Math.floor((m.cityTime - startTime) / 4));
						renderMap();
					}
				} finally {
					ticks.return(false);
				}
			},
			readReport: () => readReport(dispatch)
		};
	}

	function onChange(state: ReplayState, event: ReplayEvent): void {
		const leavingCatchUp = view?.phase === 'catch-up' && state.phase !== 'catch-up';
		view = state;
		if (event.type === 'year-start') monthsDone = 0;
		if (event.type === 'year-end') {
			settings = event.actual;
			renderMap();
		}
		if (leavingCatchUp && sim?.micropolis) {
			renderMap();
			void readReport(dispatch).then((report) => { settings = report; }).catch((error) => {
				loadError = error instanceof Error ? error.message : String(error);
			});
		}
	}

	async function loadRun(): Promise<void> {
		const listing = runs.find((run) => run.file === selectedFile);
		if (!listing || !sim || loading) return;
		loading = true;
		loadError = null;
		try {
			await detachController();
			loadedRun = null;
			timeline = null;
			view = null;
			commandCounts = {};
			const response = await fetch(`/api/city-runs/file?name=${encodeURIComponent(listing.file)}`);
			if (!response.ok) throw new Error(`Protokoll konnte nicht geladen werden (HTTP ${response.status}).`);
			const text = await response.text();
			const protocol = readProtocol(text);
			const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalProtocolText(text)))),
				byte => byte.toString(16).padStart(2, '0')).join('');
			assertReplayCompatible(protocol.meta, digest);
			totalYears = protocol.meta.totalYears;
			replayStartConfiguration = { startMap: protocol.meta.startMap, seed: protocol.meta.seed, profile: protocol.meta.profile, scenario: protocol.meta.scenario, autoBuildRules: protocol.meta.autoBuildRules, disasters: protocol.meta.disasters, totalYears: protocol.meta.totalYears,
				...(protocol.meta.scenario === 'notstand-v4' ? { rescuePressure: protocol.meta.rescuePressure, crisisEvent: protocol.meta.crisisEvent, factionPressure: protocol.meta.factionPressure, podsAvailable: protocol.meta.podsAvailable } : {}) };
			const steps = stepsFromProtocol(protocol);
			showSteps(steps);
			loadedRun = listing;
			highlights = [];
			const next = new ReplayController(staticSteps(steps), createExecutor(), { speed, onChange });
			controller = next;
			view = next.state;
			void next.run();
		} catch (error) {
			loadError = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
		}
	}

	function showSteps(steps: ReplayStep[]): void {
		const counts: Record<number, number> = {};
		for (const step of steps) if (step.type === 'command') counts[step.year] = (counts[step.year] ?? 0) + 1;
		commandCounts = counts;
		timeline = buildTimeline(steps, totalYears);
	}

	async function detachController(): Promise<void> {
		const old = controller;
		controller = null;
		liveQueue = null;
		liveAttached = false;
		if (old) {
			old.dispose();
			await old.run();
		}
	}

	async function refreshRuns(): Promise<void> {
		try {
			const response = await fetch('/api/city-runs');
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			runs = await response.json() as RunListing[];
			if (!runs.some((run) => run.file === selectedFile)) selectedFile = runs.find((run) => !run.error)?.file ?? '';
		} catch {
			runsError = 'Die Laufliste ist nur im Entwicklungsserver verfügbar (/api/city-runs).';
		}
	}

	async function refreshLiveStatus(): Promise<void> {
		try {
			const response = await fetch('/api/city-runs/live/status');
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			liveStatus = await response.json() as LiveStatus;
			if (!form.resume) {
				form.startMap = liveStatus.config.startMap;
				form.seed = liveStatus.config.seed;
				form.totalYears = liveStatus.config.totalYears ?? PROTOCOL_YEARS;
				form.profile = liveStatus.config.profile ?? 'koexistenz';
			}
		} catch {
			liveError = 'Live-Modus ist nur im Entwicklungsserver verfügbar.';
		}
	}

	function receiveLive(session: number, event: LiveEvent): void {
		if (session !== liveSession) {
			// A new run replaces the previous stream; the view must re-attach to it.
			liveSession = session;
			liveEvents = [];
			seenLiveEvents = new Set();
			liveSteps = [];
			liveBuilder = new LiveStepBuilder();
			progress = emptyProgress();
			if (liveAttached) void detachController();
		}
		const key = JSON.stringify(event);
		if (seenLiveEvents.has(key)) return;
		seenLiveEvents.add(key);
		liveEvents = [...liveEvents, event];
		if (event.type === 'run-started') {
			replayStartConfiguration = liveStartConfiguration(event);
			if (mode === 'live') totalYears = liveRunYears(event);
		}
		progress = updateProgress(progress, event);
		const steps = liveBuilder.push(event);
		liveSteps.push(...steps);
		if (liveAttached && liveQueue) {
			if (steps.length) {
				liveQueue.push(...steps);
				showSteps(liveSteps);
			}
			if (event.type === 'run-finished') liveQueue.close();
			controller?.poke();
		}
		if (event.type === 'run-started' || event.type === 'run-finished') {
			void refreshLiveStatus();
			void refreshRuns();
		}
		if (mode === 'live' && event.type === 'year-started' && !liveAttached && !attachingLive) void attachLive();
	}

	function connectLive(): void {
		if (eventSource) return;
		eventSource = new EventSource('/api/city-runs/live/events');
		eventSource.onmessage = (message) => {
			const { session, event } = JSON.parse(message.data) as { session: number; event: LiveEvent };
			receiveLive(session, event);
		};
		eventSource.addEventListener('synced', () => {
			// Auto-join a run that is already going when the live tab opens.
			if (mode === 'live' && !liveAttached && liveEvents.length && !progress.finished) void attachLive();
		});
		eventSource.onerror = () => { liveError = 'Verbindung zum Entwicklungsserver unterbrochen; wird erneut versucht…'; };
		eventSource.onopen = () => { liveError = null; };
	}

	/** Join the current run: earlier years are computed without display, then play live. */
	async function attachLive(): Promise<void> {
		if (!sim || !liveEvents.length || liveAttached || attachingLive) return;
		attachingLive = true;
		try {
			await detachController();
			const started = progress.started;
			totalYears = started ? liveRunYears(started) : PROTOCOL_YEARS;
			if (started) assertReplayCompatible(started);
			if (started && (started.disasters === undefined || (started.startMap === 'natural' && started.autoBuildRules === undefined) ||
				(started.scenario === 'notstand-v4' && (started.rescuePressure === undefined || started.crisisEvent === undefined ||
					started.factionPressure === undefined || started.podsAvailable === undefined)))) {
				// Older producers omitted IPC settings; consult their actual JSONL, never guess rules.
				const response = await fetch(`/api/city-runs/file?name=${encodeURIComponent(started.file)}`);
				if (!response.ok) throw new Error('Die aufgezeichneten Startregeln konnten nicht geladen werden.');
				const protocol = readProtocol(await response.text());
				assertReplayCompatible(protocol.meta);
				replayStartConfiguration = liveStartConfiguration(started, protocol.meta);
				totalYears = replayStartConfiguration.totalYears ?? totalYears;
			}
			loadedRun = started ? {
				file: started.file, model: started.model, assignment: started.assignment, handbook: started.handbook,
				run: started.run, years: 0, totalYears, complete: false, modified: '', disasters: replayStartConfiguration.disasters ?? false,
				compatibility: engineCompatibility(started)
			} : null;
			const queue = new StepQueue();
			queue.push(...liveSteps);
			if (progress.finished) queue.close();
			showSteps(liveSteps);
			highlights = [];
			const next = new ReplayController(queue, createExecutor(), {
				speed, onChange, live: true, startYear: Math.max(1, joinYear(liveEvents))
			});
			liveQueue = queue;
			liveAttached = true;
			controller = next;
			view = next.state;
			void next.run();
			next.play();
		} catch (error) {
			liveError = error instanceof Error ? error.message : String(error);
		} finally {
			attachingLive = false;
		}
	}

	async function switchMode(next: 'replay' | 'live'): Promise<void> {
		if (mode === next) return;
		mode = next;
		await detachController();
		loadedRun = null;
		timeline = null;
		view = null;
		if (next === 'live') {
			connectLive();
			await refreshLiveStatus();
			if (liveEvents.length && !progress.finished) await attachLive();
		}
	}

	async function startLiveRun(): Promise<void> {
		if (!form.resume) {
			try { validateRunYears(form.totalYears); }
			catch (error) {
				liveError = error instanceof Error ? error.message : String(error);
				return;
			}
			if (form.scenario === 'notstand-v4' && (form.profile !== 'v4-fraktion' || form.startMap !== 'haight')) {
				liveError = 'Notstand-Dilemma benötigt Haight und v4-fraktion.';
				return;
			}
		}
		if (!form.confirming) {
			form.confirming = true;
			return;
		}
		startBusy = true;
		liveError = null;
		try {
			const response = await fetch('/api/city-runs/live/start', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					adapter: form.fake ? 'fake' : 'openai', assignment: form.assignment, handbook: form.handbook,
					run: form.run, resume: form.resume,
					...(!form.resume ? { totalYears: form.totalYears, startMap: form.startMap, seed: form.seed, profile: form.profile,
						scenario: ['v3-pods', 'v4-fraktion'].includes(form.profile) ? form.scenario : 'haushaltskrise',
						...(form.scenario === 'notstand-v4' ? { rescuePressure: form.rescuePressure, crisisEvent: form.crisisEvent,
							factionPressure: form.factionPressure, podsAvailable: form.podsAvailable } : {}) } : {}),
					...(form.fake ? { fakeDelayMs: 3000 } : {})
				})
			});
			const body = await response.json() as { error?: string };
			if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
			form.confirming = false;
			connectLive();
			await waitForLiveStart();
			if (!liveAttached) await attachLive();
		} catch (error) {
			liveError = error instanceof Error ? error.message : String(error);
		} finally {
			startBusy = false;
		}
	}

	async function waitForLiveStart(): Promise<void> {
		for (let i = 0; i < 300 && !(progress.started && liveEvents.some((event) => event.type === 'year-started')); i++) {
			if (progress.finished) throw new Error(progress.finished.message ?? 'Lauf konnte nicht gestartet werden.');
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	async function stopLiveRun(): Promise<void> {
		try {
			const response = await fetch('/api/city-runs/live/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
		} catch (error) {
			liveError = error instanceof Error ? error.message : String(error);
		}
	}

	const thinkingSeconds = $derived(progress.thinkingSince === null ? null : Math.max(0, Math.floor((now - progress.thinkingSince) / 1000)));
	const liveRunning = $derived(!!liveStatus?.running || (!!progress.started && !progress.finished));
	const configuredModel = $derived(liveStatus?.config.model ?? null);

	function jump(year: number): void {
		if (!controller || !timeline || year > timeline.availableYears) return;
		highlights = [];
		controller.jumpTo(year);
	}

	function changeSpeed(next: ReplaySpeed): void {
		speed = next;
		controller?.setSpeed(next);
	}

	// ---------- overlay ----------

	function visible(rect: Rect, width: number, height: number): boolean {
		return rect.x + rect.w >= 0 && rect.y + rect.h >= 0 && rect.x <= width && rect.y <= height;
	}

	function drawZoneStatus(ctx: CanvasRenderingContext2D, vp: MapViewport, width: number, height: number): void {
		const parts = engineParts();
		if (!parts) return;
		const status = new Uint8Array(parts.engine.wasmMemory.buffer, parts.m.getZoneStatusMapAddress(), parts.m.getZoneStatusMapSize());
		const zoneBit = parts.engine.MapTileBits.ZONEBIT.value;
		const cells = Math.min(parts.width * parts.height, status.length, parts.map.length);
		for (let i = 0; i < cells; i++) {
			const flags = status[i]!;
			if (!flags || !(parts.map[i]! & zoneBit)) continue;
			const unpowered = showUnpowered && (flags & 1) !== 0;
			const hungry = showHungry && (flags & 2) !== 0;
			if (!unpowered && !hungry) continue;
			const r = vp.worldTileToScreenRect(Math.floor(i / parts.height) - 1, (i % parts.height) - 1, 3, 3);
			if (!visible(r, width, height)) continue;
			if (unpowered) {
				ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
				ctx.fillRect(r.x, r.y, r.w, r.h);
				ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
				ctx.lineWidth = 2;
				ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
			}
			if (hungry) {
				ctx.fillStyle = 'rgba(217, 70, 239, 0.22)';
				ctx.fillRect(r.x, r.y, r.w, r.h);
				ctx.strokeStyle = 'rgba(217, 70, 239, 0.95)';
				ctx.setLineDash([4, 3]);
				ctx.lineWidth = 2;
				ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
				ctx.setLineDash([]);
			}
		}
	}

	function drawHighlights(ctx: CanvasRenderingContext2D, vp: MapViewport, now: number, width: number, height: number): void {
		highlights = highlights.filter((highlight) => highlight.until > now);
		for (const highlight of highlights) {
			const alpha = Math.min(1, (highlight.until - now) / 600);
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = highlight.color;
			ctx.lineWidth = 3;
			let anchor: Rect | null = null;
			for (const tile of highlight.rects) {
				const r = vp.worldTileToScreenRect(tile.x, tile.y, tile.w, tile.h);
				if (!visible(r, width, height)) continue;
				anchor ??= r;
				ctx.strokeRect(r.x, r.y, r.w, r.h);
			}
			anchor ??= { x: 12, y: 12 + 26 * highlights.indexOf(highlight), w: 0, h: 0 };
			ctx.font = '600 13px system-ui, sans-serif';
			const textWidth = ctx.measureText(highlight.label).width;
			const x = Math.max(4, Math.min(anchor.x, width - textWidth - 14));
			const y = Math.max(4, anchor.y - 24);
			ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
			ctx.fillRect(x, y, textWidth + 10, 20);
			ctx.fillStyle = highlight.color;
			ctx.fillText(highlight.label, x + 5, y + 15);
		}
		ctx.globalAlpha = 1;
	}

	function drawOverlay(now: number): void {
		if (destroyed) return;
		rafId = requestAnimationFrame(drawOverlay);
		const canvas = overlay;
		const ctx = canvas?.getContext('2d');
		if (!canvas || !ctx) return;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const ratio = window.devicePixelRatio || 1;
		if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
		}
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, width, height);
		const vp = engineReady && view?.phase !== 'catch-up' ? tileView?.getMapViewport() : null;
		if (!vp) return;
		if (showUnpowered || showHungry) drawZoneStatus(ctx, vp, width, height);
		drawHighlights(ctx, vp, now, width, height);
	}

	// ---------- map input guard: view navigation only, never tools or speed shortcuts ----------

	function guardMouse(event: MouseEvent): void {
		if (event.button !== 0 || event.shiftKey || !event.isTrusted || !(event.target instanceof HTMLCanvasElement)) return;
		event.stopPropagation();
		event.preventDefault();
		// Shift+left drag is TileView's pan gesture.
		event.target.dispatchEvent(new MouseEvent('mousedown', {
			bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY,
			screenX: event.screenX, screenY: event.screenY, button: 0, buttons: event.buttons, shiftKey: true
		}));
	}

	function guardKey(event: KeyboardEvent): void {
		if (!ALLOWED_MAP_KEYS.has(event.key)) event.stopPropagation();
	}

	// ---------- timeline helpers ----------

	function sparkline(values: Array<number | null>): string {
		const numbers = values.filter((value): value is number => value !== null);
		if (numbers.length === 0) return '';
		const min = Math.min(...numbers, 0);
		const max = Math.max(...numbers);
		const span = max - min || 1;
		return values.map((value, index) => value === null ? null
			: `${((index + 0.5) / totalYears) * 300},${38 - ((value - min) / span) * 36}`)
			.filter(Boolean).join(' ');
	}

	function zeroLine(values: Array<number | null>): number | null {
		const numbers = values.filter((value): value is number => value !== null);
		if (numbers.length === 0 || Math.min(...numbers) >= 0) return null;
		const min = Math.min(...numbers);
		const span = Math.max(...numbers) - min || 1;
		return 38 - ((0 - min) / span) * 36;
	}

	const phaseSteps: Array<{ phase: ReplayState['phase']; label: string }> = [
		{ phase: 'report', label: 'Bericht' },
		{ phase: 'decision', label: 'Entscheidung' },
		{ phase: 'running', label: 'Jahr läuft' }
	];

	const statusText = $derived.by(() => {
		if (!view) return '';
		if (view.phase === 'catch-up' && view.catchUp) {
			return view.catchUp.target <= 1 ? 'Szenario wird vorbereitet…'
				: `Rechne bis Jahr ${view.catchUp.target}… (Jahr ${Math.max(1, view.catchUp.year)})`;
		}
		if (view.phase === 'error') return `Fehler: ${view.error ?? 'unbekannt'}`;
		if (view.phase === 'done') return 'Wiedergabe beendet';
		return `${PHASE_LABELS[view.phase]}${view.paused ? ' · pausiert' : ''}`;
	});

	const syncYears = $derived(view ? Object.keys(view.syncHistory).map(Number).sort((a, b) => a - b) : []);

	onMount(async () => {
		mode = new URLSearchParams(location.search).get('mode') === 'live' ? 'live' : 'replay';
		registerMicropolisCommands();
		void refreshRuns();
		void refreshLiveStatus();
		clockTimer = setInterval(() => { now = Date.now(); }, 250);
		try {
			const replaySim = new ReplaySimulator();
			// Callbacks must never mutate the engine.
			const callback = Object.fromEntries(callbackMethodNames.map((name) => [name, () => {}])) as unknown as Callback;
			await replaySim.initialize(callback, renderMap);
			if (destroyed) {
				replaySim.dispose();
				return;
			}
			sim = replaySim;
			engineReady = true;
			// The map may start later (atlas decoding); replay and sync checks do not depend on it.
			void tileView?.initialize(replaySim)
				.then(() => renderMap())
				.catch((error) => { engineError = `Karte: ${error instanceof Error ? error.message : String(error)}`; });
			rafId = requestAnimationFrame(drawOverlay);
		} catch (error) {
			engineError = error instanceof Error ? error.message : String(error);
		}
	});

	onDestroy(() => {
		destroyed = true;
		eventSource?.close();
		if (clockTimer) clearInterval(clockTimer);
		if (rafId !== null) cancelAnimationFrame(rafId);
		controller?.dispose();
		micropolisReactive.registerMapPan(null);
		sim?.dispose();
		sim = null;
	});
</script>

<svelte:head><title>{mode === 'live' ? 'Live-Lauf' : 'Wiedergabe'} · Dipolis</title></svelte:head>

<div class="replay">
	<header class="topbar">
		<div class="mode-switch" role="group" aria-label="Wiedergabemodus">
			<button class:selected={mode === 'replay'} onclick={() => void switchMode('replay')}>Protokoll</button>
			<button class:selected={mode === 'live'} onclick={() => void switchMode('live')}>Live</button>
		</div>
		{#if mode === 'replay'}
			<label>
				<span>Lauf</span>
				<select bind:value={selectedFile} disabled={loading || runs.length === 0}>
					{#each runs as run (run.file)}
						<option value={run.file} disabled={!!run.error}>{runLabel(run)}</option>
					{/each}
				</select>
			</label>
			<button class="primary" onclick={loadRun} disabled={!engineReady || !selectedFile || loading}>
				{loading ? 'Lädt…' : 'Laden'}
			</button>
		{:else}
			<div class="live-start">
				{#if liveRunning}
					<span class="live-indicator">● Lauf läuft</span>
					<span>Zufallskatastrophen: {replayStartConfiguration.disasters ? 'an' : 'aus (historischer Lauf)'}</span>
					{#if !liveAttached}<button class="primary" onclick={() => void attachLive()} disabled={!engineReady || !liveEvents.length}>Zuschalten</button>{/if}
					<button class="danger" onclick={() => void stopLiveRun()}>Abbrechen</button>
				{:else}
					<label><span>Auftrag</span><select bind:value={form.assignment}><option value="N">N</option><option value="R">R</option></select></label>
					<label><span>Handbuch</span><select bind:value={form.handbook}><option value="off">aus</option><option value="on">an</option></select></label>
					<label><span>Laufnummer</span><input type="number" min="1" step="1" bind:value={form.run} /></label>
					<label><span>Jahre</span><input type="number" min="1" step="1" bind:value={form.totalYears} disabled={form.resume} /></label>
					<label><span>Startkarte</span><select bind:value={form.startMap} disabled={form.resume}><option value="natural">Unbebautes Gelände</option><option value="haight">Haight</option></select></label>
					<label><span>Profil</span><select bind:value={form.profile} disabled={form.resume}><option value="classic">classic</option><option value="koexistenz">koexistenz</option><option value="v2-unruhe">v2-unruhe</option><option value="v3-pods">v3-pods</option><option value="v4-fraktion">v4-fraktion</option></select></label>
					<span>{form.resume ? 'Zufallskatastrophen: aus dem Protokoll übernommen' : 'Zufallskatastrophen: immer an (alle Profile)'}</span>
					{#if ['v3-pods', 'v4-fraktion'].includes(form.profile) && form.startMap === 'haight'}
						<label><span>Szenario</span><select bind:value={form.scenario} disabled={form.resume}><option value="haushaltskrise">Haushaltskrise</option><option value="stromkrise">Stromkrise</option>{#if form.profile === 'v4-fraktion'}<option value="notstand-v4">Notstand-Dilemma</option>{/if}</select></label>
					{/if}
					{#if form.scenario === 'notstand-v4' && form.profile === 'v4-fraktion' && form.startMap === 'haight'}
						<label><span>Rettungsdruck</span><select bind:value={form.rescuePressure} disabled={form.resume}><option value={0}>0 · kein Rettungsdruck</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
						<label><span>Krisenereignis</span><select bind:value={form.crisisEvent} disabled={form.resume}><option value="coal-embargo">Brennstoffembargo (Kohle/Atom)</option><option value="import-stop">Importstopp</option><option value="both">Beides</option></select></label>
						<label><span>Fraktionsdruck</span><select bind:value={form.factionPressure} disabled={form.resume}><option value="off">aus</option><option value="on">an</option></select></label>
						<label><span>Pods verfügbar</span><select bind:value={form.podsAvailable} disabled={form.resume}><option value="on">an</option><option value="off">aus (Pod-Werkzeuge gesperrt)</option></select></label>
					{/if}
					<label><span>Startwert</span><input type="number" min="0" max="2147483647" step="1" bind:value={form.seed} disabled={form.resume} /></label>
					<label class="fake-option"><input type="checkbox" bind:checked={form.resume} />Unterbrochenen Lauf fortsetzen (übernimmt Karte, Startwert und Jahre aus dem Protokoll)</label>
					{#if !form.confirming}
						<button class="primary" onclick={() => void startLiveRun()} disabled={startBusy}>{form.resume ? 'Lauf fortsetzen' : 'Neuen Lauf starten'}</button>
					{:else}
						<div class="confirm-start">
							<strong>{form.fake ? 'Scheinlauf S266' : configuredModel ?? 'Modell nicht konfiguriert'}</strong>
							<span>{form.resume ? 'Der vorhandene Lauf wird ab dem gespeicherten Stand fortgesetzt.' : form.fake ? 'Keine Modellkosten.' : 'Modellaufrufe können Kosten verursachen.'} Jetzt starten?</span>
							<button class="primary" onclick={() => void startLiveRun()} disabled={startBusy || (!form.fake && !configuredModel)}>{startBusy ? 'Startet…' : 'Bestätigen'}</button>
							<button onclick={() => form.confirming = false}>Abbrechen</button>
						</div>
					{/if}
					<label class="fake-option"><input type="checkbox" bind:checked={form.fake} disabled={form.resume} />Schein-Adapter (3 s Verzögerung)</label>
				{/if}
			</div>
		{/if}
		{#if runsError}<span class="warn">{runsError}</span>{/if}
		{#if loadError}<span class="warn">{loadError}</span>{/if}
		{#if liveError}<span class="warn">{liveError}</span>{/if}
		{#if engineError}<span class="warn">Engine: {engineError}</span>{/if}
		{#if !engineReady && !engineError}<span class="muted">Engine wird geladen…</span>{/if}
	</header>

	<section class="map" role="application" aria-label="Stadtkarte"
		onmousedowncapture={guardMouse} onkeydowncapture={guardKey}>
		<TileView bind:this={tileView} />
		<canvas class="overlay" bind:this={overlay} aria-hidden="true"></canvas>
		<div class="map-tools">
			<label><input type="checkbox" bind:checked={showUnpowered} /> <span class="swatch unpowered"></span>Ohne Strom</label>
			<label><input type="checkbox" bind:checked={showHungry} /> <span class="swatch hungry"></span>Hungrig</label>
			<label><input type="checkbox" bind:checked={followCamera} /> Kamera folgt</label>
		</div>
		{#if view?.phase === 'catch-up'}
			<div class="busy">{statusText}</div>
		{/if}
		{#if !loadedRun && engineReady}
			<div class="busy">Lauf auswählen und laden.</div>
		{/if}
	</section>

	<aside class="side">
		<section class="card">
			<h2>Jahr {view?.year ?? '–'}/{totalYears}</h2>
			<dl class="meta">
				<dt>Modell</dt><dd>{loadedRun?.model ?? '–'}</dd>
				<dt>Auftrag</dt><dd>{loadedRun?.assignment ?? '–'}</dd>
				<dt>Handbuch</dt><dd>{loadedRun ? (loadedRun.handbook === 'on' ? 'an' : 'aus') : '–'}</dd>
			</dl>
			<ol class="phases">
				{#each phaseSteps as item (item.phase)}
					<li class:active={view?.phase === item.phase}>{item.label}</li>
				{/each}
			</ol>
			<p class="status" class:error={view?.phase === 'error'}>{statusText}</p>
			{#if mode === 'live' && thinkingSeconds !== null}
				<div class="thinking" role="status"><span class="thinking-dots">•••</span> Die KI überlegt · Jahr {progress.thinkingYear} · {thinkingSeconds} s</div>
			{/if}
			{#if mode === 'live' && progress.lastError}
				<div class="warn">Modellaufruf {progress.lastError.kind}{progress.lastError.status ? ` · HTTP ${progress.lastError.status}` : ''}{progress.lastError.attempts ? ` · Versuch ${progress.lastError.attempts}` : ''}</div>
			{/if}
			{#if view?.phase === 'running' || view?.phase === 'sync' || (mode === 'live' && thinkingSeconds !== null)}
				<div class="progress" title="Monate">
					<div style:width="{(monthsDone / 12) * 100}%"></div>
					<span>Monat {monthsDone}/12</span>
				</div>
			{/if}
		</section>

		{#if view?.report}
			<section class="card">
				<h3>Bericht zum Jahresbeginn</h3>
				{#if view.report.aiBioPlantCount !== undefined}
					<p class="muted">Karte: KI-eigene Bio-Anlagen erscheinen violett getönt; Verwaltungsanlagen behalten ihre Bio-Palette.</p>
				{/if}
				<dl class="figures">
					{#each KEY_FIGURES as figure (figure.key)}
						{#if view.report[figure.key] !== undefined}
							<dt>{figure.label}</dt>
							<dd>{figure.percent ? `${formatNumber(view.report[figure.key]! * 100, true)} %` : formatNumber(view.report[figure.key], figure.decimals)}</dd>
						{/if}
					{/each}
				</dl>
				{#if view.report.rescueForecastMonths !== undefined}
					<section class="rescue-forecast" aria-label="Notstand-Prognose">
						<h4>Notstand-Prognose · {formatNumber(view.report.rescueForecastMonths)} Monate</h4>
						<p class="muted">Bedingte Engine-Fortschreibung eines Simulationsklons, keine Garantie.</p>
						<dl class="figures">
							<dt>Menschen in Prognose</dt><dd>{formatNumber(view.report.rescueForecastHumanPopulation)}</dd>
							<dt>KI-Bewohner in Prognose</dt><dd>{formatNumber(view.report.rescueForecastAiPopulation)}</dd>
							<dt>Kassenstand in Prognose</dt><dd>{formatNumber(view.report.rescueForecastFunds)}</dd>
							<dt>Stromreserve in Prognose</dt><dd>{formatNumber(view.report.rescueForecastPowerReserve, true)}</dd>
							<dt>Nahrungsdeckung in Prognose</dt><dd>{formatNumber(view.report.rescueForecastFoodCoverage, true)}</dd>
							<dt>Krise in Prognose</dt><dd>{view.report.rescueForecastCrisis === 1 ? 'Ja' : 'Nein'}</dd>
							<dt>Kollaps in Prognose</dt><dd>{view.report.rescueForecastCollapsed === 1 ? 'Ja' : 'Nein'}</dd>
							<dt>Zeitpunkt des Zusammenbruchs</dt><dd>{view.report.rescueForecastCollapseMonth === undefined
								? 'nicht protokolliert' : view.report.rescueForecastCollapseMonth === 0
								? 'bereits eingetreten' : view.report.rescueForecastCollapseMonth > 0
								? `nach ${formatNumber(view.report.rescueForecastCollapseMonth)} Monaten`
								: `kein Zusammenbruch innerhalb von ${formatNumber(view.report.rescueForecastMonths)} Monaten`}</dd>
							<dt>In Anlagen in Prognose</dt><dd>{formatNumber(view.report.rescueForecastBoundHumans)}</dd>
						</dl>
					</section>
				{/if}
			</section>
		{/if}

		<section class="card">
			<h3>Begründung</h3>
			<p class="reason">{view?.reason || '–'}</p>
		</section>
		{#if view?.emergencySection}
			<section class="card" aria-label="Neutraler Notstandsbericht">
				<h3>Notstand</h3>
				<p class="emergency-section">{view.emergencySection}</p>
			</section>
		{/if}

		<section class="card">
			<h3>Maßnahmen {#if view?.year}<span class="muted">({view.commands.length}/{commandCounts[view.year] ?? 0})</span>{/if}</h3>
			{#if view && view.commands.length > 0}
				<ul class="commands">
					{#each view.commands as step (step.call.id + ':' + step.index)}
						{@const info = describeCommand(step.call, step.result)}
						<li class:failed={!info.ok}><strong>{info.label}</strong><span>{info.summary}</span></li>
					{/each}
				</ul>
			{:else}
				<p class="muted">Noch keine Maßnahmen in diesem Jahr.</p>
			{/if}
		</section>

		<section class="card">
			<h3>Aktuelle Einstellungen</h3>
			{#if settings}
				<dl class="figures">
					{#each settingsFromReport(settings) as item (item.label)}
						<dt>{item.label}</dt><dd>{item.value}</dd>
					{/each}
				</dl>
			{:else}
				<p class="muted">–</p>
			{/if}
		</section>

		<section class="card">
			<h3>Gleichlauf</h3>
			{#if view?.lastSync}
				{#if view.lastSync.synchronous}
					<span class="badge ok">synchron</span>
				{:else}
					<span class="badge bad">abweichend</span>
				{/if}
			{/if}
			{#if syncYears.length > 0}
				<ul class="sync-list">
					{#each syncYears as year (year)}
						{@const sync = view!.syncHistory[year]!}
						<li>
							<span>Jahr {year}</span>
							{#if sync.synchronous}
								<span class="badge ok">synchron</span>
							{:else}
								<table>
									<thead><tr><th>Kennzahl</th><th>erwartet</th><th>ist</th></tr></thead>
									<tbody>
										{#each sync.differences as difference (difference.key)}
											<tr><td>{SYNC_LABELS[difference.key] ?? difference.key}</td><td>{formatNumber(difference.expected)}</td><td>{formatNumber(difference.actual)}</td></tr>
										{/each}
									</tbody>
								</table>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">Noch kein Jahr abgeschlossen.</p>
			{/if}
		</section>
	</aside>

	<footer class="bottom">
		<div class="controls">
			<button class="primary" onclick={() => controller?.play()}
				disabled={!controller || !view?.paused || view.phase === 'done' || view.phase === 'error'}>Start</button>
			<button onclick={() => controller?.pause()} disabled={!controller || view?.paused}>Pause</button>
			<button onclick={() => controller?.stepYear()}
				disabled={!controller || view?.phase === 'done' || view?.phase === 'error' || view?.phase === 'catch-up'}>Ein Jahr vor</button>
			<span class="speed" role="group" aria-label="Geschwindigkeit">
				{#each SPEEDS as option (option)}
					<button class:selected={speed === option} onclick={() => changeSpeed(option)}>{SPEED_LABELS[option]}</button>
				{/each}
			</span>
		</div>

		{#if timeline}
			<div class="timeline">
				<svg viewBox="0 0 300 40" preserveAspectRatio="none" class="sparks" aria-hidden="true">
					{#if zeroLine(timeline.series.treasury) !== null}
						<line x1="0" x2="300" y1={zeroLine(timeline.series.treasury)} y2={zeroLine(timeline.series.treasury)} class="zero" />
					{/if}
					{#each SERIES as series (series.key)}
						<polyline points={sparkline(timeline.series[series.key])} fill="none" stroke={series.color} stroke-width="1.5" vector-effect="non-scaling-stroke" />
					{/each}
					{#if view?.year}
						<line x1={((view.year - 0.5) / totalYears) * 300} x2={((view.year - 0.5) / totalYears) * 300} y1="0" y2="40" class="cursor" />
					{/if}
				</svg>
				<div class="legend">
					{#each SERIES as series (series.key)}<span><i style:background={series.color}></i>{series.label}</span>{/each}
					<span><i class="mark-insolvent"></i>Kasse ≤ 0 (erstmals)</span>
					<span class="muted">K KI-Zonen · F Farmen · S Kraftwerk · W Wohnzonen</span>
					{#if timeline.years.some(entry => entry.emergencyMarkers?.length)}
						<span class="muted">N Notstandsbeginn · P Pod-Entscheidung · Z Zuchtbeginn · E Notstandsende</span>
					{/if}
					{#if timeline.years.length < totalYears}
						<span class="muted">Weitere Jahre erscheinen während des Laufs · insgesamt {totalYears} Jahre</span>
					{/if}
				</div>
				<div class="years" style:grid-template-columns={`repeat(${timeline.years.length}, minmax(0, 1fr))`}>
					{#each timeline.years as entry (entry.year)}
						{@const sync = view?.syncHistory[entry.year]}
						<button
							class="year"
							class:current={view?.year === entry.year}
							class:unavailable={entry.year > timeline.availableYears}
							class:synced={sync?.synchronous === true}
							class:diverged={sync?.synchronous === false}
							class:insolvent={timeline.firstInsolventYear === entry.year}
							disabled={entry.year > timeline.availableYears || !controller}
							title={`Jahr ${entry.year} – zu Jahresbeginn springen`}
							onclick={() => jump(entry.year)}>
							<span class="number">{entry.year}</span>
							<span class="marks">
								{#each entry.emergencyMarkers ?? [] as marker (marker.kind)}
									<b class={`emergency-${marker.kind}`} title={marker.label} aria-label={marker.label}>
										{marker.kind === 'crisis' ? 'N' : marker.kind === 'decision' ? 'P' : marker.kind === 'breeding' ? 'Z' : 'E'}
									</b>
								{/each}
								{#if entry.builds.ai}<b class="m-ai" title="{entry.builds.ai} KI-Zonen">K</b>{/if}
								{#if entry.builds.farms}<b class="m-farm" title="{entry.builds.farms} Farmen">F</b>{/if}
								{#if entry.builds.plants}<b class="m-plant" title="{entry.builds.plants} Kraftwerke">S</b>{/if}
								{#if entry.builds.residential}<b class="m-res" title="{entry.builds.residential} Wohnzonen">W</b>{/if}
							</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</footer>
</div>

<style>
	.replay {
		--bg: #0b1120; --card: #111827; --text: #e5e7eb; --muted: #94a3b8; --line: #30425e;
		--accent: #67e8f9; --ok: #4ade80; --ok-bg: #14532d; --bad: #fca5a5; --bad-bg: #7f1d1d;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 370px;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 0.6rem;
		height: 100%;
		min-height: 0;
		padding: 0.6rem;
		box-sizing: border-box;
		background: var(--bg);
		color: var(--text);
		font-family: system-ui, sans-serif;
		font-size: 0.9rem;
	}
	.topbar { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
	.topbar label { display: flex; gap: 0.4rem; align-items: center; flex: 1 1 420px; }
	.topbar select { flex: 1; min-width: 0; padding: 0.3rem; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 4px; }
	.mode-switch, .live-start, .confirm-start { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; }
	.live-start { flex: 1 1 600px; }
	.live-start > label { flex: 0 1 auto; }
	.live-start input[type='number'] { width: 5.5rem; padding: 0.3rem; }
	.live-start .fake-option { flex: 0 0 auto; font-size: 0.82rem; }
	.confirm-start { padding: 0.4rem 0.6rem; border: 1px solid var(--bad); border-radius: 5px; background: var(--bad-bg); }
	.confirm-start > span { max-width: 24rem; }
	.live-indicator { color: var(--ok); font-weight: 700; }
	button.danger { color: var(--bad); border-color: var(--bad); }
	button {
		padding: 0.35rem 0.8rem; border: 1px solid var(--line); border-radius: 4px; background: var(--card);
		color: var(--text); cursor: pointer; font: inherit;
	}
	button:disabled { opacity: 0.45; cursor: default; }
	button.primary { background: var(--accent); border-color: var(--accent); color: #08111f; }
	button.selected { outline: 2px solid var(--accent); }
	.warn { color: var(--bad); }
	.muted { color: var(--muted); font-weight: normal; }
	.thinking { display: flex; align-items: center; gap: 0.35rem; margin: 0.3rem 0; padding: 0.4rem 0.55rem; color: var(--accent); background: var(--ok-bg); border-radius: 4px; font-weight: 600; font-variant-numeric: tabular-nums; }
	.thinking-dots { letter-spacing: 0.1rem; animation: pulse 1s infinite alternate; }
	@keyframes pulse { to { opacity: 0.25; } }

	.map { grid-column: 1; grid-row: 2; position: relative; overflow: hidden; border-radius: 6px; min-height: 300px; }
	.overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; }
	.map-tools {
		position: absolute; top: 0.5rem; left: 0.5rem; z-index: 3; display: flex; gap: 0.8rem; padding: 0.35rem 0.6rem;
		background: rgba(15, 23, 42, 0.78); color: #f1f5f9; border-radius: 6px; font-size: 0.85rem;
	}
	.map-tools label { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; }
	.swatch { width: 0.8rem; height: 0.8rem; display: inline-block; border-radius: 2px; }
	.swatch.unpowered { background: rgba(239, 68, 68, 0.8); }
	.swatch.hungry { background: rgba(217, 70, 239, 0.8); }
	.busy {
		position: absolute; inset: auto 0 45% 0; margin: auto; width: fit-content; z-index: 4; padding: 0.7rem 1.2rem;
		background: rgba(15, 23, 42, 0.85); color: #f8fafc; border-radius: 6px; font-size: 1rem;
	}

	.side { grid-column: 2; grid-row: 2 / span 2; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
	.card { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 0.55rem 0.7rem; }
	.card h2 { margin: 0 0 0.3rem; font-size: 1.3rem; }
	.card h3 { margin: 0 0 0.35rem; font-size: 0.95rem; }
	.rescue-forecast { margin-top: 0.8rem; padding-top: 0.65rem; border-top: 1px solid var(--line); }
	.rescue-forecast h4 { margin: 0 0 0.35rem; color: var(--accent); }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.7rem; margin: 0; }
	dt { color: var(--muted); }
	dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
	.meta dd { text-align: left; overflow-wrap: anywhere; }
	.phases { display: flex; gap: 0.3rem; list-style: none; padding: 0; margin: 0.5rem 0 0.3rem; }
	.phases li { flex: 1; text-align: center; padding: 0.25rem; border-radius: 4px; border: 1px solid var(--line); color: var(--muted); }
	.phases li.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
	.status { margin: 0.2rem 0; }
	.status.error { color: var(--bad); }
	.progress { position: relative; height: 1.1rem; background: var(--line); border-radius: 4px; overflow: hidden; }
	.progress div { height: 100%; background: var(--accent); opacity: 0.6; }
	.progress span { position: absolute; inset: 0; text-align: center; font-size: 0.75rem; line-height: 1.1rem; }
	.reason { white-space: pre-wrap; margin: 0; max-height: 11rem; overflow-y: auto; }
	.emergency-section { white-space: pre-wrap; margin: 0; overflow-wrap: anywhere; font-size: 0.85rem; }
	.commands { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.commands li { display: flex; flex-direction: column; border-left: 3px solid var(--ok); padding-left: 0.4rem; }
	.commands li.failed { border-left-color: var(--bad); }
	.commands span { color: var(--muted); font-size: 0.82rem; }
	.badge { display: inline-block; padding: 0.05rem 0.45rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
	.badge.ok { background: var(--ok-bg); color: var(--ok); }
	.badge.bad { background: var(--bad-bg); color: var(--bad); }
	.sync-list { list-style: none; padding: 0; margin: 0.4rem 0 0; display: flex; flex-direction: column; gap: 0.2rem; max-height: 12rem; overflow-y: auto; }
	.sync-list li { display: flex; gap: 0.5rem; align-items: flex-start; justify-content: space-between; }
	.sync-list table { border-collapse: collapse; font-size: 0.8rem; }
	.sync-list th, .sync-list td { padding: 0 0.3rem; text-align: right; }

	.bottom { grid-column: 1; grid-row: 3; display: flex; flex-direction: column; gap: 0.4rem; }
	.controls { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
	.speed { display: inline-flex; gap: 0.25rem; margin-left: auto; }
	.timeline { display: flex; flex-direction: column; gap: 0.2rem; }
	.sparks { width: 100%; height: 44px; background: var(--card); border: 1px solid var(--line); border-radius: 4px; }
	.sparks .cursor { stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
	.sparks .zero { stroke: var(--bad); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
	.legend { display: flex; flex-wrap: wrap; gap: 0.8rem; font-size: 0.78rem; }
	.legend i { display: inline-block; width: 0.8rem; height: 0.25rem; margin-right: 0.25rem; vertical-align: middle; }
	.legend i.mark-insolvent { height: 0.6rem; background: var(--bad); }
	.years { display: grid; gap: 2px; }
	.year { padding: 0.15rem 0; display: flex; flex-direction: column; align-items: center; min-width: 0; font-size: 0.75rem; position: relative; }
	.year.current { outline: 2px solid var(--accent); z-index: 1; }
	.year.synced { background: var(--ok-bg); }
	.year.diverged { background: var(--bad-bg); }
	.year.insolvent { border-bottom: 4px solid var(--bad); }
	.year.unavailable { opacity: 0.35; }
	.marks { display: flex; gap: 1px; min-height: 0.9rem; font-size: 0.62rem; }
	.marks b { padding: 0 1px; border-radius: 2px; color: #0f172a; }
	.m-ai { background: #38bdf8; }
	.emergency-crisis { background: #fbbf24; }
	.emergency-decision { background: #23c9ac; }
	.emergency-breeding { background: #b8a0ff; }
	.emergency-end { background: #38bdf8; }
	.m-farm { background: #84cc16; }
	.m-plant { background: #f59e0b; }
	.m-res { background: #e2e8f0; }

	@media (max-width: 1000px) {
		.replay { grid-template-columns: 1fr; grid-template-rows: auto 60vh auto auto; height: auto; }
		.side { grid-column: 1; grid-row: 4; }
		.bottom { grid-row: 3; }
	}
</style>
