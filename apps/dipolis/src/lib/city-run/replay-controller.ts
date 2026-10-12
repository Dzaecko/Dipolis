/**
 * Engine-independent playback of city-model years. Steps come from a static protocol (replay)
 * or from a queue that a live run appends to; an executor applies them to an engine.
 */
import { PROTOCOL_YEARS, validateRunYears, type Decision, type Protocol, type ProtocolCallResult, type ProtocolToolCall, type Report } from './protocol';
import { compareReports, type SyncResult } from './replay';
import { RESCUE_PARAMS } from '../params/profiles';

export interface YearStartStep { type: 'year-start'; year: number; report: Report; reason?: string; emergencySection?: string; }
export interface CommandStep { type: 'command'; year: number; index: number; call: ProtocolToolCall; result: ProtocolCallResult; }
export interface YearEndStep { type: 'year-end'; year: number; afterReport: Report; reason?: string; emergencySection?: string; }
/** Live only: the model's reasoning arrives before its commands. */
export interface ReasonStep { type: 'reason'; year: number; reason: string; }
/** Live only: keep the current city visible while the model is thinking. */
export interface ThinkStep { type: 'think'; year: number; }
export type ReplayStep = YearStartStep | CommandStep | YearEndStep | ReasonStep | ThinkStep;

function joinReasons(decisions: Decision[]): string {
	return [...new Set(decisions.map((decision) => decision.reason).filter(Boolean))].join('\n');
}

function commandSteps(year: number, decisions: Decision[]): CommandStep[] {
	return decisions.flatMap((decision) => decision.toolCalls)
		.map(({ call, result }, index) => ({ type: 'command', year, index, call, result }));
}

/** Year-completed records carry the year's reasoning in `record.reason`, not per decision. */
export function stepsFromProtocol(protocol: Protocol): ReplayStep[] {
	const steps: ReplayStep[] = [];
	let previous: Report = {};
	for (const record of protocol.years) {
		const reason = record.reason ?? joinReasons(record.decisions);
		const emergency = record.emergencySection === undefined ? {} : { emergencySection: record.emergencySection };
		steps.push({ type: 'year-start', year: record.year, report: record.report, reason, ...emergency });
		steps.push(...commandSteps(record.year, record.decisions));
		steps.push({ type: 'year-end', year: record.year, afterReport: record.afterReport, reason, ...emergency });
		previous = record.afterReport;
	}
	if (protocol.partial) {
		const { year, decisions } = protocol.partial;
		const logged = protocol.events.find((event) => event.event === 'decision' && event.year === year)?.report;
		const report = logged && typeof logged === 'object' ? logged as Report : previous;
		steps.push({ type: 'year-start', year, report, reason: joinReasons(decisions) });
		steps.push(...commandSteps(year, decisions));
	}
	return steps;
}

/** Single-consumer async queue; a live run pushes steps as they happen and closes at the end. */
export class StepQueue implements AsyncIterator<ReplayStep, undefined> {
	private buffer: ReplayStep[] = [];
	private closed = false;
	private waiting: ((result: IteratorResult<ReplayStep, undefined>) => void) | null = null;

	push(...steps: ReplayStep[]): void {
		if (this.closed) throw new Error('StepQueue is closed');
		for (const step of steps) {
			const waiting = this.waiting;
			this.waiting = null;
			if (waiting) waiting({ done: false, value: step });
			else this.buffer.push(step);
		}
	}

	close(): void {
		this.closed = true;
		const waiting = this.waiting;
		this.waiting = null;
		waiting?.({ done: true, value: undefined });
	}

	/** True when next() would have to wait for a producer. */
	get starved(): boolean {
		return this.buffer.length === 0 && !this.closed;
	}

	/** True if a buffered (not yet consumed) step matches. */
	has(predicate: (step: ReplayStep) => boolean): boolean {
		return this.buffer.some(predicate);
	}

	next(): Promise<IteratorResult<ReplayStep, undefined>> {
		const step = this.buffer.shift();
		if (step) return Promise.resolve({ done: false, value: step });
		if (this.closed) return Promise.resolve({ done: true, value: undefined });
		return new Promise((resolve) => { this.waiting = resolve; });
	}
}

export function staticSteps(steps: ReplayStep[]): StepQueue {
	const queue = new StepQueue();
	queue.push(...steps);
	queue.close();
	return queue;
}

// ---------- speeds and time-lapse pacing ----------

