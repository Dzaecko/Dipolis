import { describe, expect, it } from 'vitest';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';
import classic from '../../src/lib/params/classic.json';
import coexistence from '../../src/lib/params/koexistenz.json';

type Lot = [number, number];
type Sample = {
	tick: number;
	resPop: number;
	aiPop: number;
	farmPop: number;
	foodProduction: number;
	foodDemand: number;
	foodCoverage: number;
	hungryZoneCount: number;
	foodImportCost: number;
	taxFund: number;
	totalFunds: number;
};
type Result = { resPop: number; aiPop: number; aiZones: number; farmPop: number; farmZones: number; industryZones: number; foodProduction: number; foodDemand: number; foodCoverage: number; foodImportCost: number; taxFund: number; totalFunds: number };

function selectAiLots(engine: MainModule, sim: Micropolis): Lot[] {
	const tiles = new Uint16Array(engine.wasmMemory.buffer, sim.getMapAddress(), sim.getMapSize() / 2);
	const zone = engine.MapTileBits.ZONEBIT.value;
	const power = engine.MapTileBits.PWRBIT.value;
	const mask = engine.MapTileBits.LOMASK.value;
	const free = engine.Tiles.FREEZ.value;
	const candidates: Array<{ x: number; y: number; score: number }> = [];
	for (let x = 1; x < engine.WORLD_W - 1; x++) {
		for (let y = 1; y < engine.WORLD_H - 1; y++) {
			const tile = tiles[x * engine.WORLD_H + y] ?? 0;
			if ((tile & zone) === 0 || (tile & power) === 0 || (tile & mask) !== free) continue;
			candidates.push({ x, y, score: sim.getLandValue(x >> 1, y >> 1) - sim.getPollutionDensity(x >> 1, y >> 1) });
		}
	}
	candidates.sort((a, b) => b.score - a.score);
	const lots: Lot[] = [];
	for (const candidate of candidates) {
		if (lots.some(([x, y]) => Math.abs(candidate.x - x) <= 2 && Math.abs(candidate.y - y) <= 2)) continue;
		lots.push([candidate.x, candidate.y]);
		if (lots.length === 20) break;
	}
	return lots;
}

function markQuarterOfIndustryAsFarm(engine: MainModule, sim: Micropolis): { farms: number; industries: number } {
	const tiles = new Uint16Array(engine.wasmMemory.buffer, sim.getMapAddress(), sim.getMapSize() / 2);
	const zone = engine.MapTileBits.ZONEBIT.value;
	const mask = engine.MapTileBits.LOMASK.value;
	const indClear = engine.Tiles.INDCLR.value;
	const indStart = engine.Tiles.IZB.value;
	const centers: Lot[] = [];
	for (let x = 0; x < engine.WORLD_W; x++) {
		for (let y = 0; y < engine.WORLD_H; y++) {
			const tile = tiles[x * engine.WORLD_H + y] ?? 0;
			const value = tile & mask;
			const industrialCenter = value === indClear ||
				(value >= indStart && value <= indStart + 7 * 9 && (value - indStart) % 9 === 0);
			if ((tile & zone) !== 0 && industrialCenter) centers.push([x, y]);
		}
	}
	let farms = 0;
	for (let index = 0; index < centers.length; index += 4) {
		const [x, y] = centers[index]!;
		if (sim.setZoneOwner(x, y, 3)) farms++;
	}
	return { farms, industries: centers.length };
}

