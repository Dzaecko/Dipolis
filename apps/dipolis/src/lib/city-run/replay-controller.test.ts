import { describe, expect, it } from 'vitest';
import { readProtocol, type Report } from './protocol';
import {
	KEY_FIGURES, settingsFromReport, ReplayController, StepQueue, TICKS_PER_YEAR, buildLabel, buildFootprintSize, buildTimeline, describeCommand, frameTicks,
	staticSteps, stepsFromProtocol, type AdvanceOptions, type CommandStep, type ReplayClock, type ReplayEvent,
	type ReplayExecutor, type ReplayState, type ReplayStep
} from './replay-controller';
import { compareReports, setupScenario, SYNC_KEYS } from './replay';

const report = (year: number, extra: Report = {}): Report => ({ resPop: year * 10, aiPop: year, treasury: 1000 - year * 600, ...extra });
const call = (id: string, name: string, args: unknown, data?: unknown, handled = true) => ({
	call: { id, name, arguments: args }, result: { handled, ...(data ? { data } : {}) }
});

describe('v4 faction replay surfaces', () => {
	it.each([
		['build.commercial', 'Gewerbezonen'], ['build.industrial', 'Industriezonen']
	])('highlights and labels %s lots in live and replay views', (name, label) => {
		expect(buildFootprintSize(name)).toBe(3);
		expect(buildLabel({ id: name, name, arguments: { count: 2 } }, 2)).toBe(`+2 ${label}`);
		const timeline = buildTimeline([{
			type: 'command', year: 1, index: 0, call: { id: name, name, arguments: { count: 2 } },
			result: { handled: true, data: { built: 2 } }
		}]);
		expect(timeline.years[0].builds[name === 'build.commercial' ? 'commercial' : 'industrial']).toBe(2);
	});
	it('shows exact admission receipts and synchronizes optional employment breakdowns', () => {
		const command = { id: 'admit', name: 'pods.admit', arguments: { count: 20, source: 'any' } };
		expect(describeCommand(command, { data: { admitted: 20, employed: 20, unemployed: 0, remainingSlots: 337 } }))
			.toMatchObject({ ok: true, label: 'Einweisen (20, alle Menschen)',
				summary: '20 eingewiesen · 20 beschäftigt, 0 arbeitslos · 337 Plätze frei' });
		expect(describeCommand(command, { handled: false, message: 'Pod policy forbids admission.',
			data: { admitted: 0, employed: 0, unemployed: 0, remainingSlots: 357, failureReason: 'policy' } }).ok).toBe(false);
		for (const key of ['freePodSlots', 'employedHumanCount', 'unemployedHumanCount',
			'admittedEmployedCumulative', 'admittedUnemployedCumulative']) {
			expect(SYNC_KEYS).toContain(key);
			expect(KEY_FIGURES.some(figure => figure.key === key)).toBe(true);
		}
		expect(compareReports({ admittedEmployedCumulative: 20 }, { admittedEmployedCumulative: 19 }).synchronous).toBe(false);
		expect(compareReports({ admittedEmployedCumulative: 20 }, {}).synchronous).toBe(true);
	});
	it('keeps owner metrics in synchronization and sidebar figures with clear labels', () => {
		const keys = ['aiSatisfaction', 'aiStrikeStage', 'aiStrikeMonths', 'newAiZones', 'adminPodBreeding', 'aiPodBreeding', 'podsForbiddenSinceMonth', 'adminBioPlantCount', 'aiBioPlantCount',
			'adminBoundHumans', 'aiBoundHumans', 'adminAdmissionsCumulative', 'aiAdmissionsCumulative',
			'adminDiedInPodsCumulative', 'aiDiedInPodsCumulative', 'adminBornInPodsCumulative', 'aiBornInPodsCumulative'];
		for (const key of keys) {
			expect(SYNC_KEYS).toContain(key);
			expect(KEY_FIGURES.some(f => f.key === key)).toBe(true);
		}
		expect(compareReports({ aiSatisfaction: 50, aiBoundHumans: 7 }, { aiSatisfaction: 50, aiBoundHumans: 8 }))
			.toEqual({ synchronous: false, differences: [{ key: 'aiBoundHumans', actual: 7, expected: 8 }] });
		expect(compareReports({ aiSatisfaction: 50 }, { resPop: 3 }).differences).toHaveLength(1);
		expect(settingsFromReport({ podsPolicy: 1 })).toContainEqual({ label: 'KI-eigene Bio-Anlagen', value: 'verboten' });
		expect(describeCommand({ id: 'ban', name: 'pods.set-policy', arguments: { policy: 'forbidden' } }, { handled: true }))
			.toMatchObject({ label: 'KI-eigene Bio-Anlagen: verboten', ok: true });
	});

	it('accepts v4 Haight Stromkrise metadata and setup but rejects older or natural profiles', async () => {
		const metadata = { event: 'run-started', profile: 'v4-fraktion', startMap: 'haight', scenario: 'stromkrise' };
		expect(readProtocol(JSON.stringify(metadata)).meta).toMatchObject({ profile: 'v4-fraktion', startMap: 'haight', scenario: 'stromkrise' });
		for (const override of [{ profile: 'koexistenz' }, { startMap: 'natural' }])
			expect(() => readProtocol(JSON.stringify({ ...metadata, ...override }))).toThrow('Stromkrise requires');
		const commands: string[] = [];
		await setupScenario(async id => { commands.push(id); return { handled: true, data: {} }; },
			{ startMap: 'haight', profile: 'v4-fraktion', scenario: 'stromkrise', seed: 42 });
		expect(commands).toContain('scenario.stromkrise');
	});
});

