import { describe, expect, it } from 'vitest';
import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';
import coexistence from '../../src/lib/params/koexistenz.json';

function numericReport(m: Micropolis) {
	return {
		year: m.cityYear,
		treasury: m.totalFunds,
		taxFund: m.humanTaxFund,
		aiTaxFund: m.aiTaxFund,
		roadFund: m.roadFund,
		policeFund: m.policeFund,
		fireFund: m.fireFund,
		foodImportCost: m.foodImportCost,
		welfareCost: m.welfareCost,
		cashFlow: m.cashFlow,
		resPop: m.resPop,
		aiPop: m.aiPop,
		peakResPop: m.peakResPop,
		lostToPower: m.lostToPower,
		lostToHunger: m.lostToHunger,
		lostToDemand: m.lostToDemand,
		unemploymentRate: m.unemploymentRate,
		automationShare: m.automationShare,
		foodCoverage: m.foodCoverage,
		hungryZoneCount: m.hungryZoneCount,
		powerCapacity: m.powerCapacity,
		powerDemand: m.powerDemand,
		powerReserve: m.powerReserve,
		unpoweredZoneCount: m.unpoweredZoneCount,
		aiUnpoweredZoneCount: m.aiUnpoweredZoneCount,
		cityTax: m.cityTax,
		powerPriority: m.getParam('powerPriority'),
		foodImportEnabled: m.getParam('foodImportEnabled'),
		welfareLevel: m.getParam('welfareLevel'),
	};
}

async function createCity(): Promise<{ engine: MainModule; micropolis: Micropolis }> {
	const engine = await loadMicropolisMainModule();
	const m = new engine.Micropolis();
	const callback = createNoopJsCallback(engine);
	m.setFixedSeed(42);
	m.setCallback(callback, {});
	m.init();
	for (const [name, value] of Object.entries(coexistence)) expect(m.setParam(name, value)).toBe(true);
	m.setEnableDisasters(false);
	expect(m.loadCity('/cities/haight.cty')).toBe(true);
	m.setCityTax(7);
	m.setSpeed(3);
	m.setPasses(1);
	return { engine, micropolis: m };
}

describe('simulation command bus reporting and advancement', () => {
	it('matches direct engine settings and month advancement exactly', async () => {
		registerMicropolisCommands();
		const { micropolis: direct } = await createCity();
		try {
			direct.setParam('powerPriority', 0);
			direct.setParam('foodImportEnabled', 1);
			direct.setParam('welfareLevel', 0.5);
			direct.setCityTax(7);
		const targetCityTime = direct.cityTime + 12;
			direct.setSpeed(3);
			direct.setPasses(1);
			let guard = 12 * 32 + 32;
			while (direct.cityTime < targetCityTime && guard-- > 0) direct.simTick();
			expect(direct.cityTime).toBe(targetCityTime);
			const expected = numericReport(direct);
			direct.delete();

			const { micropolis: throughBus } = await createCity();
			const simulator = { micropolis: throughBus, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
			try {
				for (const [id, args] of [
					['power.set-priority', { priority: 0 }],
					['food.set-import', { enabled: true }],
					['welfare.set-level', { level: 0.5 }],
					['city.set-tax', { rate: 7 }],
				] as const) {
					const result = await commandBus.dispatch(id, { source: 'script', simulator, args });
					expect(result.handled).not.toBe(false);
				}
				const advance = await commandBus.dispatch('sim.advance', {
					source: 'script',
					simulator,
					args: { months: 12 },
				});
				expect(advance.handled).not.toBe(false);
				const report = await commandBus.dispatch('report.get', { source: 'script', simulator });
				expect(report.data).toEqual(expected);
			} finally {
				throughBus.delete();
			}
		} finally {
			try { direct.delete(); } catch {}
		}
	}, 60_000);
});