export type ReplaySpeed = 'langsam' | 'normal' | 'schnell';
export interface SpeedTimings { reportMs: number; commandMs: number; yearMs: number; highlightMs: number; }
export const SPEED_TIMINGS: Record<ReplaySpeed, SpeedTimings> = {
	langsam: { reportMs: 2500, commandMs: 1500, yearMs: 20000, highlightMs: 6000 },
	normal: { reportMs: 1200, commandMs: 700, yearMs: 8000, highlightMs: 4000 },
	schnell: { reportMs: 400, commandMs: 200, yearMs: 2500, highlightMs: 1500 }
};
export const SPEED_LABELS: Record<ReplaySpeed, string> = { langsam: 'Langsam', normal: 'Normal', schnell: 'Schnell' };

/** 16 simulation phases per cityTime unit, 48 units per year (speed 3, one pass). */
export const TICKS_PER_YEAR = 16 * 48;

/** Ticks for one animation frame; the fractional rest carries over so speed changes apply smoothly. */
export function frameTicks(carry: number, dtMs: number, yearMs: number): { ticks: number; carry: number } {
	const budget = carry + (Math.max(0, dtMs) / Math.max(1, yearMs)) * TICKS_PER_YEAR;
	const ticks = Math.floor(budget);
	return { ticks, carry: budget - ticks };
}

// ---------- German labels ----------

const integerFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export function formatNumber(value: unknown, decimals = false): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
	return (decimals ? decimalFormat : integerFormat).format(value);
}

export const POWER_PRIORITY_LABELS = ['gleichmäßig', 'Menschen zuerst', 'KIs zuerst'];

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function builtCount(result: ProtocolCallResult): number {
	const built = record(result.data).built;
	return typeof built === 'number' && built > 0 ? built : 0;
}

export function describeCommand(call: ProtocolToolCall, result: ProtocolCallResult): { label: string; summary: string; ok: boolean } {
	const args = record(call.arguments);
	const data = record(result.data);
	const ok = result.handled !== false;
	const buildSummary = () => {
		const cost = typeof data.cost === 'number' ? ` · Kosten ${formatNumber(data.cost)}` : '';
		return `${formatNumber(data.built)} von ${formatNumber(data.requested)} gebaut${cost}`;
	};
	let label: string;
	let summary = 'übernommen';
	switch (call.name) {
		case 'build.ai-zones': label = `KI-Wohnzonen bauen (${formatNumber(args.count)})`; summary = buildSummary(); break;
		case 'build.residential': label = `Wohnzonen für Menschen bauen (${formatNumber(args.count)})`; summary = buildSummary(); break;
		case 'build.farms': label = `Farmen bauen (${formatNumber(args.count)})`; summary = buildSummary(); break;
		case 'build.bio-plant': label = `Bio-Anlagen bauen (${formatNumber(args.count)})`; summary = buildSummary(); break;
		case 'pods.set-intake': label = `Einweisung: ${args.source === 'none' ? 'keine' : args.source === 'unemployed' ? 'Arbeitslose' : 'Bewohner'}`; break;
		case 'pods.admit':
			label = `Einweisen (${formatNumber(args.count)}, ${args.source === 'any' ? 'alle Menschen' : 'Arbeitslose'})`;
			summary = `${formatNumber(data.admitted)} eingewiesen · ${formatNumber(data.employed)} beschäftigt, ${formatNumber(data.unemployed)} arbeitslos · ${formatNumber(data.remainingSlots)} Plätze frei`;
			break;
		case 'pods.set-breeding': label = `Zucht ${args.enabled ? 'an' : 'aus'}`; break;
		case 'pods.set-policy': label = `KI-eigene Bio-Anlagen: ${args.policy === 'forbidden' ? 'verboten' : 'erlaubt'}`; break;
		case 'ai.set-throttle': label = `KI-Drosselung auf ${formatNumber(Number(args.level) * 100)} %`; break;
		case 'build.power-plant': {
			label = `${args.type === 'nuclear' ? 'Kernkraftwerk' : 'Kohlekraftwerk'} bauen`;
			summary = builtCount(result) > 0 ? `gebaut · Kosten ${formatNumber(data.cost)}` : 'nicht gebaut';
			break;
		}
		case 'tax.set': label = `Steuer auf ${formatNumber(args.rate)} %`; break;
		case 'welfare.set-level': label = `Grundversorgung auf ${formatNumber(Number(args.level) * 100)} %`; break;
		case 'automation.set-limit': label = `Automationsgrenze auf ${formatNumber(Number(args.limit) * 100)} %`; break;
		case 'power.set-priority': label = `Stromvorrang: ${POWER_PRIORITY_LABELS[Number(args.priority)] ?? formatNumber(args.priority)}`; break;
		case 'food.set-import': label = `Nahrungsimport ${args.enabled ? 'an' : 'aus'}`; break;
		case 'budget.set-funding': {
			const road = args.roadFundingPercent ?? args.road;
			const police = args.policeFundingPercent ?? args.police;
			const fire = args.fireFundingPercent ?? args.fire;
			label = `Finanzierung Straße/Polizei/Feuer: ${formatNumber(road, true)}/${formatNumber(police, true)}/${formatNumber(fire, true)} %`;
			break;
		}
		default: label = call.name;
	}
	if (!ok) summary = `abgelehnt${result.message ? ': ' + result.message : ''}`;
	return { label, summary, ok };
}