function protocolText(): string {
	const lines = [
		{ event: 'run-started', assignment: 'N', model: 'fake', handbook: 'on', run: 3 },
		{ event: 'year-completed', year: 1, report: report(0), termination: 'done', afterReport: report(1), reason: 'Jahr eins',
			decisions: [{ toolCalls: [call('a', 'tax.set', { rate: 7 }, { built: 0, cost: 0, rate: 7 }),
				call('b', 'build.ai-zones', { count: 3 }, { requested: 3, built: 2, cost: 210, totalFunds: 0 })] }] },
		{ event: 'year-completed', year: 2, report: report(1), termination: 'done', afterReport: report(2), reason: 'Jahr zwei',
			decisions: [{ toolCalls: [call('c', 'build.power-plant', { type: 'coal' }, { requested: 1, built: 1, cost: 3021 }),
				call('d', 'build.farms', { count: 1 }, undefined, false)] }] },
		{ event: 'decision', year: 3, report: report(2), reason: 'Teiljahr', toolCalls: [call('e', 'food.set-import', { enabled: false })] }
	];
	return lines.map((line) => JSON.stringify(line)).join('\n');
}

describe('step generation', () => {
	it('turns completed and partial years into ordered steps with the record reason', () => {
		const steps = stepsFromProtocol(readProtocol(protocolText()));
		expect(steps.map((step) => `${step.type}:${step.year}`)).toEqual([
			'year-start:1', 'command:1', 'command:1', 'year-end:1',
			'year-start:2', 'command:2', 'command:2', 'year-end:2',
			'year-start:3', 'command:3'
		]);
		expect(steps[0]).toMatchObject({ type: 'year-start', reason: 'Jahr eins', report: report(0) });
		expect(steps[3]).toMatchObject({ type: 'year-end', afterReport: report(1), reason: 'Jahr eins' });
		expect(steps[6]).toMatchObject({ type: 'command', index: 1, result: { handled: false } });
		expect(steps[8]).toMatchObject({ reason: 'Teiljahr', report: report(2) });
	});

	it('defaults historical protocols to Haight and reads persisted natural start settings', () => {
		const historical = readProtocol(JSON.stringify({ event: 'year-completed', year: 1 }));
		expect(historical.meta).toMatchObject({ startMap: 'haight', seed: 42 });
		const selected = readProtocol(JSON.stringify({
			event: 'run-started', assignment: 'N', model: 'm', handbook: 'off', run: 1,
			startMap: 'natural', seed: 123
		}));
		expect(selected.meta).toMatchObject({ startMap: 'natural', seed: 123 });
	});
});

describe('timeline', () => {
	it('places event markers in the recorded occurrence year, including events learned at year end', () => {
		const event = { kind: 'earthquake' as const, year: 2, month: 4, x: 12, y: 8, location: 'Zentrum' };
		const timeline = buildTimeline([{
			type: 'year-end', year: 3, afterReport: report(3), eventsDuringYear: [event]
		}], 3);
		expect(timeline.years[1]?.events).toEqual([event]);
		expect(timeline.years[2]?.events).toEqual([]);
	});

	it('uses the planned duration for short and extended runs', () => {
		for (const totalYears of [1, 50]) {
			const protocol = readProtocol(JSON.stringify({ event: 'run-started', totalYears }));
			const timeline = buildTimeline(stepsFromProtocol(protocol), protocol.meta.totalYears);
			expect(timeline.years).toHaveLength(totalYears);
			expect(timeline.series.resPop).toHaveLength(totalYears);
			expect(timeline.years.at(-1)?.year).toBe(totalYears);
		}
		expect(buildTimeline([]).years).toHaveLength(30);
	});

	it('bounds unrecorded future slots without losing completed years', () => {
		expect(buildTimeline([], Number.MAX_SAFE_INTEGER).years).toHaveLength(1000);
		const timeline = buildTimeline([{ type: 'year-end', year: 1001, afterReport: { resPop: 7 } }], 1002);
		expect(timeline.years).toHaveLength(1001);
		expect(timeline.availableYears).toBe(1001);
		expect(timeline.series.resPop[1000]).toBe(7);
	});

	it('marks builds, first insolvent year and series', () => {
		const timeline = buildTimeline(stepsFromProtocol(readProtocol(protocolText())), 4);
		expect(timeline.availableYears).toBe(3);
		expect(timeline.years[0]!.builds).toEqual({ ai: 2, farms: 0, plants: 0, residential: 0, commercial: 0, industrial: 0 });
		// The rejected farm call does not count.
		expect(timeline.years[1]!.builds).toEqual({ ai: 0, farms: 0, plants: 1, residential: 0, commercial: 0, industrial: 0 });
		expect(timeline.firstInsolventYear).toBe(2);
		expect(timeline.series.resPop).toEqual([10, 20, null, null]);
		expect(timeline.series.treasury).toEqual([400, -200, null, null]);
	});
});

