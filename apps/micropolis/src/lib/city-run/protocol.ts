/** Browser-safe reading of city-model JSONL protocols; shared by runner, reports and /replay. */

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
	assignment?: 'N' | 'R';
	model?: string;
	handbook: 'on' | 'off';
	run?: number;
}
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
	const first = events.find((e) => e.assignment !== undefined || e.model !== undefined) ?? {};
	const meta: ProtocolMeta = {
		assignment: first.assignment as ProtocolMeta['assignment'],
		model: (events.find((e) => typeof e.model === 'string')?.model as string | undefined),
		handbook: (first.handbook as 'on' | 'off' | undefined) ?? 'off',
		run: first.run as number | undefined
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
