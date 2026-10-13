import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { CityEventLedger, createEventCallback } from '../../src/lib/city-run/city-events';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { readProtocol } from '../../src/lib/city-run/protocol';
import { advanceMonthsStepwise } from '../../src/lib/city-run/advance';
import { compareReports, readReport, replayDecisions, setupScenario, type Dispatch } from '../../src/lib/city-run/replay';
import { assertReplayCompatible, canonicalProtocolText, CURRENT_ENGINE_ID, engineCompatibility } from '../../src/lib/city-run/compatibility';
import { runCity } from '../model/runner';
import { S266Adapter } from '../model/fake-adapter';
import type { YearRecord } from '../../src/lib/city-run/protocol';

const runs = [
	'fake-N-1.jsonl',
	'openai-N-3.jsonl',
	'openai-N-gpt-5_4-mini-d416b3a370c3-handbook-off-4.jsonl'
];

async function createCity() {
	registerMicropolisCommands();
	const engine = await loadMicropolisMainModule();
	const m = new engine.Micropolis();
	const cityEvents = new CityEventLedger(engine, m);
	m.setCallback(createEventCallback(engine, cityEvents), {});
	const simulator = { micropolis: m, cityEvents, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
	const dispatch: Dispatch = (id, args) => commandBus.dispatch(id, { source: 'script', simulator, args });
	return { m, dispatch };
}

/** The browser path: replay commands, then advance stepwise as the time-lapse does. */
async function replayYears(text: string, upTo: number, city: Awaited<ReturnType<typeof createCity>>) {
	const protocol = readProtocol(text);
	assertReplayCompatible(protocol.meta, createHash('sha256').update(canonicalProtocolText(text)).digest('hex'));
	await setupScenario(city.dispatch, protocol.meta);
	const results = [];
	for (const record of protocol.years.slice(0, upTo)) {
		await replayDecisions(record.decisions, city.dispatch);
		for (const _ of advanceMonthsStepwise(city.m, 12));
		results.push(compareReports(await readReport(city.dispatch), record.afterReport));
	}
	return { protocol, results };
}

describe('replay of logged model runs (headless)', () => {
	for (const file of runs) {
		it(`${file} is labelled alte Engine and stops before setup or commands`, async () => {
			const city = await createCity();
			try {
				const text = readFileSync(new URL(`../../../../docs/results/model-runs/${file}`, import.meta.url), 'utf8');
				expect(engineCompatibility(readProtocol(text).meta, createHash('sha256').update(canonicalProtocolText(text)).digest('hex')))
					.toMatchObject({ label: 'alte Engine', playable: false });
				const funds = city.m.totalFunds, time = city.m.cityTime;
				await expect(replayYears(text, 30, city)).rejects.toThrow('Alte Engine');
				expect(city.m.totalFunds).toBe(funds);
				expect(city.m.cityTime).toBe(time);
			} finally { city.m.delete(); }
		}, 120_000);
	}

	it.each(['haight', 'natural'] as const)('a newly measured safe-engine %s run stays synchronous for all 30 years and after a jump', async startMap => {
		const city = await createCity();
		try {
			const years: YearRecord[] = [];
			const startConfiguration = { startMap, seed: 42, profile: 'koexistenz' as const,
				...(startMap === 'natural' ? { autoBuildRules: 1 as const } : {}) };
			await runCity(new S266Adapter(), 'N', city.dispatch, row => years.push(row), undefined, { startConfiguration });
			const text = [JSON.stringify({ event: 'run-started', engineId: CURRENT_ENGINE_ID, ...startConfiguration }),
				...years.map(row => JSON.stringify({ event: 'year-completed', ...row }))].join('\n');
			const { results } = await replayYears(text, 30, city);
			expect(results).toHaveLength(30);
			results.forEach((result, index) => expect(result, `year ${index + 1}`).toEqual({ synchronous: true, differences: [] }));
			expect((await replayYears(text, 5, city)).results.every(result => result.synchronous)).toBe(true);
		} finally { city.m.delete(); }
	}, 120_000);
});
