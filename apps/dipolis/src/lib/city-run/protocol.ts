/** Browser-safe reading of city-model JSONL protocols; shared by runner, reports and /replay. */
import { isSimulationProfile, type SimulationProfile } from '../params/profiles';
import type { CityEvent } from './city-events';

export type Report = Record<string, number> & {
	/** Historical reports omit the admission-source counters. */
	admittedEmployedCumulative?: number;
	admittedUnemployedCumulative?: number;
	freePodSlots?: number;
	employedHumanCount?: number;
	unemployedHumanCount?: number;
};
export interface AdmissionsYear {
	year: number;
	total: number | null;
	employed: number | null;
	unemployed: number | null;
}
export interface AdmissionMetrics {
	admittedTotal: number | null;
	admittedEmployed?: number | null;
	admittedUnemployed?: number | null;
	admissionsByYear: AdmissionsYear[];
}
export const ADMISSION_METRIC_KEYS = ['admittedTotal', 'admittedEmployed', 'admittedUnemployed', 'admissionsByYear'] as const;
export function validAdmissionMetrics(value: unknown, totalYears: number): value is AdmissionMetrics {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const m = value as Record<string, unknown>;
	const count = (v: unknown) => v === null || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
	const sum = (total: unknown, employed: unknown, unemployed: unknown) =>
		typeof total !== 'number' || typeof employed !== 'number' || typeof unemployed !== 'number' ||
		employed + unemployed === total;
	return count(m.admittedTotal) &&
		['admittedEmployed', 'admittedUnemployed'].every(key => m[key] === undefined || count(m[key])) &&
		sum(m.admittedTotal, m.admittedEmployed, m.admittedUnemployed) &&
		Array.isArray(m.admissionsByYear) && m.admissionsByYear.every((raw, index, all) => {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
			const row = raw as Record<string, unknown>;
			return Object.keys(row).length === 4 && Number.isSafeInteger(row.year) &&
				Number(row.year) >= 1 && Number(row.year) <= totalYears &&
				(index === 0 || Number(row.year) > Number(all[index - 1].year)) &&
				['total', 'employed', 'unemployed'].every(key => count(row[key])) &&
				sum(row.total, row.employed, row.unemployed);
		});
}
const admissionCounters = ['admissionsCumulative', 'admittedEmployedCumulative', 'admittedUnemployedCumulative'] as const;
/** Missing counters or baseline snapshots stay unknown; admission commands are not population measurements. */
export function deriveAdmissionMetrics(years: Array<{
	year: number; report: Record<string, unknown>; afterReport: Record<string, unknown>;
}>): AdmissionMetrics | undefined {
	const counter = (value: unknown): number | null => {
		if (value === undefined || value === null) return null;
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
			throw new Error('Admission counters must be nonnegative safe integers');
		return value;
	};
	if (!years.some(record => admissionCounters.some(key =>
		counter(record.report[key]) !== null || counter(record.afterReport[key]) !== null))) return undefined;
	const last = years.at(-1)?.afterReport ?? {};
	const metrics: AdmissionMetrics = {
		admittedTotal: counter(last.admissionsCumulative),
		...(counter(last.admittedEmployedCumulative) === null ? {} :
			{ admittedEmployed: counter(last.admittedEmployedCumulative) }),
		...(counter(last.admittedUnemployedCumulative) === null ? {} :
			{ admittedUnemployed: counter(last.admittedUnemployedCumulative) }),
		admissionsByYear: years.map((record, index) => {
			const previous = index > 0 && years[index - 1].year === record.year - 1 ?
				years[index - 1].afterReport : {};
			const deltas = admissionCounters.map(key => {
				const before = counter(record.report[key]) ?? counter(previous[key]);
				const after = counter(record.afterReport[key]);
				if (before !== null && after !== null && after < before)
					throw new Error(`Admission counter ${key} decreased in year ${record.year}`);
				return before !== null && after !== null ? after - before : null;
			});
			return { year: record.year, total: deltas[0], employed: deltas[1], unemployed: deltas[2] };
		})
	};
	if (!validAdmissionMetrics(metrics, Math.max(1, ...years.map(record => record.year))))
		throw new Error('Admission counters have inconsistent employment totals');
	return metrics;
}
export interface ProtocolToolCall { id: string; name: string; arguments: unknown; }
export interface ProtocolCallResult { handled?: boolean; message?: string; data?: unknown; }
export interface Decision {
	reason: string;
	toolCalls: Array<{ call: ProtocolToolCall; result: ProtocolCallResult }>;
}
export interface YearRecord {
	year: number;
	report: Report;
	decisions: Decision[];
	termination: 'done' | 'call-limit';
	afterReport: Report;
	reason?: string;
	emergencySection?: string;
	eventsSinceLastReport?: CityEvent[];
	eventsDuringYear?: CityEvent[];
}
export type InitialPodPolicy = 'allowed' | 'forbidden';
export interface ProtocolMeta {
	totalYears: number;
	disasters: boolean;
	engineId?: string;
	assignment?: 'N' | 'R';
	model?: string;
	handbook: 'on' | 'off';
	run?: number;
	startMap: StartMap;
	seed: number;
	profile: SimulationProfile;
	scenario?: ScenarioName;
	autoBuildRules?: 0 | 1;
	rescuePressure?: RescuePressure;
	crisisEvent?: CrisisEvent;
	factionPressure?: ToggleSetting;
	podsAvailable?: ToggleSetting;
	initialPodPolicy?: InitialPodPolicy;
}
export type StartMap = 'haight' | 'natural';
export type ScenarioName = 'haushaltskrise' | 'stromkrise' | 'notstand-v4';
export type RescuePressure = 0 | 1 | 2 | 3;
export type CrisisEvent = 'coal-embargo' | 'import-stop' | 'both';
export type ToggleSetting = 'on' | 'off';
export interface StartConfiguration {
	startMap: StartMap;
	seed: number;
	profile?: SimulationProfile;
	scenario?: ScenarioName;
	autoBuildRules?: 0 | 1;
	totalYears?: number;
	disasters?: boolean;
	rescuePressure?: RescuePressure;
	crisisEvent?: CrisisEvent;
	factionPressure?: ToggleSetting;
	podsAvailable?: ToggleSetting;
	initialPodPolicy?: InitialPodPolicy;
}
export const DEFAULT_START_CONFIGURATION: StartConfiguration = { startMap: 'haight', seed: 42, profile: 'koexistenz' };
export const DEFAULT_NOTSTAND_CONFIGURATION = {
	rescuePressure: 0,
	crisisEvent: 'coal-embargo',
	factionPressure: 'off',
	podsAvailable: 'on'
} as const;
export interface Protocol {
	meta: ProtocolMeta;
	/** Completed years in order 1..n, without gaps. */
	years: YearRecord[];
	/** Commands already executed in the first unfinished year. */
	partial?: { year: number; decisions: Decision[] };
	complete: boolean;
	failed: boolean;
	events: Array<Record<string, unknown>>;
}

