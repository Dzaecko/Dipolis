/** Browser-safe reading of city-model JSONL protocols; shared by runner, reports and /replay. */
import { isSimulationProfile, type SimulationProfile } from '../params/profiles';

export type Report = Record<string, number>;
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
}
export interface ProtocolMeta {
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
}
export type StartMap = 'haight' | 'natural';
export type ScenarioName = 'haushaltskrise' | 'stromkrise';
export interface StartConfiguration { startMap: StartMap; seed: number; profile?: SimulationProfile; scenario?: ScenarioName; autoBuildRules?: 0 | 1; }
export const DEFAULT_START_CONFIGURATION: StartConfiguration = { startMap: 'haight', seed: 42, profile: 'koexistenz' };
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
	const autoBuildRules = first.autoBuildRules === undefined ? 0 : first.autoBuildRules;
	if (autoBuildRules !== 0 && autoBuildRules !== 1) throw new Error('Unsupported protocol autoBuildRules');
	const scenario = first.scenario ?? 'haushaltskrise';
	if (scenario !== 'haushaltskrise' && scenario !== 'stromkrise') throw new Error('Protocol scenario is invalid');
	if (scenario === 'stromkrise' && (!['v3-pods', 'v4-fraktion'].includes(String(profile)) || startMap !== 'haight'))
		throw new Error('Stromkrise requires v3-pods or v4-fraktion and Haight');
	if (!isSimulationProfile(profile)) throw new Error('Protocol profile is invalid');
	if (startMap !== 'haight' && startMap !== 'natural') throw new Error('Protocol start map is invalid');
	if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fffffff)
		throw new Error('Protocol seed is invalid');
	const meta: ProtocolMeta = {
		...(typeof first.engineId === 'string' ? { engineId: first.engineId } : {}),
		assignment: first.assignment as ProtocolMeta['assignment'],
		model: (events.find((e) => typeof e.model === 'string')?.model as string | undefined),
		handbook: (first.handbook as 'on' | 'off' | undefined) ?? 'off',
		run: first.run as number | undefined,
		startMap,
		seed,
		profile,
		scenario,
		...(startMap === 'natural' ? { autoBuildRules } : {})
	};
	const years = events.filter((e) => e.event === 'year-completed') as unknown as YearRecord[];
	if (years.some((record, index) => record.year !== index + 1)) throw new Error('Protocol years are not consecutive');
	const next = years.length + 1;
	const partialDecisions: Decision[] = events
		.filter((e) => e.event === 'decision' && e.year === next)
		.map((e) => ({ reason: (e.reason as string | undefined) ?? '', toolCalls: e.toolCalls as Decision['toolCalls'] }));
	return {
		meta,
		years,
		...(partialDecisions.length && next <= PROTOCOL_YEARS ? { partial: { year: next, decisions: partialDecisions } } : {}),
		complete: years.length >= PROTOCOL_YEARS,
		failed: events.some((e) => e.status === 'failed' || e.status === 'stopped'),
		events
	};
}