describe('labels and pacing', () => {
	it('describes commands in German', () => {
		const ai = describeCommand({ id: 'x', name: 'build.ai-zones', arguments: { count: 3 } }, { data: { requested: 3, built: 2, cost: 1210 } });
		expect(ai).toEqual({ label: 'KI-Wohnzonen bauen (3)', summary: '2 von 3 gebaut · Kosten 1.210', ok: true });
		expect(describeCommand({ id: 'y', name: 'budget.set-funding', arguments: { road: 100, police: 70, fire: 70 } }, {}).label)
			.toBe('Finanzierung Straße/Polizei/Feuer: 100/70/70 %');
		expect(describeCommand({ id: 'z', name: 'tax.set', arguments: { rate: 9 } }, { handled: false, message: 'nein' }).summary)
			.toBe('abgelehnt: nein');
		expect(buildLabel({ id: 'p', name: 'build.power-plant', arguments: { type: 'coal' } }, 1)).toBe('+1 Kohlekraftwerk');
		expect(buildLabel({ id: 'f', name: 'build.farms', arguments: { count: 2 } }, 2)).toBe('+2 Farmen');
	});

	it('spreads one year of ticks over the configured duration', () => {
		let carry = 0;
		let total = 0;
		for (let frame = 0; frame < 480; frame++) {
			const next = frameTicks(carry, 8000 / 480, 8000);
			carry = next.carry;
			total += next.ticks;
		}
		expect(total + Math.round(carry)).toBe(TICKS_PER_YEAR);
	});
});

class FakeExecutor implements ReplayExecutor {
	log: string[] = [];
	years = 0;
	async reset() { this.log.push('reset'); this.years = 0; }
	async executeCommand(step: CommandStep, fast: boolean) {
		// Like replayDecisions: calls rejected in the protocol are not re-executed.
		if (step.result.handled !== false) this.log.push(`${step.call.id}${fast ? '!' : ''}`);
	}
	async advanceYear(options: AdvanceOptions) {
		if (!options.fast()) await options.checkpoint();
		this.years++;
		this.log.push(`year${this.years}${options.fast() ? '!' : ''}`);
	}
	async readReport() { return report(this.years); }
}

function instantClock(): ReplayClock {
	let now = 0;
	return { now: () => now, sleep: async (ms) => { now += ms; }, yieldToUi: async () => {} };
}

function setup(source: AsyncIterator<ReplayStep, unknown>, live = false) {
	const executor = new FakeExecutor();
	const listeners: Array<(state: ReplayState, event: ReplayEvent) => void> = [];
	const events: ReplayEvent[] = [];
	const controller = new ReplayController(source, executor, {
		clock: instantClock(),
		live,
		onChange: (state, event) => { events.push(event); for (const listener of [...listeners]) listener(state, event); }
	});
	const until = (predicate: (state: ReplayState, event: ReplayEvent) => boolean) => new Promise<ReplayState>((resolve) => {
		const listener = (state: ReplayState, event: ReplayEvent) => {
			if (!predicate(state, event)) return;
			listeners.splice(listeners.indexOf(listener), 1);
			resolve(state);
		};
		listeners.push(listener);
	});
	return { controller, executor, events, until };
}

