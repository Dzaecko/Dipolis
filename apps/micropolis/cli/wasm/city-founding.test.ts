import { describe, expect, it } from 'vitest';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';
import coexistence from '../../src/lib/params/koexistenz.json';
import classic from '../../src/lib/params/classic.json';

type ZoneKind = 'human' | 'ai' | 'commercial' | 'industrial' | 'farm';
type CityScript = { name: string; zones: ZoneKind[] };
type Zone = { kind: ZoneKind; x: number; y: number };
type CitySample = {
	tick: number;
	resPop: number;
	aiPop: number;
	totalFunds: number;
	foodCoverage: number;
	foodImportCost: number;
	hungryZoneCount: number;
	aiTaxFund: number;
	cashFlow: number;
	reservePercent: number;
	unpoweredZoneCount: number;
	comPop: number;
	indPop: number;
	resValve: number;
	comValve: number;
	indValve: number;
	taxFund: number;
	roadFund: number;
	powerCapacity: number;
	powerDemand: number;
	aiCoverage: number;
	aiValve: number;
};

const coalPlantX = 8;

const scripts: CityScript[] = [
	{
		name: 'nur Menschen',
		zones: [
			...Array<ZoneKind>(12).fill('human'),
			...Array<ZoneKind>(4).fill('commercial'),
			...Array<ZoneKind>(4).fill('industrial'),
			...Array<ZoneKind>(3).fill('farm'),
		],
	},
	{ name: 'nur KIs', zones: Array<ZoneKind>(12).fill('ai') },
	{
		name: 'gemischt',
		zones: [
			...Array<ZoneKind>(6).fill('human'),
			...Array<ZoneKind>(6).fill('ai'),
			...Array<ZoneKind>(2).fill('commercial'),
			...Array<ZoneKind>(2).fill('industrial'),
			...Array<ZoneKind>(2).fill('farm'),
		],
	},
];

function tool(
	engine: MainModule,
	sim: Micropolis,
	name: string,
	x: number,
	y: number,
): void {
	const result = sim.doTool(engine.EditingTool[name as keyof MainModule['EditingTool']], x, y);
	expect(result.value, `${name} at (${x}, ${y}); funds=${sim.totalFunds}`).toBe(engine.ToolResult.TOOLRESULT_OK.value);
}

function zoneLayout(script: CityScript): Zone[] {
	const categoryIndex = new Map<ZoneKind, number>();
	let residentialIndex = 0;
	return script.zones.map((kind) => {
		let x: number;
		let y: number;
		if (kind === 'human' || kind === 'ai') {
			const index = residentialIndex++;
			x = 26 + (index % 4) * 3;
			y = 24 + Math.floor(index / 4) * 3;
		} else {
			const index = categoryIndex.get(kind) ?? 0;
			categoryIndex.set(kind, index + 1);
			if (kind === 'commercial') {
				x = 60 + (index % 2) * 3;
				y = 24 + Math.floor(index / 2) * 3;
			} else if (kind === 'industrial') {
				x = 60 + (index % 2) * 3;
				y = 56 + Math.floor(index / 2) * 3;
			} else {
				x = 83 + index * 3;
				y = 56;
			}
		}
		return { kind, x, y };
	});
}

function buildInfrastructure(engine: MainModule, sim: Micropolis, zones: Zone[]): void {
	const plantX = coalPlantX;
	const lastX = Math.max(...zones.map(({ x }) => x + 1));
	const wireTiles = new Set<string>();
	const roadTiles = new Set<string>();
	const placeUnique = (kind: 'wire' | 'road', x: number, y: number): void => {
		const key = `${x},${y}`;
		const tiles = kind === 'wire' ? wireTiles : roadTiles;
		if (tiles.has(key)) return;
		tiles.add(key);
		tool(engine, sim, kind === 'wire' ? 'TOOL_WIRE' : 'TOOL_ROAD', x, y);
	};

	// Power follows the lower zone edges; residential blocks are packed without internal roads.
	const powerRows = [...new Set(zones.map(({ y }) => y + 2))].sort((a, b) => a - b);
	const firstPowerRow = Math.min(50, ...powerRows);
	const lastPowerRow = Math.max(50, ...powerRows);
	for (let y = firstPowerRow; y <= lastPowerRow; y += 1) placeUnique('wire', plantX + 4, y);
	placeUnique('wire', plantX + 3, 50);
	for (const busY of powerRows) {
		const rowZones = zones.filter(({ y }) => y + 2 === busY);
		for (let x = plantX + 5; x <= Math.max(...rowZones.map(({ x }) => x + 1)); x += 1) placeUnique('wire', x, busY);
	}

	// Join an outside arterial to compact zone-block perimeters; keep streets out of residential blocks.
	for (let y = 22; y <= 54; y += 1) placeUnique('road', 15, y);
	for (let x = 11; x <= 15; x += 1) placeUnique('road', x, 54);
	const blockGroups = new Map<string, Zone[]>();
	for (const zone of zones) {
		const key = zone.kind === 'human' || zone.kind === 'ai' ? 'residential' : zone.kind;
		const group = blockGroups.get(key) ?? [];
		group.push(zone);
		blockGroups.set(key, group);
	}
	for (const group of blockGroups.values()) {
		const minX = Math.min(...group.map(({ x }) => x));
		const maxX = Math.max(...group.map(({ x }) => x));
		const minY = Math.min(...group.map(({ y }) => y));
		const maxY = Math.max(...group.map(({ y }) => y));
		const roadY = minY - 2;
		for (let x = 15; x <= maxX + 1; x += 1) placeUnique('road', x, roadY);
		for (let y = roadY; y <= maxY + 1; y += 1) {
			placeUnique('road', minX - 2, y);
			placeUnique('road', maxX + 2, y);
		}
	}
}

