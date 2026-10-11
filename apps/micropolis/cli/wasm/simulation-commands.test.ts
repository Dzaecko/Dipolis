import { describe, expect, it, vi } from 'vitest';
import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';
import coexistence from '../../src/lib/params/koexistenz.json';

type ScenarioEngine = Micropolis & {
	autoBuild: (kind: number, count: number) => number;
	getAiZoneCount: () => number;
	setServiceFunding: (road: number, police: number, fire: number) => void;
	roadPercent: number;
	policePercent: number;
	firePercent: number;
};

function numericReport(m: Micropolis) {
	return {
		year: m.cityYear,
		treasury: m.totalFunds,
		taxFund: m.humanTaxFund,
		aiTaxFund: m.aiTaxFund,
		roadFund: m.roadFund,
		policeFund: m.policeFund,
		fireFund: m.fireFund,
		roadFundingPercent: (m as ScenarioEngine).roadPercent * 100,
		policeFundingPercent: (m as ScenarioEngine).policePercent * 100,
		fireFundingPercent: (m as ScenarioEngine).firePercent * 100,
		roadEffect: m.roadEffect,
		policeEffect: m.policeEffect,
		fireEffect: m.fireEffect,
		crimeAverage: m.crimeAverage,
		roadTotal: m.roadTotal,
		roadTileCount: m.getRoadTileCount(),
		foodImportCost: m.foodImportCost,
		welfareCost: m.welfareCost,
		cashFlow: m.cashFlow,
		resPop: m.resPop,
		aiPop: m.aiPop,
		baselineResPop: m.baselineResPop,
		netResPopChange: m.resPop - m.baselineResPop,
		lostToPower: m.lostToPower,
		lostToHunger: m.lostToHunger,
		aiZoneCount: (m as ScenarioEngine).getAiZoneCount(),
		unemploymentRate: m.unemploymentRate,
		automationShare: m.automationShare,
		automationLimit: m.getParam('automationLimit'),
		automationTaxFund: m.automationTaxFund,
		automatedJobs: m.automatedJobs,
		unrest: m.unrest,
		unrestStage: m.unrestStage,
		stage: m.unrestStage,
		sabotageFires: m.sabotageFires,
		fires: m.sabotageFires,
		damagedAiZones: m.damagedAiZones,
		damagedPowerPlants: m.damagedPowerPlants,
		protestMonths: m.protestMonths,
		sabotageMonths: m.sabotageMonths,
		uprisingMonths: m.uprisingMonths,
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
			const targetCityTime = direct.cityTime + 12 * 4;
			direct.setSpeed(3);
			direct.setPasses(1);
			let guard = 12 * 4 * 32 + 32;
			while (direct.cityTime < targetCityTime && guard-- > 0) direct.simTick();
			while (direct.cityTime === targetCityTime && direct.phaseCycle >= 1 && direct.phaseCycle <= 9 && guard-- > 0) direct.simTick();
			expect(direct.cityTime).toBe(targetCityTime);
			expect(direct.phaseCycle).toBe(10);
			direct.markBaseline();
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
				expect(throughBus.cityTime).toBe(targetCityTime);
				const baseline = await commandBus.dispatch('report.mark-baseline', { source: 'script', simulator });
				expect(baseline.handled).not.toBe(false);
				const report = await commandBus.dispatch('report.get', { source: 'script', simulator });
				expect(report.data).toEqual(expected);
				expect((report.data as { baselineResPop: number }).baselineResPop).toBe(throughBus.resPop);
				expect((report.data as { netResPopChange: number }).netResPopChange).toBe(0);
				expect(report.data).not.toHaveProperty('gainedResPop');
				expect(report.data).not.toHaveProperty('lostToDemand');
			} finally {
				throughBus.delete();
			}
		} finally {
			try { direct.delete(); } catch {}
		}
	}, 60_000);
});

