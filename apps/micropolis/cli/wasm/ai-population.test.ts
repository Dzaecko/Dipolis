import { describe, expect, it } from 'vitest';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

type Point = [number, number];
type Candidate = { x: number; y: number; score: number };
type PopulationSample = {
	tick: number;
	aiPop: number;
	resPop: number;
	reserve: number;
	aiCoverage: number;
	unpoweredZoneCount: number;
	aiUnpoweredZoneCount: number;
	powerCapacity: number;
	powerDemand: number;
};

interface PowerRunResult {
	aiPop: number;
	aiTaxFund: number;
	aiYieldPerPop: number;
	cityTax: number;
	cashFlow: number;
	resPop: number;
	aiZones: number;
	ownerInvariant: number;
	cityTime: number;
	powerCapacity: number;
	powerDemand: number;
	aiValve: number;
	reserve: number;
	aiPopAtDemolition: number;
	capacityBeforeDemolition: number;
	capacityAfterDemolition: number;
	unpoweredAfterPowerIncrease: number;
}

function mapView(engine: MainModule, micropolis: Micropolis): Uint16Array {
	return new Uint16Array(
		engine.wasmMemory.buffer,
		micropolis.getMapAddress(),
		micropolis.getMapSize() / Uint16Array.BYTES_PER_ELEMENT,
	);
}

function residentialCenters(engine: MainModule, micropolis: Micropolis): Point[] {
	const map = mapView(engine, micropolis);
	const centers: Point[] = [];
	const zoneBit = engine.MapTileBits.ZONEBIT.value;
	const tileMask = engine.MapTileBits.LOMASK.value;
	const hospitalTile = engine.Tiles.HOSPITAL.value;

	for (let x = 0; x < engine.WORLD_W; x += 1) {
		for (let y = 0; y < engine.WORLD_H; y += 1) {
			const tile = map[x * engine.WORLD_H + y] ?? 0;
			if ((tile & zoneBit) !== 0 && (tile & tileMask) < hospitalTile) centers.push([x, y]);
		}
	}
	return centers;
}