async function runFoundingScript(script: CityScript, profile: Record<string, number> = coexistence): Promise<CitySample[]> {
	const engine = await loadMicropolisMainModule();
	const sim = new engine.Micropolis();
	const callback = createNoopJsCallback(engine);
	sim.setFixedSeed(42);
	sim.setCallback(callback, {});
	sim.init();
	try {
		sim.setEnableDisasters(false);
		sim.generateSomeRandomCity();
		sim.clearMap();
		sim.setFunds(20_000);
		for (const [name, value] of Object.entries(profile)) {
			expect(sim.setParam(name, value)).toBe(true);
		}
		expect(sim.setParam('powerPriority', 0)).toBe(true);
		expect(sim.getParam('foodImportEnabled')).toBe(profile.foodImportEnabled ?? 0);
		sim.setCityTax(7);
		sim.setSpeed(3);
		sim.setPasses(1);

		const zones = zoneLayout(script);
		tool(engine, sim, 'TOOL_COALPOWER', coalPlantX, 50);
		buildInfrastructure(engine, sim, zones);

		for (const { kind, x, y } of zones) {
			switch (kind) {
				case 'human':
					tool(engine, sim, 'TOOL_RESIDENTIAL', x, y);
					break;
				case 'ai':
					expect(sim.buildOwnedResidential(x, y, 2).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
					break;
				case 'commercial':
					tool(engine, sim, 'TOOL_COMMERCIAL', x, y);
					break;
				case 'industrial':
					tool(engine, sim, 'TOOL_INDUSTRIAL', x, y);
					break;
				case 'farm':
					expect(sim.buildFarm(x, y).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
					break;
			}
		}

		const timeline: CitySample[] = [];
		for (let tick = 1; tick <= 40_000; tick += 1) {
			sim.simTick();
			if (tick % 8_000 === 0) {
				timeline.push({
					tick,
					resPop: sim.resPop,
					aiPop: sim.aiPop,
					totalFunds: sim.totalFunds,
					foodCoverage: sim.foodCoverage,
					foodImportCost: sim.foodImportCost,
					hungryZoneCount: sim.hungryZoneCount,
					aiTaxFund: sim.aiTaxFund,
					cashFlow: sim.cashFlow,
					reservePercent: sim.powerReserve * 100,
					unpoweredZoneCount: sim.unpoweredZoneCount,
					comPop: sim.comPop,
					indPop: sim.indPop,
					resValve: sim.resValve,
					comValve: sim.comValve,
					indValve: sim.indValve,
					taxFund: sim.taxFund,
					roadFund: sim.roadFund,
					powerCapacity: sim.powerCapacity,
					powerDemand: sim.powerDemand,
					aiCoverage: sim.aiCoverage,
					aiValve: sim.aiValve,
				});
			}
		}
		return timeline;
	} finally {
		sim.delete();
	}
}

describe('deterministic city founding on empty land', () => {
	for (const script of scripts) {
		it(`${script.name}: builds at tick 0 and repeats all 40000 ticks`, async () => {
			const first = await runFoundingScript(script);
			const second = await runFoundingScript(script);
			expect(first).toHaveLength(5);
			expect(second).toEqual(first);
			console.log(script.name);
			console.table(first.map(({ tick, resPop, aiPop, totalFunds, foodCoverage, foodImportCost, hungryZoneCount, aiTaxFund, cashFlow, reservePercent, unpoweredZoneCount }) => ({
				tick, resPop, aiPop, totalFunds, foodCoverage, foodImportCost, hungryZoneCount, aiTaxFund, cashFlow,
				reservePercent: Number(reservePercent.toFixed(1)), unpoweredZoneCount,
			})));
			if (script.name === 'nur KIs') {
				expect(first.every((sample) => sample.unpoweredZoneCount === 0)).toBe(true);
				expect(first.every((sample) => sample.aiTaxFund > 0)).toBe(true);
				expect(first.at(-1)!.totalFunds).toBeGreaterThan(first[0]!.totalFunds);
			}
		}, 180_000);
	}

	it('compares the human-only founding script under classic and koexistenz finance rules', async () => {
		const humanScript = scripts[0]!;
		for (const [profileName, profile] of [['classic', classic], ['koexistenz', coexistence]] as const) {
			const first = await runFoundingScript(humanScript, profile);
			const second = await runFoundingScript(humanScript, profile);
			expect(second).toEqual(first);
			if (profileName === 'classic') expect(first.at(-1)!.resPop).toBeGreaterThanOrEqual(250);
			console.log(`nur Menschen / ${profileName} — Finanzen`);
			console.table(first.map(({ tick, resPop, comPop, indPop, resValve, comValve, indValve, taxFund, roadFund, cashFlow, totalFunds }) => ({
				tick, resPop, comPop, indPop, resValve, comValve, indValve, taxFund, roadFund, cashFlow, totalFunds,
			})));
		}
	}, 180_000);
});
