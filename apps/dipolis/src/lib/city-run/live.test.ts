import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyProgress, joinYear, liveRunYears, LiveStepBuilder, updateProgress, type LiveEvent } from './live';
import { readProtocol } from './protocol';
import { LiveRunManager, parseStartRequest, readModelConfig } from '../../../vite-plugins/live-runs';
import { listCityRuns } from '../../../vite-plugins/city-runs';

const started = (year: number): Extract<LiveEvent, { type: 'year-started' }> => ({
	time: year, type: 'year-started', year, report: { treasury: 60_000 }
});

describe('live protocol events', () => {
	it('keeps historical live durations and validates explicit durations', () => {
		const event: Extract<LiveEvent, { type: 'run-started' }> = {
			time: 1, type: 'run-started', adapter: 'fake', model: 'S266', assignment: 'N',
			handbook: 'off', run: 1, startMap: 'haight', seed: 42, file: 'run.jsonl', resumedYears: 0
		};
		expect(liveRunYears(event)).toBe(30);
		expect(liveRunYears({ ...event, totalYears: 1 })).toBe(1);
		expect(liveRunYears({ ...event, totalYears: 50 })).toBe(50);
		expect(() => liveRunYears({ ...event, totalYears: 0 })).toThrow();
	});

	it('defaults new runs, inherits resume duration, and rejects invalid durations', () => {
		const request = { adapter: 'fake', assignment: 'N', handbook: 'off', run: 1 };
		expect(parseStartRequest(request).totalYears).toBe(30);
		expect(parseStartRequest({ ...request, resume: true }).totalYears).toBeUndefined();
		for (const totalYears of [1, 50, Number.MAX_SAFE_INTEGER])
			expect(parseStartRequest({ ...request, totalYears }).totalYears).toBe(totalYears);
		for (const totalYears of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, null, '50'])
			expect(() => parseStartRequest({ ...request, totalYears })).toThrow();
		expect(parseStartRequest({ ...request, resume: true, totalYears: 50 }).totalYears).toBe(50);
	});

	it('converts model events into ordered playback steps and progress', () => {
		const builder = new LiveStepBuilder();
		const first = started(1);
		const request: LiveEvent = { time: 2, type: 'model-request', year: 1, request: 1 };
		const response: LiveEvent = { time: 3, type: 'model-response', year: 1, reason: 'Investieren.', toolCalls: 1 };
		const command: LiveEvent = { time: 4, type: 'command', year: 1,
			call: { id: 'x', name: 'tax.set', arguments: { rate: 7 } }, result: { handled: true } };
		const end: LiveEvent = { time: 5, type: 'year-completed', year: 1, afterReport: { treasury: 10 }, reason: 'Investieren.' };
		expect(builder.push(first)).toEqual([{ type: 'year-start', year: 1, report: first.report, reason: '' }]);
		expect(builder.push(request)).toEqual([{ type: 'think', year: 1 }]);
		expect(builder.push(response)).toEqual([{ type: 'reason', year: 1, reason: 'Investieren.' }]);
		expect(builder.push(command)).toEqual([{ type: 'command', year: 1, index: 0, call: command.call, result: command.result }]);
		expect(builder.push(end)).toEqual([{ type: 'year-end', year: 1, afterReport: end.afterReport, reason: 'Investieren.' }]);
		let progress = emptyProgress();
		progress = updateProgress(progress, first);
		progress = updateProgress(progress, request);
		expect(progress.thinkingSince).toBe(2);
		progress = updateProgress(progress, response);
		expect(progress.thinkingSince).toBeNull();
		expect(joinYear([first, end, started(2)])).toBe(2);
	});

	it('validates live start parameters and reads model config without echoing secrets', () => {
		expect(parseStartRequest({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1, fakeDelayMs: 3000 }))
			.toEqual({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1, totalYears: 30, resume: false, fakeDelayMs: 3000 });
		expect(parseStartRequest({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1, startMap: 'natural', seed: 42 }))
			.toMatchObject({ startMap: 'natural', seed: 42 });
		expect(() => parseStartRequest({ adapter: 'openai', assignment: 'N', handbook: 'off', run: 0 })).toThrow('Ungültige Laufparameter');
		expect(() => parseStartRequest({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1, seed: -1 }))
			.toThrow('Startwert');
		const folder = mkdtempSync(path.join(process.cwd(), '.city-live-config-'));
		const file = path.join(folder, '.env.city-model');
		try {
			writeFileSync(file, 'CITY_MODEL_ENDPOINT=https://example.test/openai/v1\nCITY_MODEL_NAME=demo\nCITY_MODEL_KEY=not-to-display\nCITY_MODEL_START_MAP=natural\nCITY_MODEL_SEED=123\n');
			expect(readModelConfig(file)).toEqual({
				CITY_MODEL_ENDPOINT: 'https://example.test/openai/v1/chat/completions', CITY_MODEL_NAME: 'demo',
				CITY_MODEL_KEY: 'not-to-display', CITY_MODEL_START_MAP: 'natural', CITY_MODEL_SEED: '123'
			});
		} finally { rmSync(folder, { recursive: true, force: true }); }
	});
});