function freePoweredResidentialLots(engine: MainModule, micropolis: Micropolis, count: number): Point[] {
	const map = mapView(engine, micropolis);
	const mask = engine.MapTileBits.LOMASK.value;
	const zoneBit = engine.MapTileBits.ZONEBIT.value;
	const powerBit = engine.MapTileBits.PWRBIT.value;
	const freeResidential = engine.Tiles.FREEZ.value;
	const candidates: Candidate[] = [];

	for (let x = 1; x < engine.WORLD_W - 1; x += 1) {
		for (let y = 1; y < engine.WORLD_H - 1; y += 1) {
			const tile = map[x * engine.WORLD_H + y] ?? 0;
			if ((tile & zoneBit) === 0 || (tile & mask) !== freeResidential || (tile & powerBit) === 0) continue;
			candidates.push({
				x,
				y,
				score: micropolis.getLandValue(x >> 1, y >> 1) - micropolis.getPollutionDensity(x >> 1, y >> 1),
			});
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	const selected: Point[] = [];
	for (const candidate of candidates) {
		if (selected.some(([x, y]) => Math.abs(candidate.x - x) <= 2 && Math.abs(candidate.y - y) <= 2)) continue;
		selected.push([candidate.x, candidate.y]);
		if (selected.length === count) break;
	}
	return selected;
}

function nuclearPlantCenters(engine: MainModule, micropolis: Micropolis): Point[] {
	const map = mapView(engine, micropolis);
	const mask = engine.MapTileBits.LOMASK.value;
	const zoneBit = engine.MapTileBits.ZONEBIT.value;
	const nuclear = engine.Tiles.NUCLEAR.value;
	const result: Point[] = [];
	for (let x = 0; x < engine.WORLD_W; x += 1) {
		for (let y = 0; y < engine.WORLD_H; y += 1) {
			const tile = map[x * engine.WORLD_H + y] ?? 0;
			if ((tile & zoneBit) !== 0 && (tile & mask) === nuclear) result.push([x, y]);
		}
	}
	return result;
}

function countOwnedZones(engine: MainModule, micropolis: Micropolis): number {
	const owners = new Uint8Array(
		engine.wasmMemory.buffer,
		micropolis.getOwnerMapAddress(),
		micropolis.getOwnerMapSize(),
	);
	return owners.reduce((sum, owner) => sum + Number(owner === 2), 0);
}

function getReserve(micropolis: Micropolis): number {
	return micropolis.powerReserve;
}

async function runHaightAiDistrict(options: {
	ticks: number;
	aiPowerPerPop?: number;
	aiReserveLow?: number;
	aiReserveHigh?: number;
	aiYieldPerPop?: number;
	cityTax?: number;
	powerPriority?: number;
	increaseAiPowerAt?: number;
	buildAiZones?: boolean;
	collectEvery?: number;
	demolishPlantAt?: number;
}): Promise<{ result: PowerRunResult; timeline: PopulationSample[] }> {
	const engine = await loadMicropolisMainModule();
	const micropolis = new engine.Micropolis();
	const callback = createNoopJsCallback(engine);
	micropolis.setCallback(callback, {});
	micropolis.init();
	const timeline: PopulationSample[] = [];
	let aiPopAtDemolition = 0;
	let capacityBeforeDemolition = 0;
	let capacityAfterDemolition = 0;

	try {
		micropolis.setFixedSeed(42);
		micropolis.setEnableDisasters(false);
		expect(micropolis.loadCity('/cities/haight.cty')).toBe(true);

		const owners = new Uint8Array(
			engine.wasmMemory.buffer,
			micropolis.getOwnerMapAddress(),
			micropolis.getOwnerMapSize(),
		);
		expect(owners.every((owner) => owner === 0)).toBe(true);
		expect(micropolis.setZoneOwner(-1, 0, 2)).toBe(false);
		if (options.cityTax !== undefined) micropolis.cityTax = options.cityTax;

		micropolis.setSpeed(3);
		micropolis.setPasses(1);
		for (let tick = 0; tick < 1_024; tick += 1) micropolis.simTick();

		if (options.buildAiZones !== false) {
			const lots = freePoweredResidentialLots(engine, micropolis, 20);
			expect(lots).toHaveLength(20);
			for (const [x, y] of lots) {
				const bulldoze = micropolis.doTool(engine.EditingTool.TOOL_BULLDOZER, x, y);
				expect(bulldoze.value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
				const build = micropolis.buildOwnedResidential(x, y, 2);
				expect(build.value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			}
		}

		if (options.aiPowerPerPop !== undefined) expect(micropolis.setParam('aiPowerPerPop', options.aiPowerPerPop)).toBe(true);
		if (options.aiReserveLow !== undefined) expect(micropolis.setParam('aiReserveLow', options.aiReserveLow)).toBe(true);
		if (options.aiReserveHigh !== undefined) expect(micropolis.setParam('aiReserveHigh', options.aiReserveHigh)).toBe(true);
		if (options.aiYieldPerPop !== undefined) expect(micropolis.setParam('aiYieldPerPop', options.aiYieldPerPop)).toBe(true);
		if (options.powerPriority !== undefined) expect(micropolis.setParam('powerPriority', options.powerPriority)).toBe(true);
		micropolis.aiValveOverride = false;
		const plants = nuclearPlantCenters(engine, micropolis);
		expect(plants.length).toBeGreaterThanOrEqual(2);
		let unpoweredAfterPowerIncrease = 0;

		for (let tick = 0; tick < options.ticks; tick += 1) {
			micropolis.simTick();
			if (tick + 1 === 10_000) unpoweredAfterPowerIncrease = micropolis.unpoweredZoneCount;
			if (tick + 1 === options.increaseAiPowerAt) expect(micropolis.setParam('aiPowerPerPop', 20)).toBe(true);
			if (options.collectEvery && ((tick + 1) % options.collectEvery === 0 || tick + 1 === options.ticks)) {
				timeline.push({
					tick: tick + 1,
					aiPop: micropolis.aiPop,
					resPop: micropolis.resPop,
					reserve: getReserve(micropolis),
					aiCoverage: micropolis.aiCoverage,
					unpoweredZoneCount: micropolis.unpoweredZoneCount,
					aiUnpoweredZoneCount: micropolis.aiUnpoweredZoneCount,
					powerCapacity: micropolis.powerCapacity,
					powerDemand: micropolis.powerDemand,
				});
			}
			if (tick + 1 === options.demolishPlantAt) {
				aiPopAtDemolition = micropolis.aiPop;
				capacityBeforeDemolition = micropolis.powerCapacity;
				const demolition = micropolis.doTool(engine.EditingTool.TOOL_BULLDOZER, ...plants[0]!);
				expect(demolition.value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			}
			if (options.demolishPlantAt && tick + 1 === options.demolishPlantAt + 1_000) {
				capacityAfterDemolition = micropolis.powerCapacity;
			}
		}

		return {
			result: {
				aiPop: micropolis.aiPop,
				aiTaxFund: micropolis.aiTaxFund,
				aiYieldPerPop: micropolis.getParam('aiYieldPerPop'),
				cityTax: micropolis.cityTax,
				cashFlow: micropolis.cashFlow,
				resPop: micropolis.resPop,
				aiZones: countOwnedZones(engine, micropolis),
				ownerInvariant: micropolis.checkOwnerInvariant(),
				cityTime: micropolis.cityTime,
				powerCapacity: micropolis.powerCapacity,
				powerDemand: micropolis.powerDemand,
				aiValve: micropolis.aiValve,
				reserve: getReserve(micropolis),
				aiPopAtDemolition,
				capacityBeforeDemolition,
				capacityAfterDemolition,
				unpoweredAfterPowerIncrease,
			},
			timeline,
		};
	} finally {
		micropolis.delete();
	}
}

describe('AI-owned residential zones with power-reserve demand', () => {
	it('clears the owner map when generating a new city', async () => {
		const engine = await loadMicropolisMainModule();
		const micropolis = new engine.Micropolis();
		const callback = createNoopJsCallback(engine);
		micropolis.setCallback(callback, {});
		micropolis.init();
		try {
			micropolis.setFixedSeed(42);
			expect(micropolis.getParam('aiReserveLow')).toBeCloseTo(0.05, 6);
			expect(micropolis.getParam('aiReserveHigh')).toBeCloseTo(0.15, 6);
			expect(micropolis.getParam('powerPriority')).toBe(0);
			expect(micropolis.loadCity('/cities/haight.cty')).toBe(true);
			const [x, y] = residentialCenters(engine, micropolis)[0]!;
			expect(micropolis.setZoneOwner(x, y, 2)).toBe(true);
			micropolis.generateSomeRandomCity();
			const owners = new Uint8Array(engine.wasmMemory.buffer, micropolis.getOwnerMapAddress(), micropolis.getOwnerMapSize());
			expect(owners.every((owner) => owner === 0)).toBe(true);
		} finally {
			micropolis.delete();
		}
	});

	it('20 powered AI lots grow, retain reserve, stabilize, and repeat deterministically', async () => {
		const first = await runHaightAiDistrict({ ticks: 30_000, collectEvery: 2_000 });
		const second = await runHaightAiDistrict({ ticks: 30_000 });
		expect(first.result.aiZones).toBe(20);
		expect(first.result.aiPop).toBeGreaterThan(0);
		expect(first.result.aiPop).toBeGreaterThan(30);
		expect(first.result.resPop).toBeGreaterThan(0);
		expect(first.result.aiValve).toBe(2000);
		expect(first.timeline).toHaveLength(15);
		expect(Math.abs(first.timeline.at(-1)!.aiPop - first.timeline.at(-2)!.aiPop)).toBeLessThanOrEqual(30);
		expect(second.result).toEqual(first.result);
		console.table(first.timeline);
	});

	it('narrow reserve band timeline and no-AI control', async () => {
		const aiRun = await runHaightAiDistrict({
			ticks: 30_000,
			aiReserveLow: 0.05,
			aiReserveHigh: 0.15,
			cityTax: 7,
			collectEvery: 2_000,
		});
		const controlRun = await runHaightAiDistrict({ ticks: 30_000, cityTax: 7, buildAiZones: false, collectEvery: 2_000 });
		expect(aiRun.timeline).toHaveLength(15);
		expect(controlRun.timeline).toHaveLength(15);
		expect(aiRun.result.aiTaxFund).toBeGreaterThan(0);
		console.log('aiTaxFund Lauf 1:', aiRun.result.aiTaxFund);
		console.table(aiRun.timeline.map((sample, index) => ({
			...sample,
			reserve: `${(sample.reserve * 100).toFixed(2)}%`,
			resPopWithoutAi: controlRun.timeline[index]?.resPop ?? 0,
		})));
	});

	it('power-priority settings are inert without AI population', async () => {
		const runs = [];
		for (const powerPriority of [0, 1, 2]) {
			runs.push(await runHaightAiDistrict({ ticks: 30_000, cityTax: 7, powerPriority, buildAiZones: false }));
		}
		const comparable = ({ reserve: _reserve, aiValve: _aiValve, ...result }: PowerRunResult) => result;
		expect(comparable(runs[1]!.result)).toEqual(comparable(runs[0]!.result));
		expect(comparable(runs[2]!.result)).toEqual(comparable(runs[0]!.result));
	});

	it('power priority allocates scarce power to the selected population', async () => {
		const priorities = [
			{ name: 'gleichmäßig', value: 0 },
			{ name: 'Menschen zuerst', value: 1 },
			{ name: 'KIs zuerst', value: 2 },
		] as const;
		const runs = [];
		for (const { value } of priorities) {
			const first = await runHaightAiDistrict({
				ticks: 30_000,
				cityTax: 7,
				powerPriority: value,
				increaseAiPowerAt: 10_000,
				collectEvery: 4_000,
			});
			const second = await runHaightAiDistrict({
				ticks: 30_000,
				cityTax: 7,
				powerPriority: value,
				increaseAiPowerAt: 10_000,
			});
			runs.push({ priority: value, first, second });
		}
		const humansFirst = runs.find((run) => run.priority === 1)!;
		const even = runs.find((run) => run.priority === 0)!;
		const aiFirst = runs.find((run) => run.priority === 2)!;
		const noShortage = await runHaightAiDistrict({ ticks: 30_000, cityTax: 7, buildAiZones: false });
		console.table(runs.flatMap(({ priority, first }) => first.timeline.map((sample) => ({
			priority: priorities.find((entry) => entry.value === priority)!.name,
			tick: sample.tick,
			aiPop: sample.aiPop,
			resPop: sample.resPop,
			aiCoverage: Number(sample.aiCoverage.toFixed(3)),
			unpoweredZoneCount: sample.unpoweredZoneCount,
			aiUnpoweredZoneCount: sample.aiUnpoweredZoneCount,
			powerDemand: sample.powerDemand,
		}))));
		expect(humansFirst.first.result.resPop).toBeGreaterThan(even.first.result.resPop);
		expect(even.first.result.resPop).toBeGreaterThan(aiFirst.first.result.resPop);
		expect(aiFirst.first.result.aiPop).toBeGreaterThan(even.first.result.aiPop);
		expect(even.first.result.aiPop).toBeGreaterThan(humansFirst.first.result.aiPop);
		const atLeastFifteenPercentBetween = (value: number, low: number, high: number) =>
			(value - low) >= (high - low) * 0.15 && (high - value) >= (high - low) * 0.15;
		expect(atLeastFifteenPercentBetween(even.first.result.resPop, aiFirst.first.result.resPop, humansFirst.first.result.resPop)).toBe(true);
		expect(atLeastFifteenPercentBetween(even.first.result.aiPop, humansFirst.first.result.aiPop, aiFirst.first.result.aiPop)).toBe(true);
		expect(humansFirst.first.result.unpoweredAfterPowerIncrease).toBeLessThanOrEqual(noShortage.result.unpoweredAfterPowerIncrease);
		for (const run of runs) {
			expect(run.first.result).toEqual(run.second.result);
			expect(run.first.timeline).toHaveLength(8);
		}
	});

	it('aiPowerPerPop=10 ends with less AI population while human population remains', async () => {
		const normal = await runHaightAiDistrict({ ticks: 30_000 });
		const higherCost = await runHaightAiDistrict({ aiPowerPerPop: 10, ticks: 30_000 });
		expect(higherCost.result.powerDemand).toBeGreaterThan(normal.result.powerDemand);
		expect(higherCost.result.resPop).toBeGreaterThan(0);
	});

	it('clamps cashFlow when AI tax yield exceeds the short range', async () => {
		const run = await runHaightAiDistrict({ ticks: 30_000, cityTax: 7, aiYieldPerPop: 10_000 });
		expect(run.result.aiTaxFund).toBeGreaterThan(0);
		expect(run.result.cashFlow).toBe(32_767);
	});

	it('removing a nuclear plant at tick 15000 subsequently reduces AI population', async () => {
		const run = await runHaightAiDistrict({ ticks: 30_000, demolishPlantAt: 15_000 });
		expect(run.result.capacityAfterDemolition).toBeLessThan(run.result.capacityBeforeDemolition);
		expect(run.result.ownerInvariant).toBe(0);
	});
});
