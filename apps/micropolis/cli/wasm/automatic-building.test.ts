import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

type BuildResult = { requested: number; built: number; cost: number; totalFunds: number };
type Snapshot = { tiles: Uint16Array; owners: Uint8Array; funds: number; resPop: number; aiZones: number };
type City = { engine: MainModule; sim: Micropolis; dispatch: (id: string, args?: Record<string, unknown>) => Promise<unknown> };

registerMicropolisCommands();

async function withCity<T>(run: (city: City) => Promise<T>, emptyLand = false): Promise<T> {
	const engine = await loadMicropolisMainModule();
	const sim = new engine.Micropolis();
	try {
		// Only callback lifetime is outside the scenario command.
		sim.setCallback(createNoopJsCallback(engine), {});
		expect(typeof sim.autoBuild).toBe('function'); // Use the generated binding, not a mock or cast.
		const simulator = { micropolis: sim, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
		const dispatch: City['dispatch'] = async (id, args) => {
			const result = await commandBus.dispatch(id, { source: 'script', simulator, args });
			expect(result.handled, `${id}: ${result.message}`).not.toBe(false);
			return result.data;
		};
		expect(await dispatch('scenario.start', {
			city: 'haight', profile: 'koexistenz', seed: 42, disasters: false, speed: 3,
		})).toMatchObject({ seed: 42, speed: 3, passes: 1 });
		if (emptyLand) setupEmptyLand(engine, sim);
		await dispatch('tax.set', { rate: 7 });
		await dispatch('food.set-import', { enabled: true });
		await dispatch('power.set-priority', { priority: 0 });
		const ticks = emptyLand ? 256 : 12_000;
		expect(await dispatch('sim.advance-ticks', { ticks })).toMatchObject({ ticksAdvanced: ticks });
		if (emptyLand) {
			// Install the protected human fixture after the power scan; no growth/decline
			// ticks may erase the house before the construction preservation assertion.
			expect(sim.buildOwnedResidential(26, 24, 1).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			sim.setTile(25, 23, engine.Tiles.LHTHR.value | engine.MapTileBits.BURNBIT.value | engine.MapTileBits.BULLBIT.value);
		}
		await dispatch('treasury.set', { amount: 60_000 });
		return await run({ engine, sim, dispatch });
	} finally {
		sim.delete();
	}
}

function setupEmptyLand(engine: MainModule, sim: Micropolis): void {
	// Dedicated founding fixture, never clear or engineer the settled Haight test map.
	// Use the same engine tools and coal coordinates as city-founding.test.ts.
	sim.clearMap();
	sim.setFunds(60_000);
	const tool = (name: keyof MainModule['EditingTool'], x: number, y: number) => {
		expect(sim.doTool(engine.EditingTool[name], x, y).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
	};
	tool('TOOL_COALPOWER', 8, 50);
	for (let x = 11; x <= 40; x++) tool('TOOL_WIRE', x, 50);
	for (let x = 11; x <= 40; x++) tool('TOOL_ROAD', x, 54);
}

function snapshot({ engine, sim }: City): Snapshot {
	// Copy views: construction can grow WASM memory and must not mutate the before image.
	return {
		tiles: new Uint16Array(engine.wasmMemory.buffer, sim.getMapAddress(), sim.getMapSize() / 2).slice(),
		owners: new Uint8Array(engine.wasmMemory.buffer, sim.getOwnerMapAddress(), sim.getOwnerMapSize()).slice(),
		funds: sim.totalFunds,
		resPop: sim.resPop,
		aiZones: sim.getAiZoneCount(),
	};
}

function checksum(tiles: Uint16Array): string {
	return createHash('sha256').update(new Uint8Array(tiles.buffer, tiles.byteOffset, tiles.byteLength)).digest('hex');
}

function geometry(engine: MainModule) {
	const { WORLD_W: width, WORLD_H: height, MapTileBits: bits, Tiles: tiles } = engine;
	const index = (x: number, y: number) => x * height + y;
	const tile = (value: number) => value & bits.LOMASK.value;
	const neighbors = (id: number) => {
		const x = Math.floor(id / height), y = id % height;
		return [[x - 1, y], [x, y - 1], [x, y + 1], [x + 1, y]]
			.filter(([nx, ny]) => nx! >= 0 && nx! < width && ny! >= 0 && ny! < height)
			.map(([nx, ny]) => index(nx!, ny!));
	};
	const road = (value: number) => tile(value) >= tiles.ROADBASE.value && tile(value) < tiles.POWERBASE.value;
	const conductor = (value: number) => (value & bits.CONDBIT.value) !== 0;
	const free = (value: number) => !(value & (bits.ZONEBIT.value | bits.CONDBIT.value)) &&
		(tile(value) === tiles.DIRT.value || (tile(value) >= tiles.TREEBASE.value && tile(value) <= tiles.LASTTREE.value));
	const perimeter = (center: number, size: number) => {
		const x = Math.floor(center / height) - 1, y = center % height - 1;
		const edge: number[] = [];
		for (let offset = 0; offset < size; offset++) {
			for (const [px, py] of [[x - 1, y + offset], [x + size, y + offset], [x + offset, y - 1], [x + offset, y + size]]) {
				if (px! >= 0 && px! < width && py! >= 0 && py! < height) edge.push(index(px!, py!));
			}
		}
		return edge;
	};
	return { width, height, bits, tiles, index, tile, neighbors, road, conductor, free, perimeter };
}

function connectedTo(engine: MainModule, map: Uint16Array, seeds: number[], accepts: (value: number) => boolean): Set<number> {
	const { neighbors } = geometry(engine);
	const seen = new Set(seeds);
	const queue = [...seen];
	for (let head = 0; head < queue.length; head++) {
		for (const id of neighbors(queue[head]!)) {
			if (!seen.has(id) && accepts(map[id]!)) { seen.add(id); queue.push(id); }
		}
	}
	return seen;
}

function isVacant(engine: MainModule, before: Snapshot, center: number): boolean {
	const { tile, bits, tiles, height } = geometry(engine);
	if (!(before.tiles[center]! & bits.ZONEBIT.value) || tile(before.tiles[center]!) !== tiles.FREEZ.value || before.owners[center] !== 0) return false;
	// FREEZ can contain human houses: only the exact empty 3x3 tile sequence is reusable.
	const x = Math.floor(center / height) - 1, y = center % height - 1;
	for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
		if (tile(before.tiles[(x + dx) * height + y + dy]!) !== tiles.RESBASE.value + dy * 3 + dx) return false;
	}
	return true;
}

// Independent availability check: search outward from free footprints, excluding the footprint.
// It does not call placement tools or autoBuild, and cannot make a failed build pass by assumption.
function hasAvailableLot(engine: MainModule, before: Snapshot, size: number): boolean {
	const g = geometry(engine);
	const powered = connectedTo(engine, before.tiles, [...before.tiles.keys()].filter((id) =>
		g.conductor(before.tiles[id]!) && (before.tiles[id]! & g.bits.PWRBIT.value)), g.conductor);
	for (let x = 0; x + size <= g.width; x++) for (let y = 0; y + size <= g.height; y++) {
		const center = g.index(x + 1, y + 1);
		const vacant = size === 3 && isVacant(engine, before, center);
		const footprint = new Set<number>();
		for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) footprint.add(g.index(x + dx, y + dy));
		if (!vacant && [...footprint].some((id) => !g.free(before.tiles[id]!))) continue;
		const route = (power: boolean) => {
			const queue = g.perimeter(center, size).map((id) => ({ id, distance: 0 }));
			const seen = new Set(queue.map(({ id }) => id));
			for (let head = 0; head < queue.length; head++) {
				const { id, distance } = queue[head]!;
				const value = before.tiles[id]!;
				if (power ? powered.has(id) : g.road(value)) return true;
				const straightRoad = g.road(value) && [g.tiles.ROADS.value, g.tiles.ROADS2.value].includes((g.tile(value) & 15) + g.tiles.ROADBASE.value);
				if (distance >= 12 || !(power ? g.free(value) || g.conductor(value) || straightRoad : g.free(value) || g.road(value))) continue;
				for (const next of g.neighbors(id)) if (!footprint.has(next) && !seen.has(next)) {
					seen.add(next); queue.push({ id: next, distance: distance + 1 });
				}
			}
			return false;
		};
		if (route(false) && route(true)) return true;
	}
	return false;
}

function assertConstruction(city: City, before: Snapshot, result: BuildResult, size: number, owner?: number, centerTile?: number): Snapshot {
	const after = snapshot(city);
	const g = geometry(city.engine);
	expect(Number.isInteger(result.built)).toBe(true);
	expect(result.built).toBeGreaterThanOrEqual(0);
	expect(result.built).toBeLessThanOrEqual(result.requested);
	expect(result.cost).toBe(before.funds - after.funds);
	expect(result.totalFunds).toBe(after.funds);
	expect(after.funds).toBeGreaterThanOrEqual(0);
	expect(after.resPop).toBe(before.resPop); // No ticks between construction and this snapshot.
	const centers: number[] = [];
	for (let id = 0; id < before.tiles.length; id++) {
		const wasCenter = (before.tiles[id]! & g.bits.ZONEBIT.value) !== 0;
		const vacant = wasCenter && isVacant(city.engine, before, id);
		if (wasCenter && !vacant) {
			expect(after.tiles[id], `existing center ${id}`).toBe(before.tiles[id]);
			expect(after.owners[id], `existing owner ${id}`).toBe(before.owners[id]);
		}
		// Protect actual houses too, not merely the cached residential population.
		if (g.tile(before.tiles[id]!) >= g.tiles.LHTHR.value && g.tile(before.tiles[id]!) <= g.tiles.HHTHR.value) {
			expect(after.tiles[id], `human house ${id}`).toBe(before.tiles[id]);
		}
		if ((after.tiles[id]! & g.bits.ZONEBIT.value) && (!wasCenter ||
			(vacant && (after.tiles[id] !== before.tiles[id] || after.owners[id] !== before.owners[id])))) centers.push(id);
	}
	expect(centers).toHaveLength(result.built);
	if (owner !== undefined) {
		// Rebuilding a vacant human lot as human residential need not change its owner.
		const newlyOwned = centers.filter((id) => before.owners[id] !== owner).length;
		expect(after.owners.filter((value) => value === owner).length - before.owners.filter((value) => value === owner).length).toBe(newlyOwned);
	}
	const roads = connectedTo(city.engine, after.tiles, [...before.tiles.keys()].filter((id) => g.road(before.tiles[id]!)), g.road);
	const power = connectedTo(city.engine, after.tiles, [...before.tiles.keys()].filter((id) =>
		g.conductor(before.tiles[id]!) && (before.tiles[id]! & g.bits.PWRBIT.value)), g.conductor);
	for (const center of centers) {
		if (owner !== undefined) expect(after.owners[center]).toBe(owner);
		if (centerTile !== undefined) expect(g.tile(after.tiles[center]!)).toBe(centerTile);
		const vacant = size === 3 && isVacant(city.engine, before, center);
		const x = Math.floor(center / g.height) - 1, y = center % g.height - 1;
		for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) {
			expect(vacant || g.free(before.tiles[g.index(x + dx, y + dy)]!), `safe footprint for ${center}`).toBe(true);
		}
		const edges = g.perimeter(center, size);
		expect(edges.some((id) => roads.has(id)), `road route for ${center}`).toBe(true);
		expect(edges.some((id) => power.has(id)), `conductive route for ${center}`).toBe(true);
	}
	if (result.built === 0) {
		expect(result.cost).toBe(0);
		expect(checksum(after.tiles)).toBe(checksum(before.tiles));
		expect(after.owners).toEqual(before.owners);
	}
	return after;
}