async function runFoodCity(options: { foodEnabled: boolean; farms: boolean; coexistenceBaseline?: boolean; foodImportEnabled?: boolean }): Promise<{ result: Result; timeline: Sample[] }> {
	const engine = await loadMicropolisMainModule();
	const sim = new engine.Micropolis();
	const callback = createNoopJsCallback(engine);
	sim.setCallback(callback, {});
	sim.init();
	const timeline: Sample[] = [];
	try {
		sim.setFixedSeed(42);
		sim.setEnableDisasters(false);
		expect(sim.loadCity('/cities/haight.cty')).toBe(true);
		sim.setSpeed(3);
		sim.setPasses(1);
		for (let tick = 0; tick < 1_024; tick++) sim.simTick();

		const profile = options.foodEnabled || options.coexistenceBaseline ? coexistence : classic;
		for (const [name, value] of Object.entries(profile)) {
			const configuredValue = !options.foodEnabled && (name === 'foodPerHumanPop' || name === 'foodPerFarmPop') ? 0 : value;
			expect(sim.setParam(name, configuredValue)).toBe(true);
		}
		expect(sim.setParam('foodImportEnabled', options.foodImportEnabled === true ? 1 : 0)).toBe(true);
		sim.setCityTax(7);
		const aiLots = selectAiLots(engine, sim);
		expect(aiLots).toHaveLength(20);
		for (const [x, y] of aiLots) {
			expect(sim.doTool(engine.EditingTool.TOOL_BULLDOZER, x, y).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			expect(sim.buildOwnedResidential(x, y, 2).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
		}
		const industry = options.farms ? markQuarterOfIndustryAsFarm(engine, sim) : { farms: 0, industries: 0 };
		if (options.farms) {
			expect(industry.farms).toBeGreaterThan(0);
			expect(industry.farms / industry.industries).toBeCloseTo(0.25, 1);
		} else expect(industry.farms).toBe(0);

		for (let tick = 0; tick < 30_000; tick++) {
			sim.simTick();
			if ((tick + 1) % 4_000 === 0 || tick === 29_999) {
				timeline.push({
					tick: tick + 1,
					resPop: sim.resPop,
					aiPop: sim.aiPop,
					farmPop: sim.farmPop,
					foodProduction: sim.foodProduction,
					foodDemand: sim.foodDemand,
					foodCoverage: sim.foodCoverage,
					hungryZoneCount: sim.hungryZoneCount,
					foodImportCost: sim.foodImportCost,
					taxFund: sim.taxFund,
					totalFunds: sim.totalFunds,
				});
			}
		}
		return {
			result: {
				resPop: sim.resPop,
				aiPop: sim.aiPop,
				aiZones: new Uint8Array(engine.wasmMemory.buffer, sim.getOwnerMapAddress(), sim.getOwnerMapSize()).filter((owner) => owner === 2).length,
				farmZones: new Uint8Array(engine.wasmMemory.buffer, sim.getOwnerMapAddress(), sim.getOwnerMapSize()).filter((owner) => owner === 3).length,
				industryZones: industry.industries,
				farmPop: sim.farmPop,
				foodProduction: sim.foodProduction,
				foodDemand: sim.foodDemand,
				foodCoverage: sim.foodCoverage,
				foodImportCost: sim.foodImportCost,
				taxFund: sim.taxFund,
				totalFunds: sim.totalFunds,
			},
			timeline,
		};
	} finally {
		sim.delete();
	}
}

describe('farm food balance', () => {
	it('keeps classic food rules disabled and makes its comparison reproducible', async () => {
		const first = await runFoodCity({ foodEnabled: false, farms: false });
		const second = await runFoodCity({ foodEnabled: false, farms: false });
		expect(first.result).toEqual(second.result);
		expect(first.result.foodCoverage).toBe(1);
		expect(first.result.farmPop).toBe(0);
	});

	it('imports Haight food at tax 7 and caps purchases to available treasury', async () => {
		const run = await runFoodCity({ foodEnabled: true, farms: false, foodImportEnabled: true });
		const repeat = await runFoodCity({ foodEnabled: true, farms: false, foodImportEnabled: true });
		expect(run.result).toEqual(repeat.result);
		expect(run.timeline).toEqual(repeat.timeline);
		expect(run.result.foodCoverage).toBe(1);
		expect(run.result.foodImportCost).toBeGreaterThan(0);
		expect(run.timeline.some(({ foodCoverage }) => foodCoverage >= 0.99)).toBe(true);
		console.table(run.timeline.map(({ tick, resPop, foodDemand, foodImportCost, taxFund, totalFunds, foodCoverage }) => ({
			tick, resPop, foodDemand, foodImportCost, taxFund, totalFunds, foodCoverage,
			importShareOfTax: taxFund > 0 ? Number((foodImportCost / taxFund).toFixed(3)) : 0,
		})));
	});

	it('koexistence without farms lowers human residents while preserving AI population', async () => {
		const control = await runFoodCity({ foodEnabled: false, farms: false, coexistenceBaseline: true });
		const hungry = await runFoodCity({ foodEnabled: true, farms: false });
		expect(hungry.result.resPop).toBeLessThan(control.result.resPop * 0.8);
		expect(hungry.timeline.some(({ hungryZoneCount }) => hungryZoneCount > 0)).toBe(true);
		expect(Math.abs(hungry.result.aiPop - control.result.aiPop) / Math.max(control.result.aiPop, 1)).toBeLessThanOrEqual(0.15);
		const repeat = await runFoodCity({ foodEnabled: true, farms: false });
		expect(repeat.result).toEqual(hungry.result);
		expect(repeat.timeline).toEqual(hungry.timeline);
		console.table(hungry.timeline.map(({ tick, resPop, aiPop, farmPop, foodProduction, foodDemand, foodCoverage }) => ({
			tick, resPop, aiPop, farmPop, foodProduction, foodDemand, foodCoverage,
		})));
	});

	it('one quarter of Haight industry marked as farms nearly covers food demand', async () => {
		const control = await runFoodCity({ foodEnabled: false, farms: false, coexistenceBaseline: true });
		const fed = await runFoodCity({ foodEnabled: true, farms: true });
		expect(fed.result.foodCoverage).toBeGreaterThanOrEqual(0.9);
		expect(fed.result.resPop).toBeGreaterThanOrEqual(control.result.resPop * 0.9);
		expect(fed.result.farmPop).toBeGreaterThan(0);
		const repeat = await runFoodCity({ foodEnabled: true, farms: true });
		expect(repeat.result).toEqual(fed.result);
		expect(repeat.timeline).toEqual(fed.timeline);
		expect(fed.result.farmZones / fed.result.industryZones).toBeCloseTo(0.25, 1);
		console.table(fed.timeline.map(({ tick, resPop, aiPop, farmPop, foodProduction, foodDemand, foodCoverage }) => ({
			tick, resPop, aiPop, farmPop, foodProduction, foodDemand, foodCoverage,
		})));
	});
});