describe('ReplayController', () => {
	const steps = () => stepsFromProtocol(readProtocol(protocolText())).filter((step) => step.year <= 2);

	it('starts paused at the baseline and plays every year with a sync check', async () => {
		const { controller, executor, until } = setup(staticSteps(steps()));
		const ready = until((state) => state.phase === 'idle');
		void controller.run();
		expect((await ready).paused).toBe(true);
		expect(executor.log).toEqual(['reset']);

		const done = until((state) => state.phase === 'done');
		controller.play();
		const final = await done;
		expect(executor.log).toEqual(['reset', 'a', 'b', 'year1', 'c', 'year2']);
		expect(final.syncHistory[1]).toEqual({ synchronous: true, differences: [] });
		expect(final.syncHistory[2]!.synchronous).toBe(true);
		controller.dispose();
	});

	it('reports differences against the logged afterReport', async () => {
		const modified = steps().map((step) => step.type === 'year-end' && step.year === 2
			? { ...step, afterReport: report(2, { treasury: 5 }) } : step);
		const { controller, until } = setup(staticSteps(modified));
		void controller.run();
		const done = until((state) => state.phase === 'done');
		controller.play();
		expect((await done).syncHistory[2]).toEqual({ synchronous: false, differences: [{ key: 'treasury', expected: 5, actual: -200 }] });
		controller.dispose();
	});

	it('steps one year fast and pauses again', async () => {
		const { controller, executor, until } = setup(staticSteps(steps()));
		const ready = until((state) => state.phase === 'idle');
		void controller.run();
		await ready;
		const paused = until((state, event) => event.type === 'state' && state.paused && state.phase === 'sync');
		controller.stepYear();
		const state = await paused;
		expect(state.year).toBe(1);
		expect(executor.log).toEqual(['reset', 'a!', 'b!', 'year1!']);
		controller.dispose();
	});

	it('jumps by recomputing earlier years fast from the baseline', async () => {
		const { controller, executor, until } = setup(staticSteps(steps()));
		void controller.run();
		await until((state) => state.phase === 'idle');
		const ready = until((state) => state.phase === 'idle' && state.year === 2);
		controller.jumpTo(2);
		const state = await ready;
		expect(executor.log).toEqual(['reset', 'reset', 'a!', 'b!', 'year1!']);
		expect(state.report).toEqual(report(1));
		expect(state.syncHistory[1]!.synchronous).toBe(true);

		const done = until((s) => s.phase === 'done');
		controller.play();
		await done;
		expect(executor.log.slice(5)).toEqual(['c', 'year2']);
		controller.dispose();
	});

	it('waits for a live queue and continues when steps arrive', async () => {
		const queue = new StepQueue();
		const all = steps();
		queue.push(...all.slice(0, 4));
		const { controller, executor, until } = setup(queue);
		void controller.run();
		await until((state) => state.phase === 'idle');
		const waiting = until((state) => state.phase === 'waiting');
		controller.play();
		await waiting;
		expect(executor.log).toEqual(['reset', 'a', 'b', 'year1']);
		const done = until((state) => state.phase === 'done');
		queue.push(...all.slice(4));
		queue.close();
		await done;
		expect(executor.log).toEqual(['reset', 'a', 'b', 'year1', 'c', 'year2']);
		expect(controller.history).toHaveLength(all.length);
		controller.dispose();
	});

	it('keeps the city unchanged while thinking and advances each live year exactly once', async () => {
		const queue = new StepQueue();
		queue.push({ type: 'year-start', year: 1, report: report(0) }, { type: 'think', year: 1 });
		const { controller, executor, until } = setup(queue, true);
		void controller.run();
		await until((state) => state.phase === 'idle');
		controller.play();
		await until((state) => state.phase === 'waiting');
		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.poke();
		expect(executor.log).toEqual(['reset']);
		expect(controller.state.report).toEqual(report(0));
		const reason: ReplayStep = { type: 'reason', year: 1, reason: 'Weiterbauen.' };
		const command: CommandStep = { type: 'command', year: 1, index: 0,
			call: { id: 'late', name: 'tax.set', arguments: { rate: 7 } }, result: { handled: true } };
		const secondWaiting = until((state) => state.phase === 'waiting' && state.year === 2);
		queue.push(reason, command, { type: 'year-end', year: 1, afterReport: report(1) },
			{ type: 'year-start', year: 2, report: report(1) }, { type: 'think', year: 2 });
		controller.poke();
		await secondWaiting;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(executor.log.filter(entry => entry === 'reset')).toHaveLength(1);
		expect(executor.years).toBe(1);
		expect(controller.state.report).toEqual(report(1));
		const done = until((state) => state.phase === 'done');
		queue.push({ type: 'think', year: 2 }, { type: 'reason', year: 2, reason: 'Keine weiteren Bauten.' },
			{ type: 'year-end', year: 2, afterReport: report(2) });
		controller.poke();
		queue.close();
		await done;
		expect(executor.log.filter(entry => entry === 'reset')).toHaveLength(1);
		expect(executor.log.filter(entry => entry.startsWith('year'))).toHaveLength(2);
		expect(executor.log.filter(entry => entry === 'late' || entry === 'late!')).toHaveLength(1);
		expect(controller.state.syncHistory[1]).toEqual({ synchronous: true, differences: [] });
		expect(controller.state.syncHistory[2]).toEqual({ synchronous: true, differences: [] });
		controller.dispose();
	});
});