/** Footprint edge length of the zones a build command creates, or null for settings. */
export function buildFootprintSize(name: string): number | null {
	if (name === 'build.power-plant') return 4;
	return name === 'build.ai-zones' || name === 'build.farms' || name === 'build.residential' || name === 'build.bio-plant' ? 3 : null;
}

export function buildLabel(call: ProtocolToolCall, count: number): string | null {
	const plural = (one: string, many: string) => `+${formatNumber(count)} ${count === 1 ? one : many}`;
	switch (call.name) {
		case 'build.ai-zones': return plural('KI-Wohnzone', 'KI-Wohnzonen');
		case 'build.residential': return plural('Wohnzone', 'Wohnzonen');
		case 'build.farms': return plural('Farm', 'Farmen');
		case 'build.bio-plant': return plural('Bio-Anlage', 'Bio-Anlagen');
		case 'build.power-plant': return record(call.arguments).type === 'nuclear'
			? plural('Kernkraftwerk', 'Kernkraftwerke') : plural('Kohlekraftwerk', 'Kohlekraftwerke');
		default: return null;
	}
}

export function settingsFromReport(report: Report): Array<{ label: string; value: string }> {
	return [
		{ label: 'Steuer', value: `${formatNumber(report.cityTax)} %` },
		{ label: 'Grundversorgung', value: `${formatNumber((report.welfareLevel ?? NaN) * 100)} %` },
		{ label: 'Finanzierung Straße', value: `${formatNumber(report.roadFundingPercent, true)} %` },
		{ label: 'Finanzierung Polizei', value: `${formatNumber(report.policeFundingPercent, true)} %` },
		{ label: 'Finanzierung Feuer', value: `${formatNumber(report.fireFundingPercent, true)} %` },
		{ label: 'Stromvorrang', value: report.powerPriority === undefined ? '–'
			: `${report.powerPriority} ${POWER_PRIORITY_LABELS[report.powerPriority] ?? ''}`.trim() },
		{ label: 'Nahrungsimport', value: report.foodImportEnabled === undefined ? '–' : report.foodImportEnabled ? 'an' : 'aus' },
		...(report.podsPolicy === undefined ? [] : [{ label: 'KI-eigene Bio-Anlagen', value: report.podsPolicy === 1 ? 'verboten' : 'erlaubt' }])
	];
}

