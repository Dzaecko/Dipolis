/** Live events of a running city model; emitted by the runner, relayed by the dev server, played by /replay. */
import { PROTOCOL_YEARS, validateRunYears, type ProtocolCallResult, type ProtocolToolCall, type Report, type StartMap } from './protocol';
import type { ReplayStep } from './replay-controller';

export type LiveStatus = 'completed' | 'failed' | 'stopped';

export type LiveEvent = { time: number } & (
	| { type: 'run-started'; adapter: string; model: string; assignment: 'N' | 'R'; handbook: 'on' | 'off'; run: number; totalYears?: number; startMap: StartMap; seed: number; profile?: import('../params/profiles').SimulationProfile; scenario?: import('./protocol').ScenarioName; autoBuildRules?: 0 | 1; disasters?: boolean; engineId?: string; file: string; resumedYears: number }
	| { type: 'year-started'; year: number; report: Report; replayed?: boolean }
	| { type: 'model-request'; year: number; request: number }
	| { type: 'model-response'; year: number; reason: string; toolCalls: number }
	| { type: 'command'; year: number; call: ProtocolToolCall; result: ProtocolCallResult; replayed?: boolean }
	| { type: 'year-completed'; year: number; afterReport: Report; reason: string; replayed?: boolean }
	| { type: 'adapter-error'; year: number; kind: string; status?: number; attempts?: number }
	| { type: 'run-finished'; status: LiveStatus; metrics?: Record<string, number | null>; exactS266Match?: boolean; message?: string }
);

type Without<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type LiveEventInput = Without<LiveEvent, 'time'>;

/** Historical producers omitted the duration and always ran for 30 years. */
export function liveRunYears(event: Extract<LiveEvent, { type: 'run-started' }>): number {
	return validateRunYears(event.totalYears === undefined ? PROTOCOL_YEARS : event.totalYears);
}

/** Turns live events into replay steps; command indices count per year. */
export class LiveStepBuilder {
	private commandIndex = new Map<number, number>();

	push(event: LiveEvent): ReplayStep[] {
		switch (event.type) {
			case 'year-started':
				return [{ type: 'year-start', year: event.year, report: event.report, reason: '' }];
			case 'model-request':
				return [{ type: 'think', year: event.year }];
			case 'model-response':
				return event.reason ? [{ type: 'reason', year: event.year, reason: event.reason }] : [];
			case 'command': {
				const index = this.commandIndex.get(event.year) ?? 0;
				this.commandIndex.set(event.year, index + 1);
				return [{ type: 'command', year: event.year, index, call: event.call, result: event.result }];
			}
			case 'year-completed':
				return [{ type: 'year-end', year: event.year, afterReport: event.afterReport, reason: event.reason }];
			default:
				return [];
		}
	}
}

/** What the model is doing right now, derived from the event stream. */
export interface LiveProgress {
	started: Extract<LiveEvent, { type: 'run-started' }> | null;
	finished: Extract<LiveEvent, { type: 'run-finished' }> | null;
	/** Start time of the pending model request, or null. */
	thinkingSince: number | null;
	thinkingYear: number | null;
	lastError: Extract<LiveEvent, { type: 'adapter-error' }> | null;
	latestYear: number;
}

export function emptyProgress(): LiveProgress {
	return { started: null, finished: null, thinkingSince: null, thinkingYear: null, lastError: null, latestYear: 0 };
}

export function updateProgress(progress: LiveProgress, event: LiveEvent): LiveProgress {
	const next = { ...progress };
	switch (event.type) {
		case 'run-started': return { ...emptyProgress(), started: event };
		case 'year-started': next.latestYear = Math.max(next.latestYear, event.year); break;
		case 'model-request': next.thinkingSince = event.time; next.thinkingYear = event.year; break;
		case 'model-response': next.thinkingSince = null; next.thinkingYear = null; next.lastError = null; break;
		case 'adapter-error': next.lastError = event; break;
		case 'run-finished': next.finished = event; next.thinkingSince = null; next.thinkingYear = null; break;
	}
	return next;
}

/** Year to join a running run at: the newest year that has started. */
export function joinYear(events: LiveEvent[]): number {
	return events.reduce((year, event) => event.type === 'year-started' ? Math.max(year, event.year) : year, 0);
}
