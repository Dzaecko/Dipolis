import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { readProtocol } from '../../src/lib/city-run/protocol';
import { advanceMonthsStepwise } from '../../src/lib/city-run/advance';
import { compareReports, readReport, replayDecisions, setupScenario, type Dispatch } from '../../src/lib/city-run/replay';

const runs = [
	'fake-N-1.jsonl',
	'openai-N-3.jsonl',
	'openai-N-gpt-5_4-mini-d416b3a370c3-handbook-off-4.jsonl'
];

async function createCity() {
	registerMicropolisCommands();
	const engine = await loadMicropolisMainModule();
	const m = new engine.Micropolis();
	m.setCallback(createNoopJsCallback(engine), {});
	const simulator = { micropolis: m, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
	const dispatch: Dispatch = (id, args) => commandBus.dispatch(id, { source: 'script', simulator, args });
	return { m, dispatch };
}

/** The browser path: replay commands, then advance stepwise as the time-lapse does. */
async function replayYears(file: string, upTo: number, city: Awaited<ReturnType<typeof createCity>>) {
	const protocol = readProtocol(readFileSync(new URL(`../../../../docs/results/model-runs/${file}`, import.meta.url), 'utf8'));
	await setupScenario(city.dispatch);
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
		it(`${file} stays synchronous in every year`, async () => {
			const city = await createCity();
			try {
				const { protocol, results } = await replayYears(file, 30, city);
				expect(protocol.complete).toBe(true);
				expect(results).toHaveLength(30);
				results.forEach((result, index) => expect(result, `year ${index + 1}`).toEqual({ synchronous: true, differences: [] }));
			} finally { city.m.delete(); }
		}, 120_000);
	}

	it('recomputes on the same engine after a jump back to the baseline', async () => {
		const city = await createCity();
		try {
			await replayYears(runs[1]!, 8, city);
			const { results } = await replayYears(runs[1]!, 5, city);
			expect(results.every((result) => result.synchronous)).toBe(true);
		} finally { city.m.delete(); }
	}, 120_000);
});
