import { describe, expect, it } from 'vitest';
import coexistence from '../../src/lib/params/koexistenz.json';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

type Lot = [number, number];
type Sample = {
	tick: number;
	resPop: number;
	aiPop: number;
	unemploymentRate: number;
	automationShare: number;
	welfareCost: number;
	aiTaxFund: number;
	cashFlow: number;
	totalFunds: number;
	hungryZoneCount: number;
	unpoweredZoneCount: number;
};

function selectFreePoweredLots(engine: MainModule, sim: Micropolis, count: number): Lot[] {
	const tiles = new Uint16Array(engine.wasmMemory.buffer, sim.getMapAddress(), sim.getMapSize() / Uint16Array.BYTES_PER_ELEMENT);
	const zoneBit = engine.MapTileBits.ZONEBIT.value;
	const powerBit = engine.MapTileBits.PWRBIT.value;
	const mask = engine.MapTileBits.LOMASK.value;
	const free = engine.Tiles.FREEZ.value;
	const candidates: Array<{ x: number; y: number; score: number }> = [];
	for (let x = 1; x < engine.WORLD_W - 1; x += 1) {
		for (let y = 1; y < engine.WORLD_H - 1; y += 1) {
			const tile = tiles[x * engine.WORLD_H + y] ?? 0;
			if ((tile & zoneBit) === 0 || (tile & powerBit) === 0 || (tile & mask) !== free) continue;
			candidates.push({ x, y, score: sim.getLandValue(x >> 1, y >> 1) - sim.getPollutionDensity(x >> 1, y >> 1) });
		}
	}
	candidates.sort((a, b) => b.score - a.score);
	const selected: Lot[] = [];
	for (const candidate of candidates) {
		if (selected.some(([x, y]) => Math.abs(x - candidate.x) <= 2 && Math.abs(y - candidate.y) <= 2)) continue;
		selected.push([candidate.x, candidate.y]);
		if (selected.length === count) break;
	}
	return selected;
}

async function runAiArrival(welfareLevel: number): Promise<Sample[]> {
	const engine = await loadMicropolisMainModule();
	const sim = new engine.Micropolis();
	const callback = createNoopJsCallback(engine);
	sim.setFixedSeed(42);
	sim.setCallback(callback, {});
	sim.init();
	try {
		for (const [name, value] of Object.entries(coexistence)) expect(sim.setParam(name, value)).toBe(true);
		expect(sim.setParam('powerPriority', 0)).toBe(true);
		expect(sim.setParam('welfareLevel', welfareLevel)).toBe(true);
		sim.setEnableDisasters(false);
		expect(sim.loadCity('/cities/haight.cty')).toBe(true);
		sim.setCityTax(7);
		const lots = selectFreePoweredLots(engine, sim, 40);
		expect(lots).toHaveLength(40);
		for (const [x, y] of lots) {
			expect(sim.doTool(engine.EditingTool.TOOL_BULLDOZER, x, y).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			expect(sim.buildOwnedResidential(x, y, 2).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
		}
		sim.setSpeed(3);
		sim.setPasses(1);
		const timeline: Sample[] = [];
		for (let tick = 1; tick <= 40_000; tick += 1) {
			sim.simTick();
			if (tick % 8_000 === 0) {
				timeline.push({
					tick,
					resPop: sim.resPop,
					aiPop: sim.aiPop,
					unemploymentRate: sim.unemploymentRate,
					automationShare: sim.automationShare,
					welfareCost: sim.welfareCost,
					aiTaxFund: sim.aiTaxFund,
					cashFlow: sim.cashFlow,
					totalFunds: sim.totalFunds,
					hungryZoneCount: sim.hungryZoneCount,
					unpoweredZoneCount: sim.unpoweredZoneCount,
				});
			}
		}
		return timeline;
	} finally {
		sim.delete();
	}
}

describe('The AIs are coming: welfare levels on Haight', () => {
	it('repeats all three welfare runs and human population increases with welfare', async () => {
		const runs = new Map<number, Sample[]>();
		let noWelfareTotalFunds = 0;
		for (const level of [0, 0.5, 1]) {
			const first = await runAiArrival(level);
			const second = await runAiArrival(level);
			expect(second).toEqual(first);
			expect(first).toHaveLength(5);
			if (level === 0) noWelfareTotalFunds = first.at(-1)!.totalFunds;
			if (level === 1) expect(first.at(-1)!.totalFunds).toBeGreaterThan(0);
			runs.set(level, first);
			console.log(`welfareLevel=${level}`);
			console.table(first.map((sample) => ({
				...sample,
				unemploymentRate: Number(sample.unemploymentRate.toFixed(3)),
				automationShare: Number(sample.automationShare.toFixed(3)),
			})));
		}
		expect(runs.get(0.5)!.at(-1)!.resPop).toBeGreaterThan(runs.get(0)!.at(-1)!.resPop);
		expect(runs.get(1)!.at(-1)!.resPop).toBeGreaterThan(runs.get(0.5)!.at(-1)!.resPop);
		expect(runs.get(1)!.at(-1)!.totalFunds).toBeLessThan(noWelfareTotalFunds);
	}, 240_000);
});