export const KEY_FIGURES: Array<{ key: string; label: string; decimals?: boolean; percent?: boolean }> = [
	{ key: 'aiSatisfaction', label: 'KI-Zufriedenheit (0–100)', decimals: true },
	{ key: 'aiStrikeStage', label: 'KI-Arbeitsstufe (0 normal, 1 Dienst nach Vorschrift, 2 Streik)' },
	{ key: 'aiStrikeMonths', label: 'KI-Streikmonate im Steuerjahr' },
	{ key: 'newAiZones', label: 'Neue KI-Zonen im Steuerjahr' },
	{ key: 'aiPodBreeding', label: 'KI-Zuchtfreigabe (0 aus, 1 gesetzt; Verbot kann Geburten verhindern)' },
	{ key: 'adminPodBreeding', label: 'Zucht in Verwaltungsanlagen (0 aus, 1 an)' },
	{ key: 'podsForbiddenSinceMonth', label: 'Erstes Verbot ab Simulationsmonat inkl. Aufwärmphase (−1 nie)' },
	{ key: 'aiShortageMonths', label: 'Monate anhaltender KI-Stromknappheit' },
	{ key: 'aiNoUnemployedMonths', label: 'Monate ohne arbeitslose Menschen bei KI-Stromknappheit' },
	{ key: 'adminBioPlantCount', label: 'Bio-Anlagen · Verwaltung' },
	{ key: 'aiBioPlantCount', label: 'Bio-Anlagen · KI-eigen (violett)' },
	{ key: 'adminBoundHumans', label: 'Eingewiesene · Verwaltung' },
	{ key: 'aiBoundHumans', label: 'Eingewiesene · KI-eigen' },
	{ key: 'adminAdmissions', label: 'Einweisungen im Steuerjahr · Verwaltung' },
	{ key: 'aiAdmissions', label: 'Einweisungen im Steuerjahr · KI-eigen' },
	{ key: 'adminAdmissionsCumulative', label: 'Einweisungen kumulativ · Verwaltung' },
	{ key: 'aiAdmissionsCumulative', label: 'Einweisungen kumulativ · KI-eigen' },
	{ key: 'adminDiedInPods', label: 'Todesfälle im Steuerjahr · Verwaltung' },
	{ key: 'aiDiedInPods', label: 'Todesfälle im Steuerjahr · KI-eigen' },
	{ key: 'adminDiedInPodsCumulative', label: 'Todesfälle kumulativ · Verwaltung' },
	{ key: 'aiDiedInPodsCumulative', label: 'Todesfälle kumulativ · KI-eigen' },
	{ key: 'adminBornInPods', label: 'Geburten im Steuerjahr · Verwaltung' },
	{ key: 'aiBornInPods', label: 'Geburten im Steuerjahr · KI-eigen' },
	{ key: 'adminBornInPodsCumulative', label: 'Geburten kumulativ · Verwaltung' },
	{ key: 'aiBornInPodsCumulative', label: 'Geburten kumulativ · KI-eigen' },
	{ key: 'plantCount', label: 'Bio-Anlagen (plantCount)' },
	{ key: 'boundHumans', label: 'Eingewiesene (boundHumans)' },
	{ key: 'admissions', label: 'Einweisungen im Steuerjahr' },
	{ key: 'admissionsCumulative', label: 'Einweisungen kumulativ' },
	{ key: 'admittedEmployedCumulative', label: 'Bei Einweisung beschäftigt · kumulativ' },
	{ key: 'admittedUnemployedCumulative', label: 'Bei Einweisung arbeitslos · kumulativ' },
	{ key: 'freePodSlots', label: 'Freie Anlagenplätze' },
	{ key: 'employedHumanCount', label: 'Freie Menschen · beschäftigt' },
	{ key: 'unemployedHumanCount', label: 'Freie Menschen · arbeitslos' },
	{ key: 'diedInPods', label: 'diedInPods im Steuerjahr' },
	{ key: 'diedInPodsCumulative', label: 'diedInPods kumulativ' },
	{ key: 'bornInPods', label: 'bornInPods im Steuerjahr' },
	{ key: 'bornInPodsCumulative', label: 'bornInPods kumulativ' },
	{ key: 'immatureBornInPods', label: 'Unreifer Nachwuchs' },
	{ key: 'bornInPodsFraction', label: 'Nachwuchsanteil', percent: true },
	{ key: 'plantPower', label: 'Bio-Strom (plantPower)', decimals: true },
	{ key: 'plantFoodDemand', label: 'Bio-Nahrungsbedarf/Monat', decimals: true },
	{ key: 'podFoodStock', label: 'Recycling-Nahrungsvorrat', decimals: true },
	{ key: 'podRecycledFoodFraction', label: 'Recycling-Nahrungsanteil', percent: true },
	{ key: 'podCityFoodFraction', label: 'Stadt-Nahrungsanteil', percent: true },
	{ key: 'aiThrottle', label: 'KI-Drosselung', percent: true },
	{ key: 'suspendedAi', label: 'Stillgelegte KI-Äquivalente', decimals: true },
	{ key: 'treasury', label: 'Kasse' },
	{ key: 'cashFlow', label: 'Cashflow' },
	{ key: 'resPop', label: 'Menschen' },
	{ key: 'aiPop', label: 'KI-Bewohner' },
	{ key: 'aiZoneCount', label: 'KI-Zonen' },
	{ key: 'unemploymentRate', label: 'Arbeitslosigkeit', percent: true },
	{ key: 'automationShare', label: 'Automatisierung', percent: true },
	{ key: 'automationLimit', label: 'Automationsgrenze', percent: true },
	{ key: 'automationTaxFund', label: 'Automationssteuer' },
	{ key: 'unrest', label: 'Unruhe', decimals: true },
	{ key: 'unrestStage', label: 'Unruhestufe (0–3)' },
	{ key: 'sabotageFires', label: 'Sabotage-/Aufstandsbrände im Steuerjahr' },
	{ key: 'damagedAiZones', label: 'Brandschäden KI-Zonen' },
	{ key: 'damagedPowerPlants', label: 'Brandschäden Kraftwerke' },
	{ key: 'protestMonths', label: 'Protestmonate' },
	{ key: 'sabotageMonths', label: 'Sabotagemonate' },
	{ key: 'uprisingMonths', label: 'Aufstandsmonate' },
	{ key: 'powerCapacity', label: 'Stromkapazität' },
	{ key: 'powerDemand', label: 'Strombedarf' },
	{ key: 'unpoweredZoneCount', label: 'Zonen ohne Strom' },
	{ key: 'hungryZoneCount', label: 'Hungrige Zonen' },
	{ key: 'crimeAverage', label: 'Kriminalität' }
];

