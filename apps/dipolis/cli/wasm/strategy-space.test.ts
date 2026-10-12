import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import {
	aggregateYears, controlsKey, dimensions, experimentStrategies, legacyStrategies, mulberry32,
	resultsCsv, SAMPLE_SEED, sampleStrategies, summarize, YEARS,
	type AnnualReport, type Result, type Strategy,
} from './strategy-space';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const artifactDir = path.join(root, 'docs/results');
const artifactName = process.env.STRATEGY_SPACE_NAME ?? 'strategy-space';
if (!/^[a-z0-9-]+$/.test(artifactName)) throw new Error('Invalid strategy-space artifact name');
const metadataPath = path.join(artifactDir, `${artifactName}.metadata.json`);
const scenario = { city: 'haight', profile: 'koexistenz', seed: 42, disasters: false, speed: 3 };

async function runStrategy(strategy: Strategy): Promise<Result> {
	// Opt-in only: fast tests neither instantiate nor import the WASM loader.
	const { commandBus } = await import('../../src/lib/CommandBus');
	const { registerMicropolisCommands } = await import('../../src/lib/micropolisCommands');
	const { createNoopJsCallback } = await import('../../src/lib/wasm/callbacks');
	const { loadMicropolisMainModule } = await import('../../src/lib/wasm/node');
	registerMicropolisCommands();
	const engine = await loadMicropolisMainModule();
	const m = new engine.Micropolis();
	try {
		m.setCallback(createNoopJsCallback(engine), {});
		const simulator = { micropolis: m, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
		const dispatch = async (id: string, args?: Record<string, unknown>) => {
			const result = await commandBus.dispatch(id, { source: 'script', simulator, args });
			if (result.handled === false) throw new Error(`${strategy.id} ${id}: ${result.message}`);
			return result.data as Record<string, number>;
		};
		const report = async () => {
			const data = await dispatch('report.get');
			for (const key of ['resPop', 'aiPop', 'treasury', 'cashFlow', 'powerReserve', 'lostToHunger', 'lostToPower', 'aiZoneCount']) {
				if (!Number.isFinite(data[key])) throw new Error(`${strategy.id}: invalid report ${key}`);
			}
			return data;
		};
		const build = async (id: string, args: Record<string, unknown>) => {
			const data = await dispatch(id, args);
			if (!Number.isInteger(data.built) || data.built < 0) throw new Error(`${strategy.id}: invalid ${id} build count`);
			return data.built;
		};
		expect(await dispatch('scenario.start', scenario)).toMatchObject({ seed: 42, speed: 3, passes: 1 });
		await dispatch('tax.set', { rate: 7 });
		await dispatch('food.set-import', { enabled: true });
		await dispatch('power.set-priority', { priority: 0 });
		expect(await dispatch('sim.advance-ticks', { ticks: 12000 })).toMatchObject({ ticksAdvanced: 12000 });
		await dispatch('treasury.set', { amount: 60000 });
		const census = await report();
		await dispatch('report.mark-baseline');
		expect(await report()).toMatchObject({ baselineResPop: census.resPop, netResPopChange: 0 });
		// A-D retain their fixed control values; the common yearly rules,
		// including reserve-triggered coal construction, apply to all 304.
		const rows: AnnualReport[] = [];
		let builtPlants = 0, builtFarms = 0;
		for (let year = 1; year <= YEARS; year++) {
			const before = await report();
			{
				await dispatch('tax.set', { rate: strategy.tax });
				await dispatch('welfare.set-level', { level: strategy.welfareLevel });
				await dispatch('power.set-priority', { priority: strategy.priority });
				await dispatch('budget.set-funding', { road: 100, police: strategy.serviceFunding, fire: strategy.serviceFunding });
				await dispatch('food.set-import', { enabled: strategy.foodImport === 'always-on' ||
					(strategy.foodImport === 'off-below-10000' && before.treasury >= 10000) });
			}
			if (year === 1 && strategy.farmsInYearOne > 0) builtFarms += await build('build.farms', { count: strategy.farmsInYearOne });
			if (strategy.aiZonesPerYear > 0 && (!strategy.aiOnlyWhenCashFlowNegative || before.cashFlow < 0)) {
				await build('build.ai-zones', { count: strategy.aiZonesPerYear });
			}
			const reserve = before.powerReserve;
			if (strategy.coalWhenReserveLow && reserve < 0.1) builtPlants += await build('build.power-plant', { type: 'coal' });
			if (strategy.latchImportsOff && before.treasury < 10000) await dispatch('food.set-import', { enabled: false });
			await dispatch('sim.advance', { months: 12 });
			const after = await report();
			rows.push({ year, resPop: after.resPop, aiPop: after.aiPop, treasury: after.treasury,
				lostToHunger: after.lostToHunger, lostToPower: after.lostToPower, aiZoneCount: after.aiZoneCount });
		}
		return { ...strategy, ...aggregateYears(rows, builtPlants, builtFarms) };
	} finally {
		m.delete();
	}
}

function fingerprint() {
	const files = [
		'apps/dipolis/cli/wasm/strategy-space.ts', 'apps/dipolis/cli/wasm/strategy-space.test.ts',
		'apps/dipolis/src/lib/CommandBus.ts', 'apps/dipolis/src/lib/micropolisCommands.ts',
		'apps/dipolis/src/lib/params/koexistenz.json', 'apps/dipolis/src/lib/wasm/node.ts',
		'apps/dipolis/src/lib/wasm/callbacks.ts', 'apps/dipolis/src/lib/micropolisengine.js',
		'apps/dipolis/src/lib/micropolisengine.wasm', 'apps/dipolis/src/lib/micropolisengine.data',
	];
	const hashes = Object.fromEntries(files.map((file) => [file,
		createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]));
	return { hashes, scenarioHash: createHash('sha256').update(JSON.stringify({ scenario, hashes })).digest('hex') };
}

function atomicWrite(filename: string, contents: string) {
	writeFileSync(`${filename}.tmp`, contents, 'utf8');
	renameSync(`${filename}.tmp`, filename);
}

interface Metadata {
	identity: string;
	configuration: ReturnType<typeof configuration>;
	createdAt: string;
	completedAt?: string;
	status: 'running' | 'complete';
	completedRuns: number;
	results: Result[];
}
function configuration() {
	return { schemaVersion: 1, sampleSeed: SAMPLE_SEED, prng: 'mulberry32/partial-fisher-yates',
		years: YEARS, warmupTicks: 12000, initialTreasury: 60000, scenario, dimensions,
		strategies: experimentStrategies(), runtime: { node: process.version, platform: process.platform, arch: process.arch },
		...fingerprint() };
}

function validateCheckpoint(metadata: Metadata, identity: string, strategies: Strategy[]) {
	if (metadata.identity !== identity ||
		createHash('sha256').update(JSON.stringify(metadata.configuration)).digest('hex') !== identity) {
		throw new Error('Incompatible strategy-space checkpoint; archive/remove artifacts before restarting.');
	}
	if (!Array.isArray(metadata.results) || metadata.results.length > strategies.length ||
		metadata.completedRuns !== metadata.results.length || !['running', 'complete'].includes(metadata.status) ||
		(metadata.status === 'complete' && metadata.results.length !== strategies.length)) throw new Error('Invalid checkpoint progress');
	for (const [i, result] of metadata.results.entries()) {
		const expected = strategies[i]!;
		if (Object.keys(expected).some((key) => result[key as keyof Strategy] !== expected[key as keyof Strategy]) ||
			Object.keys(aggregateYears(fixtureYears(), 0, 0)).some((key) => {
				const value = result[key as keyof Result];
				return key === 'firstInsolvencyYear' ? value !== null &&
					(typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > YEARS) :
					typeof value !== 'number' || !Number.isFinite(value);
			})) throw new Error(`Invalid checkpoint result at index ${i}`);
	}
}

function fixtureYears(): AnnualReport[] {
	return Array.from({ length: YEARS }, (_, i) => ({ year: i + 1, resPop: i + 1, aiPop: 2 * (i + 1),
		treasury: i === 1 ? -1 : i === 2 ? 0 : 100, lostToHunger: i, lostToPower: i * 2, aiZoneCount: i }));
}

describe('strategy-space fast design checks (no WASM)', () => {
	it('samples 300 unique grid combinations reproducibly, excluding all legacy controls', () => {
		const sample = sampleStrategies();
		expect(sample).toHaveLength(300);
		expect(sampleStrategies()).toEqual(sample);
		expect(sampleStrategies(SAMPLE_SEED + 1)).not.toEqual(sample);
		expect(new Set(sample.map(controlsKey)).size).toBe(300);
		const legacyKeys = new Set(legacyStrategies.map(controlsKey));
		for (const strategy of sample) {
			expect(legacyKeys.has(controlsKey(strategy))).toBe(false);
			expect(strategy.coalWhenReserveLow).toBe(true);
			for (const key of Object.keys(dimensions) as (keyof typeof dimensions)[]) {
				expect([...dimensions[key]]).toContain(strategy[key]);
			}
		}
		expect(experimentStrategies()).toHaveLength(304);
		expect(new Set(experimentStrategies().map(controlsKey)).size).toBe(304);
		const gridSize = Object.values(dimensions).reduce((n, values) => n * values.length, 1);
		expect(gridSize).toBe(2916);
		expect(sampleStrategies(SAMPLE_SEED, gridSize - 3)).toHaveLength(gridSize - 3);
		expect(() => sampleStrategies(SAMPLE_SEED, gridSize - 2)).toThrow();
		expect(() => sampleStrategies(-1)).toThrow();
		const random = mulberry32(1);
		expect([random(), random(), random()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
	});
	it('keeps legacy interventions explicit', () => {
		expect(legacyStrategies.map((s) => [s.id, s.coalWhenReserveLow, s.aiOnlyWhenCashFlowNegative, s.latchImportsOff]))
			.toEqual([['A', true, true, false], ['B', true, true, false], ['C', true, true, false], ['D', true, true, false]]);
		expect(legacyStrategies[1]).toMatchObject({ tax: 9, serviceFunding: 60, roadFunding: 100 });
	});
	it('aggregates all 30 post-advance years and final cumulative loss counters', () => {
		expect(aggregateYears(fixtureYears(), 3, 10)).toEqual({ meanResPop: 15.5, minResPop: 1,
			finalResPop: 30, meanAiPop: 31, finalFunds: 100, insolventYears: 2, lostToHunger: 29,
			lostToPower: 58, finalAiZones: 29, builtPlants: 3, builtFarms: 10, firstInsolvencyYear: 2 });
		expect(() => aggregateYears(fixtureYears().slice(1), 0, 0)).toThrow();
		expect(() => aggregateYears(fixtureYears().map((r) => ({ ...r, year: 0 })), 0, 0)).toThrow();
		expect(() => aggregateYears(fixtureYears().map((r) => ({ ...r, aiPop: NaN })), 0, 0)).toThrow();
	});
	it('includes controls in rankings and separates sampled dimension means', () => {
		const rows = experimentStrategies().map((s, i) => ({ ...s, ...aggregateYears(fixtureYears(), 0, 0), finalFunds: i }));
		const summary = summarize(rows);
		expect(summary.n).toBe(304);
		expect(summary.top10finalFunds.map((r) => r.finalFunds)).toEqual([303, 302, 301, 300, 299, 298, 297, 296, 295, 294]);
		expect(summary.top10meanAiPop).toHaveLength(10);
		expect(summary.top10meanResPop[0]).toHaveProperty('foodImport');
		for (const groups of Object.values(summary.dimensionMeans)) {
			expect(groups.reduce((n, group) => n + group.n, 0)).toBe(300);
			expect(groups.every((g) => g.meanResPop === 15.5)).toBe(true);
		}
		expect(summary.dimensionMeans.serviceFunding.some((g) => g.value === 60)).toBe(false);
		expect(summary.dimensionMeansIncludingLegacy.serviceFunding.find((g) => g.value === 60)?.n).toBe(1);
		expect(resultsCsv(rows).trim().split('\n')).toHaveLength(305);
		expect(resultsCsv(rows)).toContain('coalWhenReserveLow');
	});
	it('refuses stale, missing, reordered, or non-finite checkpoint rows', () => {
		const strategies = experimentStrategies();
		// No filesystem or engine dependency: exercise the checkpoint contract with a synthetic identity.
		const config = { schemaVersion: 1 } as ReturnType<typeof configuration>;
		const identity = createHash('sha256').update(JSON.stringify(config)).digest('hex');
		const metadata: Metadata = { identity, configuration: config, createdAt: '', status: 'running', completedRuns: 1,
			results: [{ ...strategies[0]!, ...aggregateYears(fixtureYears(), 0, 0) }] };
		expect(() => validateCheckpoint(metadata, identity, strategies)).not.toThrow();
		expect(() => validateCheckpoint(metadata, 'stale', strategies)).toThrow();
		expect(() => validateCheckpoint({ ...metadata, completedRuns: 2 }, identity, strategies)).toThrow();
		expect(() => validateCheckpoint({ ...metadata, results: [{ ...metadata.results[0]!, id: 'B' }] }, identity, strategies)).toThrow();
		expect(() => validateCheckpoint({ ...metadata, results: [{ ...metadata.results[0]!, meanAiPop: NaN }] }, identity, strategies)).toThrow();
	});
});

describe.skipIf(process.env.STRATEGY_SPACE_RUN !== '1')('strategy-space opt-in real-WASM experiment', () => {
	it('runs/resumes all 304 strategies sequentially and writes complete artifacts', async () => {
		const config = configuration(); // Missing prebuilt artifacts fail here; never build implicitly.
		const identity = createHash('sha256').update(JSON.stringify(config)).digest('hex');
		const strategies = config.strategies;
		mkdirSync(artifactDir, { recursive: true });
		const metadata: Metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) :
			{ identity, configuration: config, createdAt: new Date().toISOString(), status: 'running', completedRuns: 0, results: [] };
		validateCheckpoint(metadata, identity, strategies);
		const save = () => atomicWrite(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
		save();
		console.log(`STRATEGY_SPACE resume ${metadata.results.length}/${strategies.length}, sampleSeed=${SAMPLE_SEED}`);
		for (let i = metadata.results.length; i < strategies.length; i++) {
			const started = Date.now();
			metadata.results.push(await runStrategy(strategies[i]!));
			metadata.completedRuns = metadata.results.length;
			save(); // Only a fully completed 30-year strategy becomes resumable.
			if ((i + 1) % 20 === 0 || i + 1 === strategies.length) {
				console.log(`STRATEGY_SPACE ${i + 1}/${strategies.length}, last=${strategies[i]!.id}, lastRunMs=${Date.now() - started}`);
			}
		}
		validateCheckpoint(metadata, identity, strategies);
		expect(metadata.results).toHaveLength(304);
		atomicWrite(path.join(artifactDir, `${artifactName}.csv`), resultsCsv(metadata.results));
		atomicWrite(path.join(artifactDir, `${artifactName}.summary.json`), JSON.stringify({
			identity, sampleSeed: SAMPLE_SEED, ...summarize(metadata.results),
		}, null, 2) + '\n');
		metadata.status = 'complete';
		metadata.completedAt ??= new Date().toISOString();
		save();
	}, 2 * 60 * 60 * 1000);
});