function createScenarioSimulator() {
	const m = {
		totalFunds: 10000,
		cityTax: 7,
		cityTime: 0,
		cityYear: 1900,
		phaseCycle: 0,
		simSpeed: 1,
		simPasses: 3,
		resPop: 80,
		baselineResPop: 100,
		gainedResPop: 50,
		lostToDemand: 70,
		roadPercent: 1,
		policePercent: 1,
		firePercent: 1,
		roadEffect: 32,
		policeEffect: 1000,
		fireEffect: 1000,
		crimeAverage: 42,
		roadTotal: 1234,
		getAiZoneCount: vi.fn(() => 12),
		getRoadTileCount: vi.fn(() => 100),
		getParam: vi.fn(() => 0),
		autoBuild: vi.fn((_kind: number, count: number) => {
			const built = Math.min(count, 2);
			m.totalFunds -= built * 100;
			return built;
		}),
		setCityTax: vi.fn((rate: number) => { m.cityTax = rate; }),
		setServiceFunding: vi.fn((road: number, police: number, fire: number) => {
			m.roadPercent = road;
			m.policePercent = police;
			m.firePercent = fire;
		}),
		setFunds: vi.fn((amount: number) => { m.totalFunds = amount; }),
		setSpeed: vi.fn((speed: number) => { m.simSpeed = speed; }),
		setPasses: vi.fn((passes: number) => { m.simPasses = passes; }),
		simTick: vi.fn(() => {
			if (m.phaseCycle === 0) m.cityTime++;
			m.phaseCycle = (m.phaseCycle + 1) & 15;
		}),
	};
	const clock = {
		micropolis: m,
		framesPerSecond: 30,
		setFramesPerSecond: vi.fn((fps: number) => { clock.framesPerSecond = fps; }),
	};
	return { m, clock, simulator: clock as unknown as MicropolisSimulator };
}