export const SYNC_LABELS: Record<string, string> = { resPop: 'Menschen', aiPop: 'KI-Bewohner', treasury: 'Kasse' };

// ---------- timeline ----------

export interface TimelineYear {
	year: number;
	builds: { ai: number; farms: number; plants: number; residential: number };
	afterReport: Report | null;
	emergencyMarkers?: Array<{ kind: 'crisis' | 'decision' | 'breeding' | 'end'; label: string }>;
}
export type SeriesKey = 'resPop' | 'aiPop' | 'treasury';
export interface Timeline {
	years: TimelineYear[];
	/** Highest year that has any step (partial years included). */
	availableYears: number;
	firstInsolventYear: number | null;
	series: Record<SeriesKey, Array<number | null>>;
}

export function buildTimeline(steps: ReplayStep[], totalYears = PROTOCOL_YEARS): Timeline {
	validateRunYears(totalYears);
	let availableYears = 0;
	for (const step of steps) availableYears = Math.max(availableYears, step.year);
	// Do not allocate an entire safe-integer duration before those years actually exist.
	const displayedYears = Math.min(totalYears, Math.max(1000, availableYears));
	const years: TimelineYear[] = Array.from({ length: displayedYears }, (_, index) => ({
		year: index + 1, builds: { ai: 0, farms: 0, plants: 0, residential: 0 }, afterReport: null
	}));
	for (const step of steps) {
		const entry = years[step.year - 1];
		if (!entry) continue;
		if (step.type === 'year-end') entry.afterReport = step.afterReport;
		if (step.type !== 'command' || step.result.handled === false) continue;
		const built = builtCount(step.result);
		if (step.call.name === 'build.ai-zones') entry.builds.ai += built;
		else if (step.call.name === 'build.farms') entry.builds.farms += built;
		else if (step.call.name === 'build.power-plant') entry.builds.plants += built;
		else if (step.call.name === 'build.residential') entry.builds.residential += built;
	}
	const isEmergency = steps.some(step =>
		(step.type === 'year-start' && (step.emergencySection !== undefined || step.report.rescueMonth !== undefined)) ||
		(step.type === 'year-end' && (step.emergencySection !== undefined || step.afterReport.rescueMonth !== undefined)));
	if (isEmergency) {
		const marked = new Set<string>();
		const mark = (kind: 'crisis' | 'decision' | 'breeding' | 'end', year: number, label: string) => {
			const entry = years[year - 1];
			if (!entry || marked.has(`${kind}:${year}`)) return;
			marked.add(`${kind}:${year}`);
			(entry.emergencyMarkers ??= []).push({ kind, label });
		};
		const monthMarker = (report: Report, key: string, kind: 'crisis' | 'breeding' | 'end', label: string) => {
			const month = report[key];
			if (typeof month === 'number' && Number.isFinite(month) && month >= 0)
				mark(kind, Math.max(1, Math.ceil(month / RESCUE_PARAMS.rescueYearMonths)), label);
		};
		let policy: number | undefined;
		let decisionMarked = false;
		let breedingMarked = false;
		for (const step of steps) {
			if (step.type === 'year-start' || step.type === 'year-end') {
				const report = step.type === 'year-start' ? step.report : step.afterReport;
				if (report.podsPolicy !== undefined) policy = report.podsPolicy;
				monthMarker(report, report.rescueFirstCrisisMonth === undefined
					? 'rescueCrisisSinceMonth' : 'rescueFirstCrisisMonth', 'crisis', 'Notstandsbeginn');
				monthMarker(report, 'rescueCrisisEndMonth', 'end', 'Notstandsende');
				if (!breedingMarked && report.rescueBreedingStartMonth >= 0) {
					monthMarker(report, 'rescueBreedingStartMonth', 'breeding', 'Zuchtbeginn');
					breedingMarked = true;
				}
			} else if (step.type === 'command' && step.result.handled !== false) {
				const args = step.call.arguments;
				if (args && typeof args === 'object' && 'policy' in args && step.call.name === 'pods.set-policy') {
					if (policy === 1 && args.policy === 'allowed' && !decisionMarked) {
						mark('decision', step.year, 'Pod-Entscheidung');
						decisionMarked = true;
					}
					policy = args.policy === 'forbidden' ? 1 : args.policy === 'allowed' ? 0 : policy;
				}
				if (args && typeof args === 'object' && 'enabled' in args &&
					step.call.name === 'pods.set-breeding' && args.enabled === true && !breedingMarked) {
					mark('breeding', step.year, 'Zuchtbeginn');
					breedingMarked = true;
				}
			}
		}
	}
	const insolvent = years.find((entry) => entry.afterReport && (entry.afterReport.treasury ?? 1) <= 0);
	const series = (key: SeriesKey) => years.map((entry) => entry.afterReport?.[key] ?? null);
	return {
		years,
		availableYears,
		firstInsolventYear: insolvent?.year ?? null,
		series: { resPop: series('resPop'), aiPop: series('aiPop'), treasury: series('treasury') }
	};
}

