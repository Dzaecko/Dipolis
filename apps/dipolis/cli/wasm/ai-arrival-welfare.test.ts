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
	baselineResPop: number;
	gainedResPop: number;
	lostToPower: number;
	lostToHunger: number;
	lostToDemand: number;
	unemploymentRate: number;
	automationShare: number;
	taxFund: number;
	welfareCost: number;
	aiTaxFund: number;
	roadFund: number;
	policeFund: number;
	fireFund: number;
	foodImportCost: number;
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

async function runAiArrival(welfareLevel: number, addAiZones: boolean) {
	const engine = await loadMicropolisMainModule();
	const sim = new engine.Micropolis();
	const callback = createNoopJsCallback(engine);
	sim.setFixedSeed(42);
	sim.setCallback(callback, {});
	sim.init();
	try {
		for (const [name, value] of Object.entries(coexistence)) expect(sim.setParam(name, value)).toBe(true);
		expect(sim.setParam('powerPriority', 0)).toBe(true);
		expect(sim.setParam('welfareLevel', 0)).toBe(true);
		sim.setEnableDisasters(false);
		expect(sim.loadCity('/cities/haight.cty')).toBe(true);
		sim.setCityTax(7);
		sim.setSpeed(3);
		sim.setPasses(1);
		const settling = [{ tick: 0, resPop: sim.resPop }];
		const settleSamples = new Set([500, 1000, 2000, 4000, 8000, 12000]);
		for (let settleTick = 1; settleTick <= 12_000; settleTick += 1) {
			sim.simTick();
			if (settleSamples.has(settleTick)) settling.push({ tick: settleTick, resPop: sim.resPop });
		}
		sim.markBaseline();
		expect(sim.setParam('welfareLevel', welfareLevel)).toBe(true);
		if (addAiZones) {
			const lots = selectFreePoweredLots(engine, sim, 40);
			expect(lots).toHaveLength(40);
			for (const [x, y] of lots) {
				expect(sim.doTool(engine.EditingTool.TOOL_BULLDOZER, x, y).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
				expect(sim.buildOwnedResidential(x, y, 2).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			}
		}
		const timeline: Sample[] = [];
		for (let tick = 1; tick <= 40_000; tick += 1) {
			sim.simTick();
			if (tick % 8_000 === 0) {
				timeline.push({
					tick,
					resPop: sim.resPop,
					aiPop: sim.aiPop,
					baselineResPop: sim.baselineResPop,
					gainedResPop: sim.gainedResPop,
					lostToPower: sim.lostToPower,
					lostToHunger: sim.lostToHunger,
					lostToDemand: sim.lostToDemand,
					unemploymentRate: sim.unemploymentRate,
					automationShare: sim.automationShare,
					taxFund: sim.humanTaxFund,
					welfareCost: sim.welfareCost,
					aiTaxFund: sim.aiTaxFund,
					roadFund: sim.roadFund,
					policeFund: sim.policeFund,
					fireFund: sim.fireFund,
					foodImportCost: sim.foodImportCost,
					cashFlow: sim.cashFlow,
					totalFunds: sim.totalFunds,
					hungryZoneCount: sim.hungryZoneCount,
					unpoweredZoneCount: sim.unpoweredZoneCount,
				});
			}
		}
		return { settling, timeline };
	} finally {
		sim.delete();
	}
}

describe('The AIs are coming: welfare levels on Haight', () => {
	it('repeats a no-AI control and both welfare runs; population accounting closes within five percent', async () => {
		const controlRun = await runAiArrival(0, false);
		const controlRepeat = await runAiArrival(0, false);
		expect(controlRepeat).toEqual(controlRun);
		const control = controlRun.timeline;
		console.log('Einschwingen — Haight ohne KI, Welfare 0');
		console.table(controlRun.settling);
		const controlFinal = control.at(-1)!;
		const controlAccounted = controlFinal.baselineResPop + controlFinal.gainedResPop -
			controlFinal.lostToPower - controlFinal.lostToHunger - controlFinal.lostToDemand;
		expect(Math.abs(controlFinal.resPop - controlAccounted), `control actual=${controlFinal.resPop}, accounted=${controlAccounted}`)
			.toBeLessThanOrEqual(Math.max(1, controlFinal.resPop) * 0.05);
		console.log('Kontrolllauf — keine KI-Zonen nach Baseline');
		console.table(control);

		const runs = new Map<number, Sample[]>();
		let noWelfareTotalFunds = 0;
		for (const level of [0, 1]) {
			const firstRun = await runAiArrival(level, true);
			const second = await runAiArrival(level, true);
			expect(second).toEqual(firstRun);
			expect(firstRun.settling).toEqual(controlRun.settling);
			const first = firstRun.timeline;
			expect(first).toHaveLength(5);
			if (level === 0) noWelfareTotalFunds = first.at(-1)!.totalFunds;
			if (level === 1) expect(first.at(-1)!.totalFunds).toBeGreaterThan(0);
			for (const sample of first) {
				const accounted = sample.baselineResPop + sample.gainedResPop -
					sample.lostToPower - sample.lostToHunger - sample.lostToDemand;
				expect(Math.abs(sample.resPop - accounted), `welfareLevel=${level}, tick=${sample.tick}, actual=${sample.resPop}, accounted=${accounted}`)
					.toBeLessThanOrEqual(Math.max(1, sample.resPop) * 0.05);
				expect(sample.hungryZoneCount).toBe(0);
				expect(sample.unpoweredZoneCount).toBe(0);
			}
			runs.set(level, first);
			console.log(`welfareLevel=${level}`);
			console.table(first.map((sample) => ({
				...sample,
				unemploymentRate: Number(sample.unemploymentRate.toFixed(3)),
				automationShare: Number(sample.automationShare.toFixed(3)),
			})));
		}
		expect(runs.get(1)!.at(-1)!.resPop).toBeGreaterThan(runs.get(0)!.at(-1)!.resPop);
		expect(runs.get(1)!.at(-1)!.totalFunds).toBeLessThan(noWelfareTotalFunds);
	}, 240_000);
});