describe('scenario command contracts', () => {
	registerMicropolisCommands();

	it.each([
		['build.residential', { count: 5 }, 0, 5, 2],
		['build.ai-zones', { count: 1000 }, 1, 1000, 2],
		['build.farms', { count: 0 }, 2, 0, 0],
		['build.power-plant', { type: 'coal' }, 3, 1, 1],
		['build.power-plant', { type: 'nuclear' }, 4, 1, 1],
	] as const)('routes %s through autoBuild and reports actual spending', async (id, args, kind, requested, built) => {
		const { m, simulator } = createScenarioSimulator();
		const result = await commandBus.dispatch(id, { source: 'script', simulator, args });
		expect(m.autoBuild).toHaveBeenCalledTimes(1);
		expect(m.autoBuild).toHaveBeenCalledWith(kind, requested);
		expect(result.data).toEqual({ requested, built, cost: built * 100, totalFunds: 10000 - built * 100 });
	});

	it('reports unsuccessful placement without inventing costs', async () => {
		const { m, simulator } = createScenarioSimulator();
		m.autoBuild.mockImplementation(() => 0);
		const result = await commandBus.dispatch('build.ai-zones', { source: 'script', simulator, args: { count: 3 } });
		expect(result.data).toEqual({ requested: 3, built: 0, cost: 0, totalFunds: 10000 });
	});

	it.each(['build.residential', 'build.ai-zones', 'build.farms'])('rejects invalid counts for %s before building', async (id) => {
		const { m, simulator } = createScenarioSimulator();
		for (const count of [undefined, '1', -1, 0.5, 1001, NaN, Infinity]) {
			const result = await commandBus.dispatch(id, { source: 'script', simulator, args: { count } });
			expect(result.handled).toBe(false);
		}
		expect(m.autoBuild).not.toHaveBeenCalled();
	});

	it('rejects invalid power plant types', async () => {
		const { m, simulator } = createScenarioSimulator();
		for (const type of [undefined, 'solar', 3]) {
			expect((await commandBus.dispatch('build.power-plant', { source: 'script', simulator, args: { type } })).handled).toBe(false);
		}
		expect(m.autoBuild).not.toHaveBeenCalled();
	});

	it('converts all service percentages to engine fractions', async () => {
		const { m, simulator } = createScenarioSimulator();
		const result = await commandBus.dispatch('budget.set-funding', {
			source: 'script', simulator, args: { road: 0, police: 50.5, fire: 100 },
		});
		expect(m.setServiceFunding).toHaveBeenCalledTimes(1);
		expect(m.setServiceFunding).toHaveBeenCalledWith(0, 0.505, 1);
		expect(result.data).toEqual({ built: 0, cost: 0, road: 0, police: 50.5, fire: 100 });
		expect(m.totalFunds).toBe(10000);
	});

	it('always reports current independent funding percentages, service effects, crime and roads', async () => {
		const { m, simulator } = createScenarioSimulator();
		const initial = await commandBus.dispatch('report.get', { source: 'script', simulator });
		expect(initial.data).toMatchObject({
			roadFundingPercent: 100, policeFundingPercent: 100, fireFundingPercent: 100,
			roadEffect: 32, policeEffect: 1000, fireEffect: 1000, crimeAverage: 42, roadTotal: 1234,
		});
		await commandBus.dispatch('budget.set-funding', {
			source: 'script', simulator, args: { road: 100, police: 70, fire: 0 },
		});
		// Represent later engine budget adjustments, not the originally requested values.
		m.policePercent = 0.405;
		m.roadEffect = 20;
		m.policeEffect = 405;
		m.fireEffect = 0;
		m.crimeAverage = 80;
		m.roadTotal = 1200;
		const report = await commandBus.dispatch('report.get', { source: 'script', simulator });
		expect(report.data).toMatchObject({
			roadFundingPercent: 100, policeFundingPercent: 40.5, fireFundingPercent: 0,
			roadEffect: 20, policeEffect: 405, fireEffect: 0, crimeAverage: 80, roadTotal: 1200,
		});
		expect((await commandBus.dispatch('report.get', {
			source: 'script', simulator, args: { serviceEffects: true },
		})).data).toEqual(report.data);
	});

	it('validates every required funding percentage before changing anything', async () => {
		const { m, simulator } = createScenarioSimulator();
		for (const key of ['road', 'police', 'fire']) {
			for (const value of [undefined, '50', -1, 101, NaN, Infinity, -Infinity]) {
				const args = { road: 100, police: 100, fire: 100, [key]: value };
				expect((await commandBus.dispatch('budget.set-funding', { source: 'script', simulator, args })).handled).toBe(false);
			}
		}
		expect(m.setServiceFunding).not.toHaveBeenCalled();
	});

	it.each(['tax.set', 'city.set-tax'])('keeps %s aliases, validation and settings results identical', async (id) => {
		const { m, simulator } = createScenarioSimulator();
		const syncPowerState = vi.fn();
		for (const rate of [0, 20]) {
			const result = await commandBus.dispatch(id, { source: 'script', simulator, syncPowerState, args: { rate } });
			expect(result.data).toEqual({ built: 0, cost: 0, rate });
		}
		for (const rate of [undefined, '7', -1, 21, 0.5, NaN, Infinity]) {
			expect((await commandBus.dispatch(id, { source: 'script', simulator, args: { rate } })).handled).toBe(false);
		}
		expect(m.setCityTax).toHaveBeenCalledTimes(2);
		expect(syncPowerState).toHaveBeenCalledTimes(2);
	});

	it('seeds treasury through setFunds and validates the signed engine integer range', async () => {
		const { m, simulator } = createScenarioSimulator();
		for (const amount of [0, 2147483647]) {
			const result = await commandBus.dispatch('treasury.set', { source: 'script', simulator, args: { amount } });
			expect(result.data).toEqual({ built: 0, cost: 0, totalFunds: amount });
		}
		for (const amount of [undefined, '100', -1, 0.5, 2147483648, NaN, Infinity]) {
			expect((await commandBus.dispatch('treasury.set', { source: 'script', simulator, args: { amount } })).handled).toBe(false);
		}
		expect(m.setFunds).toHaveBeenCalledTimes(2);
	});

	it('warms up using exactly the requested ticks and restores execution settings', async () => {
		const { m, simulator, clock } = createScenarioSimulator();
		const result = await commandBus.dispatch('sim.advance-ticks', { source: 'script', simulator, args: { ticks: 25 } });
		expect(m.simTick).toHaveBeenCalledTimes(25);
		expect(result.data).toEqual({ ticksAdvanced: 25, cityTime: 2, year: 1900 });
		expect(m.simSpeed).toBe(1);
		expect(m.simPasses).toBe(3);
		expect(clock.framesPerSecond).toBe(30);
		expect(clock.setFramesPerSecond.mock.calls).toEqual([[0], [30]]);
	});

	it('rejects invalid tick counts and treats zero ticks as a no-op', async () => {
		const { m, simulator } = createScenarioSimulator();
		for (const ticks of [undefined, '1', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expect((await commandBus.dispatch('sim.advance-ticks', { source: 'script', simulator, args: { ticks } })).handled).toBe(false);
		}
		expect((await commandBus.dispatch('sim.advance-ticks', { source: 'script', simulator, args: { ticks: 0 } })).data)
			.toEqual({ ticksAdvanced: 0, cityTime: 0, year: 1900 });
		expect(m.simTick).not.toHaveBeenCalled();
	});

	it('finishes monthly census through phase 9 without starting another cityTime', async () => {
		const { m, simulator, clock } = createScenarioSimulator();
		const result = await commandBus.dispatch('sim.advance', { source: 'script', simulator, args: { months: 1 } });
		expect(result.data).toEqual({ monthsAdvanced: 1, cityTime: 4, year: 1900 });
		expect(m.phaseCycle).toBe(10);
		expect(m.simTick).toHaveBeenCalledTimes(58);
		expect(m.simSpeed).toBe(1);
		expect(m.simPasses).toBe(3);
		expect(clock.framesPerSecond).toBe(30);
	});

	it('does not finish a partial census for a zero-month request', async () => {
		const { m, simulator } = createScenarioSimulator();
		m.phaseCycle = 1;
		expect((await commandBus.dispatch('sim.advance', { source: 'script', simulator, args: { months: 0 } })).handled).toBe(true);
		expect(m.simTick).not.toHaveBeenCalled();
		expect(m.phaseCycle).toBe(1);
	});

	it('preserves cityTime-only advancement when phaseCycle is unavailable', async () => {
		const { m, simulator } = createScenarioSimulator();
		Reflect.deleteProperty(m, 'phaseCycle');
		m.simTick.mockImplementation(() => { m.cityTime++; });
		const result = await commandBus.dispatch('sim.advance', { source: 'script', simulator, args: { months: 1 } });
		expect(result.data).toEqual({ monthsAdvanced: 1, cityTime: 4, year: 1900 });
		expect(m.simTick).toHaveBeenCalledTimes(4);
	});

	it('fails and restores settings when month advancement stalls', async () => {
		const { m, simulator, clock } = createScenarioSimulator();
		m.simTick.mockImplementation(() => {});
		const result = await commandBus.dispatch('sim.advance', { source: 'script', simulator, args: { months: 1 } });
		expect(result.handled).toBe(false);
		expect(m.simSpeed).toBe(1);
		expect(m.simPasses).toBe(3);
		expect(clock.framesPerSecond).toBe(30);
	});

	it.each(['sim.advance', 'sim.advance-ticks'])('restores settings if %s throws', async (id) => {
		const { m, simulator, clock } = createScenarioSimulator();
		m.simTick.mockImplementation(() => { throw new Error('tick failed'); });
		await expect(commandBus.dispatch(id, { source: 'script', simulator, args: { months: 1, ticks: 1 } })).rejects.toThrow('tick failed');
		expect(m.simSpeed).toBe(1);
		expect(m.simPasses).toBe(3);
		expect(clock.framesPerSecond).toBe(30);
	});

	it('reports signed net population change and engine AI zone count, without retiring engine fields', async () => {
		const { m, simulator } = createScenarioSimulator();
		const result = await commandBus.dispatch('report.get', { source: 'script', simulator });
		expect(result.data).toEqual(numericReport(m as unknown as Micropolis));
		expect(result.data).toMatchObject({ netResPopChange: -20, aiZoneCount: 12 });
		expect(result.data).not.toHaveProperty('gainedResPop');
		expect(result.data).not.toHaveProperty('lostToDemand');
		expect(m.gainedResPop).toBe(50);
		expect(m.lostToDemand).toBe(70);
	});

	it.each([
		['build.residential', 'autoBuild', { count: 1 }],
		['budget.set-funding', 'setServiceFunding', { road: 100, police: 100, fire: 100 }],
		['report.get', 'getAiZoneCount', {}],
	] as const)('fails clearly when %s needs an unavailable binding', async (id, binding, args) => {
		const { m, simulator } = createScenarioSimulator();
		Reflect.deleteProperty(m, binding);
		const result = await commandBus.dispatch(id, { source: 'script', simulator, args });
		expect(result.handled).toBe(false);
		expect(result.message).toContain(binding);
	});
});