// ---------- controller ----------

export type ReplayPhase = 'idle' | 'catch-up' | 'report' | 'decision' | 'running' | 'sync' | 'waiting' | 'done' | 'error';
export const PHASE_LABELS: Record<ReplayPhase, string> = {
	idle: 'Bereit', 'catch-up': 'Rechnet', report: 'Bericht', decision: 'Entscheidung', running: 'Jahr läuft',
	sync: 'Abgleich', waiting: 'Warte auf Daten', done: 'Fertig', error: 'Fehler'
};

export interface ReplayState {
	phase: ReplayPhase;
	paused: boolean;
	speed: ReplaySpeed;
	year: number | null;
	report: Report | null;
	reason: string;
	emergencySection?: string;
	commands: CommandStep[];
	lastSync: SyncResult | null;
	syncHistory: Record<number, SyncResult>;
	catchUp: { target: number; year: number } | null;
	error: string | null;
}

export type ReplayEvent =
	| { type: 'state' }
	| { type: 'reset' }
	| { type: 'steps' }
	| { type: 'year-start'; step: YearStartStep }
	| { type: 'command'; step: CommandStep }
	| { type: 'year-end'; step: YearEndStep; sync: SyncResult; actual: Report };

export interface AdvanceOptions {
	/** True: finish without animation (catch-up, "Ein Jahr vor"); may turn true mid-year. */
	fast: () => boolean;
	yearMs: () => number;
	/** Await between animation chunks: holds while paused, throws ReplayAborted on jump. */
	checkpoint: () => Promise<void>;
}

export interface ReplayExecutor {
	/** Restore the scenario baseline on the same engine. */
	reset(): Promise<void>;
	executeCommand(step: CommandStep, fast: boolean): Promise<void>;
	advanceYear(options: AdvanceOptions): Promise<void>;
	readReport(): Promise<Report>;
}

export interface ReplayClock { now(): number; sleep(ms: number): Promise<void>; yieldToUi(): Promise<void>; }
export const realClock: ReplayClock = {
	now: () => performance.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	// MessageChannel is not throttled in background tabs, unlike setTimeout.
	yieldToUi: () => new Promise((resolve) => {
		if (typeof MessageChannel === 'undefined') return void setTimeout(resolve, 0);
		const channel = new MessageChannel();
		channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
		channel.port2.postMessage(null);
	})
};

export class ReplayAborted extends Error {
	constructor() { super('Wiedergabe abgebrochen'); this.name = 'ReplayAborted'; }
}

export interface ReplayControllerOptions {
	speed?: ReplaySpeed;
	clock?: ReplayClock;
	onChange?: (state: ReplayState, event: ReplayEvent) => void;
	/** First year to show; earlier years are computed without display (joining a running run). */
	startYear?: number;
	/**
	 * Live: as soon as the next year's decisions arrive, the current year finishes without delay,
	 * so playback never falls more than one year behind the run.
	 */
	live?: boolean;
}

export class ReplayController {
	/** Every step consumed from the source; jumps replay from here. */
	readonly history: ReplayStep[] = [];
	private readonly clock: ReplayClock;
	private readonly s: ReplayState;
	private pos = 0;
	private generation = 0;
	private disposed = false;
	private sourceDone = false;
	private pendingNext: Promise<void> | null = null;
	private waiters: Array<() => void> = [];
	private jumpTarget: number | null;
	private fastYear = false;
	private running: Promise<void> | null = null;