describe('live runner process (S266, no network)', () => {
	let manager: LiveRunManager | null = null;
	let output: string | null = null;
	afterEach(async () => {
		if (manager?.running) { manager.stop(); await manager.idle(); }
		if (output) rmSync(output, { recursive: true, force: true });
		manager = null;
		output = null;
	});

	it('streams a complete 30-year S266 run and writes a replayable protocol', async () => {
		output = mkdtempSync(path.join(process.cwd(), '.city-live-run-'));
		manager = new LiveRunManager({
			appDirectory: path.resolve(process.cwd()), outputDirectory: output,
			configFile: path.join(output, '.env.city-model')
		});
		const events: LiveEvent[] = [];
		manager.subscribe((_session, event) => events.push(event));
		manager.start({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1 });
		await manager.idle();
		expect(manager.running).toBe(false);
		expect(events.filter((event) => event.type === 'year-started')).toHaveLength(30);
		expect(events.filter((event) => event.type === 'year-completed')).toHaveLength(30);
		expect(events.find((event) => event.type === 'run-started')).toMatchObject({ totalYears: 30 });
		expect(manager.config()).toMatchObject({ totalYears: 30 });
		expect(events.some((event) => event.type === 'model-request')).toBe(true);
		expect(events.some((event) => event.type === 'command')).toBe(true);
		const finished = events.find((event) => event.type === 'run-finished');
		expect(finished?.type).toBe('run-finished');
		if (finished?.type === 'run-finished') {
			expect(finished.status).toBe('completed');
			expect(finished.exactS266Match).toBe(true);
		}
		const jsonl = path.join(output, readdirSync(output).find((name) => name.endsWith('.jsonl'))!);
		const protocol = readProtocol(readFileSync(jsonl, 'utf8'));
		expect(protocol.complete).toBe(true);
		expect(protocol.years).toHaveLength(30);
		expect(listCityRuns(output)).toMatchObject([{ years: 30, totalYears: 30, complete: true }]);
	}, 120_000);

	it('streams a one-year run, exposing duration in events and listing', async () => {
		output = mkdtempSync(path.join(process.cwd(), '.city-live-short-'));
		manager = new LiveRunManager({
			appDirectory: path.resolve(process.cwd()), outputDirectory: output,
			configFile: path.join(output, '.env.city-model')
		});
		const events: LiveEvent[] = [];
		manager.subscribe((_session, event) => events.push(event));
		manager.start({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1, totalYears: 1 });
		await manager.idle();
		expect(events.find((event) => event.type === 'run-started')).toMatchObject({ totalYears: 1 });
		expect(events.filter((event) => event.type === 'year-completed')).toHaveLength(1);
		expect(listCityRuns(output)).toMatchObject([{ years: 1, totalYears: 1, complete: true }]);
	}, 120_000);

	it('stops safely during a model request and resumes the same run', async () => {
		output = mkdtempSync(path.join(process.cwd(), '.city-live-resume-'));
		manager = new LiveRunManager({
			appDirectory: path.resolve(process.cwd()), outputDirectory: output,
			configFile: path.join(output, '.env.city-model')
		});
		const events: LiveEvent[] = [];
		let requestedStop = false;
		manager.subscribe((_session, event) => {
			events.push(event);
			if (!requestedStop && event.type === 'model-request') { requestedStop = true; manager!.stop(); }
		});
		manager.start({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1, totalYears: 2, fakeDelayMs: 10_000 });
		await manager.idle();
		expect(events.some((event) => event.type === 'run-finished' && event.status === 'stopped')).toBe(true);
		const jsonl = path.join(output, readdirSync(output).find((name) => name.endsWith('.jsonl'))!);
		expect(readProtocol(readFileSync(jsonl, 'utf8')).failed).toBe(true);

		manager.start({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1, resume: true });
		await manager.idle();
		const resumed = readProtocol(readFileSync(jsonl, 'utf8'));
		expect(resumed.complete).toBe(true);
		expect(resumed.years).toHaveLength(2);
		expect(resumed.meta.totalYears).toBe(2);
		expect(events.filter((event) => event.type === 'run-started')).toHaveLength(2);
		expect(events.filter((event) => event.type === 'run-started').every((event) => liveRunYears(event) === 2)).toBe(true);
		expect(events.some((event) => event.type === 'run-finished' && event.status === 'completed')).toBe(true);
	}, 120_000);
});