describe('automatic building through the real WASM command bus', () => {
	it('rejects unsafe scenario presets and non-script callers without mutating the city', async () => {
		await withCity(async (city) => {
			const simulator = { micropolis: city.sim } as unknown as MicropolisSimulator;
			const preset = { city: 'haight', profile: 'koexistenz', seed: 42, disasters: false, speed: 3 };
			const before = snapshot(city);
			for (const patch of [
				{ city: '../haight' }, { profile: 'classic' }, { seed: 43 }, { seed: null },
				{ disasters: true }, { speed: 2 }, { path: '/cities/haight.cty' },
			]) {
				const result = await commandBus.dispatch('scenario.start', { source: 'script', simulator, args: { ...preset, ...patch } });
				expect(result.handled).toBe(false);
			}
			for (const source of ['llm', 'button', 'system']) {
				expect((await commandBus.dispatch('scenario.start', { source, simulator, args: preset })).handled).toBe(false);
			}
			expect(snapshot(city)).toEqual(before);
		});
	});

	it('builds up to 15 AI zones without evicting settled Haight humans', async () => {
		await withCity(async (city) => {
			const before = snapshot(city);
			expect(before.funds).toBe(60_000);
			expect(before.resPop).toBeGreaterThan(0);
			const result = await city.dispatch('build.ai-zones', { count: 15 }) as BuildResult;
			expect(result.requested).toBe(15);
			expect(result.built).toBeGreaterThan(0);
			expect(result.cost).toBeGreaterThanOrEqual(result.built * 100);
			const after = assertConstruction(city, before, result, 3, 2, city.engine.Tiles.FREEZ.value);
			expect(after.aiZones - before.aiZones).toBe(result.built);
		});
	});

	it.each([
		['build.residential', 1, 'FREEZ'],
		['build.farms', 3, 'INDCLR'],
	] as const)('%s succeeds when a connected 3x3 lot is available', async (id, owner, tile) => {
		await withCity(async (city) => {
			const before = snapshot(city);
			const available = hasAvailableLot(city.engine, before, 3);
			const result = await city.dispatch(id, { count: 5 }) as BuildResult;
			expect(result.requested).toBe(5);
			if (available) expect(result.built).toBeGreaterThan(0);
			else expect(result.built).toBe(0);
			expect(result.cost).toBeGreaterThanOrEqual(result.built * 100);
			assertConstruction(city, before, result, 3, owner, city.engine.Tiles[tile].value);
		});
	});

	it.each([['coal', 3000, 'POWERPLANT'], ['nuclear', 5000, 'NUCLEAR']] as const)(
		'builds a %s plant on an independently loaded city when a connected 4x4 lot exists', async (type, minimumCost, tile) => {
			await withCity(async (city) => {
				const before = snapshot(city);
				const available = hasAvailableLot(city.engine, before, 4);
				const result = await city.dispatch('build.power-plant', { type }) as BuildResult;
				expect(result.requested).toBe(1);
				expect(result.built).toBe(available ? 1 : 0);
				if (result.built) expect(result.cost).toBeGreaterThanOrEqual(minimumCost);
				else console.info(`Haight: no connected 4x4 terrain for ${type}; verified no-op`);
				assertConstruction(city, before, result, 4, undefined, city.engine.Tiles[tile].value);
			});
		},
	);

	it.each([['coal', 3000, 'POWERPLANT'], ['nuclear', 5000, 'NUCLEAR']] as const)(
		'builds a real %s plant on engineered empty land with road and powered wire access', async (type, minimumCost, tile) => {
			await withCity(async (city) => {
				const before = snapshot(city);
				const g = geometry(city.engine);
				expect(before.owners.some((owner) => owner === 1)).toBe(true);
				expect(before.tiles.some((value) => g.tile(value) >= g.tiles.LHTHR.value && g.tile(value) <= g.tiles.HHTHR.value)).toBe(true);
				expect(hasAvailableLot(city.engine, before, 4)).toBe(true);
				const result = await city.dispatch('build.power-plant', { type }) as BuildResult;
				expect(result.requested).toBe(1);
				expect(result.built).toBe(1);
				expect(result.cost).toBeGreaterThanOrEqual(minimumCost);
				assertConstruction(city, before, result, 4, undefined, city.engine.Tiles[tile].value);
			}, true);
		},
	);

	it('funding commands affect actual yearly spending and service effectiveness', async () => {
		const runFunding = (percent: number) => withCity(async (city) => {
			await city.dispatch('treasury.set', { amount: 1_000_000 });
			await city.dispatch('budget.set-funding', { road: percent, police: percent, fire: percent });
			await city.dispatch('sim.advance', { months: 12 });
			return await city.dispatch('report.get', { serviceEffects: true }) as Record<string, number>;
		});
		const full = await runFunding(100);
		const zero = await runFunding(0);
		expect(full.roadFund).toBeGreaterThan(0);
		expect(full.roadEffect).toBeGreaterThan(0);
		expect(zero.roadEffect).toBe(0);
		for (const service of ['police', 'fire']) {
			if (zero[`${service}Fund`]! > 0) expect(zero[`${service}Effect`]).toBe(0);
		}
		expect(zero.treasury).toBeGreaterThan(full.treasury);
	});

	it.each(['build.residential', 'build.ai-zones', 'build.farms'])('%s cannot spend or change any map tile with treasury 99', async (id) => {
		await withCity(async (city) => {
			await city.dispatch('treasury.set', { amount: 99 });
			const before = snapshot(city);
			const result = await city.dispatch(id, { count: 15 }) as BuildResult;
			expect(result).toEqual({ requested: 15, built: 0, cost: 0, totalFunds: 99 });
			assertConstruction(city, before, result, 3);
		});
	});

	it('reproduces the exact first single-zone cost with only that much treasury', async () => {
		const first = await withCity(async (city) => {
			const before = snapshot(city);
			const result = await city.dispatch('build.ai-zones', { count: 1 }) as BuildResult;
			expect(result.built).toBe(1);
			expect(result.cost).toBeGreaterThanOrEqual(100);
			const after = assertConstruction(city, before, result, 3, 2, city.engine.Tiles.FREEZ.value);
			return { cost: result.cost, map: checksum(after.tiles), owners: after.owners };
		});
		await withCity(async (city) => {
			await city.dispatch('treasury.set', { amount: first.cost });
			const before = snapshot(city);
			const result = await city.dispatch('build.ai-zones', { count: 1 }) as BuildResult;
			expect(result).toEqual({ requested: 1, built: 1, cost: first.cost, totalFunds: 0 });
			const after = assertConstruction(city, before, result, 3, 2, city.engine.Tiles.FREEZ.value);
			expect(checksum(after.tiles)).toBe(first.map);
			expect(after.owners).toEqual(first.owners);
		});
	});

	it('partially fulfills 100 AI zones with treasury 1000 and reports only actual spending', async () => {
		await withCity(async (city) => {
			await city.dispatch('treasury.set', { amount: 1000 });
			const before = snapshot(city);
			const result = await city.dispatch('build.ai-zones', { count: 100 }) as BuildResult;
			expect(result.requested).toBe(100);
			expect(result.built).toBeGreaterThan(0);
			expect(result.built).toBeLessThan(100);
			expect(result.built).toBeLessThanOrEqual(10);
			expect(result.cost).toBeGreaterThanOrEqual(result.built * 100);
			expect(result.cost).toBeLessThanOrEqual(1000);
			const after = assertConstruction(city, before, result, 3, 2, city.engine.Tiles.FREEZ.value);
			expect(after.aiZones - before.aiZones).toBe(result.built);
		});
	});
});