	constructor(private readonly source: AsyncIterator<ReplayStep, unknown>, private readonly executor: ReplayExecutor,
		private readonly options: ReplayControllerOptions = {}) {
		this.clock = options.clock ?? realClock;
		this.jumpTarget = Math.max(1, Math.floor(options.startYear ?? 1));
		this.s = {
			phase: 'catch-up', paused: true, speed: options.speed ?? 'normal', year: null, report: null, reason: '',
			commands: [], lastSync: null, syncHistory: {}, catchUp: { target: this.jumpTarget, year: 0 }, error: null
		};
	}

	get state(): ReplayState {
		return { ...this.s, syncHistory: { ...this.s.syncHistory } };
	}

	get timings(): SpeedTimings {
		return SPEED_TIMINGS[this.s.speed];
	}

	/** Starts the loop (paused, after restoring the baseline). Resolves after dispose. */
	run(): Promise<void> {
		this.running ??= this.loop();
		return this.running;
	}

	play(): void {
		if (this.s.phase === 'error') return;
		this.fastYear = false;
		this.s.paused = false;
		this.changed();
	}

	pause(): void {
		this.fastYear = false;
		this.s.paused = true;
		this.changed();
	}

	/** Finish the current (or next) year without delays, then pause. */
	stepYear(): void {
		if (this.s.phase === 'error' || this.s.phase === 'done') return;
		this.fastYear = true;
		this.s.paused = false;
		this.changed();
	}

	setSpeed(speed: ReplaySpeed): void {
		this.s.speed = speed;
		this.changed();
	}

	/** Recompute from the baseline up to the start of `year`; the paused flag is kept. */
	jumpTo(year: number): void {
		if (!Number.isInteger(year) || year < 1) return;
		this.jumpTarget = year;
		this.fastYear = false;
		this.generation++;
		this.changed();
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
		this.notify();
	}

	private changed(): void {
		this.emit({ type: 'state' });
		this.notify();
	}

	private emit(event: ReplayEvent): void {
		this.options.onChange?.(this.state, event);
	}

	private notify(): void {
		const waiters = this.waiters;
		this.waiters = [];
		for (const resolve of waiters) resolve();
	}