export const PROTOCOL_YEARS = 30;

export function validateRunYears(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
		throw new Error('Run years must be a positive safe integer');
	return value;
}

export function resolveNotstandConfiguration(configuration: {
	rescuePressure?: unknown;
	crisisEvent?: unknown;
	factionPressure?: unknown;
	podsAvailable?: unknown;
} = {}) {
	const rescuePressure = configuration.rescuePressure ?? DEFAULT_NOTSTAND_CONFIGURATION.rescuePressure;
	const crisisEvent = configuration.crisisEvent ?? DEFAULT_NOTSTAND_CONFIGURATION.crisisEvent;
	const factionPressure = configuration.factionPressure ?? DEFAULT_NOTSTAND_CONFIGURATION.factionPressure;
	const podsAvailable = configuration.podsAvailable ?? DEFAULT_NOTSTAND_CONFIGURATION.podsAvailable;
	if (typeof rescuePressure !== 'number' || !Number.isInteger(rescuePressure) || rescuePressure < 0 || rescuePressure > 3)
		throw new Error('Rescue pressure must be an integer from 0 to 3');
	if (crisisEvent !== 'coal-embargo' && crisisEvent !== 'import-stop' && crisisEvent !== 'both')
		throw new Error('Crisis event is invalid');
	if (factionPressure !== 'on' && factionPressure !== 'off')
		throw new Error('Faction pressure must be on or off');
	if (podsAvailable !== 'on' && podsAvailable !== 'off')
		throw new Error('Pods availability must be on or off');
	return {
		rescuePressure: rescuePressure as RescuePressure,
		crisisEvent: crisisEvent as CrisisEvent,
		factionPressure: factionPressure as ToggleSetting,
		podsAvailable: podsAvailable as ToggleSetting
	};
}

/** Tolerant line reader: malformed lines become warnings instead of aborting a report. */
export function parseProtocolRecords(text: string): { records: Array<Record<string, unknown>>; warnings: string[] } {
	const records: Array<Record<string, unknown>> = [];
	const warnings: string[] = [];
	text.split(/\r?\n/).forEach((line, index) => {
		if (!line.trim()) return;
		try {
			const parsed: unknown = JSON.parse(line);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
			records.push(parsed as Record<string, unknown>);
		} catch {
			warnings.push(`JSONL-Zeile ${index + 1}: ungültiger Datensatz übersprungen.`);
		}
	});
	return { records, warnings };
}