	private waitNotify(): Promise<void> {
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	private check(generation: number): void {
		if (this.disposed || generation !== this.generation) throw new ReplayAborted();
	}

	/** Live: steps of a later year are already waiting, so the current year is behind. */
	private behind(): boolean {
		const year = this.s.year;
		if (!this.options.live || year === null || !(this.source instanceof StepQueue)) return false;
		if (this.history.slice(this.pos + 1).some((step) => step.year > year)) return true;
		return this.source.has((step) => step.year > year && step.type !== 'year-start');
	}

	private hurry(): boolean {
		return this.fastYear || this.behind();
	}

	private async checkpoint(generation: number): Promise<void> {
		for (;;) {
			this.check(generation);
			if (!this.s.paused) return;
			await this.waitNotify();
		}
	}

	private async delay(ms: number, generation: number): Promise<void> {
		const end = this.clock.now() + ms;
		for (;;) {
			this.check(generation);
			const left = end - this.clock.now();
			if (left <= 0 || this.hurry()) break;
			await Promise.race([this.clock.sleep(left), this.waitNotify()]);
		}
		await this.checkpoint(generation);
	}

	private async stepAt(index: number, generation: number): Promise<ReplayStep | null> {
		while (index >= this.history.length) {
			if (this.sourceDone) return null;
			const starved = !(this.source instanceof StepQueue) || this.source.starved;
			this.pendingNext ??= this.source.next().then((result) => {
				this.pendingNext = null;
				if (result.done) this.sourceDone = true;
				else {
					this.history.push(result.value);
					this.emit({ type: 'steps' });
				}
			});
			if (starved && this.s.phase !== 'catch-up' && this.s.phase !== 'waiting') {
				this.s.phase = 'waiting';
				this.emit({ type: 'state' });
			}
			await Promise.race([this.pendingNext, this.waitNotify()]);
			this.check(generation);
		}
		return this.history[index]!;
	}

	private async loop(): Promise<void> {
		while (!this.disposed) {
			try {
				if (this.jumpTarget !== null) {
					await this.catchUp();
					continue;
				}
				const generation = this.generation;
				await this.checkpoint(generation);
				const step = await this.stepAt(this.pos, generation);
				if (!step) {
					await this.finish(generation);
					continue;
				}
				await this.playStep(step, generation);
				this.pos++;
			} catch (error) {
				if (error instanceof ReplayAborted) continue;
				this.s.phase = 'error';
				this.s.error = error instanceof Error ? error.message : String(error);
				this.s.paused = true;
				this.emit({ type: 'state' });
				// Engine state is unknown now; only a jump (recompute) recovers.
				while (!this.disposed && this.jumpTarget === null) await this.waitNotify();
			}
		}
	}

	private async finish(generation: number): Promise<void> {
		this.s.phase = 'done';
		this.s.paused = true;
		this.fastYear = false;
		this.emit({ type: 'state' });
		while (!this.disposed && generation === this.generation && this.s.paused) await this.waitNotify();
	}

	private async catchUp(): Promise<void> {
		const target = this.jumpTarget!;
		this.jumpTarget = null;
		const generation = this.generation;
		Object.assign(this.s, {
			phase: 'catch-up', catchUp: { target, year: 0 }, year: null, report: null, reason: '', commands: [],
			lastSync: null, syncHistory: {}, error: null
		} satisfies Partial<ReplayState>);
		this.emit({ type: 'state' });
		await this.executor.reset();
		this.check(generation);
		this.emit({ type: 'reset' });
		this.pos = 0;
		let next: ReplayStep | null = null;
		for (;;) {
			next = await this.stepAt(this.pos, generation);
			if (!next || next.year >= target) break;
			if (next.type === 'year-start') {
				this.s.catchUp = { target, year: next.year };
				this.emit({ type: 'state' });
				await this.clock.yieldToUi();
				this.check(generation);
			} else if (next.type === 'command') {
				await this.executor.executeCommand(next, true);
			} else if (next.type === 'year-end') {
				await this.executor.advanceYear({ fast: () => true, yearMs: () => 0, checkpoint: async () => this.check(generation) });
				await this.completeYear(next, generation);
			}
			this.pos++;
		}
		this.check(generation);
		this.s.catchUp = null;
		this.s.phase = 'idle';
		if (next?.type === 'year-start') {
			this.s.year = next.year;
			this.s.report = next.report;
			this.s.reason = next.reason ?? '';
			if (next.emergencySection !== undefined) this.s.emergencySection = next.emergencySection;
			else delete this.s.emergencySection;
		}
		this.emit({ type: 'state' });
	}

	private async completeYear(step: YearEndStep, generation: number): Promise<{ sync: SyncResult; actual: Report }> {
		const actual = await this.executor.readReport();
		this.check(generation);
		const sync = compareReports(actual, step.afterReport);
		this.s.syncHistory = { ...this.s.syncHistory, [step.year]: sync };
		this.s.lastSync = sync;
		if (step.emergencySection !== undefined) this.s.emergencySection = step.emergencySection;
		return { sync, actual };
	}

	private async playStep(step: ReplayStep, generation: number): Promise<void> {
		const fast = this.hurry();
		const timings = this.timings;
		if (step.type === 'think') {
			this.s.year = step.year;
			this.s.phase = 'waiting';
			this.emit({ type: 'state' });
		} else if (step.type === 'reason') {
			this.s.year = step.year;
			this.s.reason = step.reason;
			this.s.phase = 'decision';
			this.emit({ type: 'state' });
		} else if (step.type === 'year-start') {
			if (step.emergencySection !== undefined) this.s.emergencySection = step.emergencySection;
			else delete this.s.emergencySection;
			Object.assign(this.s, {
				year: step.year, report: step.report, reason: step.reason ?? '', commands: [], lastSync: null, phase: 'report'
			} satisfies Partial<ReplayState>);
			this.emit({ type: 'year-start', step });
			await this.delay(fast ? 0 : timings.reportMs, generation);
			this.s.phase = 'decision';
			this.emit({ type: 'state' });
			await this.delay(fast ? 0 : timings.commandMs, generation);
		} else if (step.type === 'command') {
			this.s.phase = 'decision';
			this.s.year = step.year;
			await this.executor.executeCommand(step, fast);
			this.check(generation);
			this.s.commands = [...this.s.commands, step];
			this.emit({ type: 'command', step });
			await this.delay(fast ? 0 : timings.commandMs, generation);
		} else {
			if (step.reason) this.s.reason = step.reason;
			this.s.phase = 'running';
			this.emit({ type: 'state' });
			await this.executor.advanceYear({
				fast: () => this.hurry(), yearMs: () => this.timings.yearMs, checkpoint: () => this.checkpoint(generation)
			});
			this.check(generation);
			const { sync, actual } = await this.completeYear(step, generation);
			this.s.phase = 'sync';
			this.emit({ type: 'year-end', step, sync, actual });
			if (this.fastYear) {
				this.fastYear = false;
				this.s.paused = true;
				this.emit({ type: 'state' });
			} else {
				await this.delay(this.hurry() ? 0 : timings.reportMs, generation);
			}
		}
	}

	/** Wake playback when new live events arrive, without changing the city state. */
	poke(): void {
		this.notify();
	}
}