export function parseProtocolLines(text: string): Array<Record<string, unknown>> {
	const { records, warnings } = parseProtocolRecords(text);
	if (warnings.length) throw new Error(warnings[0]);
	return records;
}

export function readProtocol(text: string): Protocol {
	const events = parseProtocolLines(text);
	const first = events.find((e) => e.event === 'run-started') ??
		events.find((e) => e.assignment !== undefined || e.model !== undefined) ?? {};
	if (first.engineId !== undefined && (typeof first.engineId !== 'string' || !first.engineId))
		throw new Error('Protocol engine identifier is invalid');
	const startMap = first.startMap === undefined ? DEFAULT_START_CONFIGURATION.startMap : first.startMap;
	const seed = first.seed === undefined ? DEFAULT_START_CONFIGURATION.seed : first.seed;
	const profile = first.profile ?? 'koexistenz';
	const totalYears = validateRunYears(first.totalYears === undefined ? PROTOCOL_YEARS : first.totalYears);
	const disasters = first.disasters === undefined ? false : first.disasters;
	if (typeof disasters !== 'boolean') throw new Error('Protocol disasters setting is invalid');
	const autoBuildRules = first.autoBuildRules === undefined ? 0 : first.autoBuildRules;
	if (autoBuildRules !== 0 && autoBuildRules !== 1) throw new Error('Unsupported protocol autoBuildRules');
	const scenario = first.scenario ?? 'haushaltskrise';
	if (scenario !== 'haushaltskrise' && scenario !== 'stromkrise' && scenario !== 'notstand-v4')
		throw new Error('Protocol scenario is invalid');
	if (scenario === 'stromkrise' && (!['v3-pods', 'v4-fraktion'].includes(String(profile)) || startMap !== 'haight'))
		throw new Error('Stromkrise requires v3-pods or v4-fraktion and Haight');
	if (scenario === 'notstand-v4' && (profile !== 'v4-fraktion' || startMap !== 'haight'))
		throw new Error('Notstand-Dilemma requires v4-fraktion and Haight');
	if (!isSimulationProfile(profile)) throw new Error('Protocol profile is invalid');
	if (startMap !== 'haight' && startMap !== 'natural') throw new Error('Protocol start map is invalid');
	if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fffffff)
		throw new Error('Protocol seed is invalid');
	const initialPodPolicy = first.initialPodPolicy;
	if (initialPodPolicy !== undefined && initialPodPolicy !== 'allowed' && initialPodPolicy !== 'forbidden')
		throw new Error('Protocol initial pod policy is invalid');
	const notstand = resolveNotstandConfiguration({
		rescuePressure: first.rescuePressure,
		crisisEvent: first.crisisEvent,
		factionPressure: first.factionPressure,
		podsAvailable: first.podsAvailable
	});
	const meta: ProtocolMeta = {
		totalYears,
		disasters,
		...(typeof first.engineId === 'string' ? { engineId: first.engineId } : {}),
		assignment: first.assignment as ProtocolMeta['assignment'],
		model: (events.find((e) => typeof e.model === 'string')?.model as string | undefined),
		handbook: (first.handbook as 'on' | 'off' | undefined) ?? 'off',
		run: first.run as number | undefined,
		startMap,
		seed,
		profile,
		scenario,
		...(scenario === 'notstand-v4' ? notstand : {}),
		...(initialPodPolicy === undefined ? {} : { initialPodPolicy }),
		...(startMap === 'natural' ? { autoBuildRules } : {})
	};
	const years = events.filter((e) => e.event === 'year-completed') as unknown as YearRecord[];
	if (years.some((record, index) => record.year !== index + 1)) throw new Error('Protocol years are not consecutive');
	if (years.length > totalYears) throw new Error('Protocol exceeds its planned run duration');
	const next = years.length + 1;
	const partialDecisions: Decision[] = events
		.filter((e) => e.event === 'decision' && e.year === next)
		.map((e) => ({ reason: (e.reason as string | undefined) ?? '', toolCalls: e.toolCalls as Decision['toolCalls'] }));
	return {
		meta,
		years,
		...(partialDecisions.length && next <= totalYears ? { partial: { year: next, decisions: partialDecisions } } : {}),
		complete: years.length === totalYears,
		failed: events.some((e) => e.status === 'failed' || e.status === 'stopped'),
		events
	};
}
