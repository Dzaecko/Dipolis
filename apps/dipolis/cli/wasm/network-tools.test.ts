import { describe, expect, it } from 'vitest';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { advanceMonths } from '../../src/lib/city-run/advance';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { PROFILES } from '../../src/lib/params/profiles';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

type Connection = {
	cost: number;
	length: number;
	connected: boolean;
	failureReason?: 'no-route' | 'insufficient-funds';
};
type IslandDiagnostics = {
	islandId: number;
	zones: number;
	humanZones: number;
	aiZones: number;
	otherZones: number;
	unpoweredZones: number;
	physicalPoweredZones: number;
	connectionQuote: { cost: number; length: number } | null;
};
function diagnostics(m: Micropolis): IslandDiagnostics[] {
	return (JSON.parse(m.getNetworkDiagnosticsJSON()) as { islands: IslandDiagnostics[] }).islands;
}

let enginePromise: Promise<MainModule> | undefined;
async function city() {
	const e = await (enginePromise ??= loadMicropolisMainModule());
	const m = new e.Micropolis();
	m.setCallback(createNoopJsCallback(e), {});
	m.setFixedSeed(42);
	m.init();
	for (const [key, value] of Object.entries(PROFILES['v4-fraktion'])) m.setParam(key, value);
	m.setParam('foundingEnabled', 1);
	m.setEnableDisasters(false);
	m.clearMap();
	m.setFunds(1000000);
	return { e, m };
}
function snapshot(e: MainModule, m: Micropolis) {
	return {
		map: new Uint16Array(e.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2).slice(),
		owners: new Uint8Array(e.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize()).slice(),
		funds: m.totalFunds,
	};
}
function blockMap(e: MainModule, m: Micropolis) {
	for (let x = 0; x < e.WORLD_W; ++x)
		for (let y = 0; y < e.WORLD_H; ++y) m.setTile(x, y, e.Tiles.RADTILE.value);
}
function conductor(e: MainModule, m: Micropolis, x: number, y: number, plant = false) {
	m.setTile(x, y, (plant ? e.Tiles.POWERPLANT.value : e.Tiles.LHPOWER.value) |
		e.MapTileBits.CONDBIT.value | (plant ? e.MapTileBits.ZONEBIT.value : 0));
}
function connect(m: Micropolis, islandId: number): Connection {
	return JSON.parse(m.connectPowerIsland(islandId)) as Connection;
}
function waterCorridor(e: MainModule, m: Micropolis, vertical = false) {
	blockMap(e, m);
	const tile = (step: number, value: number) =>
		m.setTile(vertical ? 20 : step, vertical ? step : 20, value);
	conductor(e, m, vertical ? 20 : 10, vertical ? 10 : 20);
	conductor(e, m, vertical ? 20 : 18, vertical ? 18 : 20, true);
	tile(11, e.Tiles.DIRT.value);
	tile(12, e.Tiles.WOODS.value | e.MapTileBits.BULLBIT.value);
	for (let step = 13; step <= 15; ++step) tile(step, e.Tiles.RIVER.value);
	tile(16, vertical ? e.Tiles.ROADS2.value : e.Tiles.ROADS.value);
	tile(17, vertical ? e.Tiles.LVRAIL.value : e.Tiles.LHRAIL.value);
}
function islandAt(m: Micropolis, x: number, y: number, e: MainModule) {
	// IDs are snapshot-local coordinate-order labels, never persistent IDs.
	const ids = JSON.parse(m.getNetworkDiagnosticsJSON()) as {
		islands: { islandId: number }[];
	};
	let index = 0;
	for (let px = 0; px < e.WORLD_W; ++px)
		for (let py = 0; py < e.WORLD_H; ++py)
			if (m.getTile(px, py) & e.MapTileBits.CONDBIT.value) {
				if (px === x && py === y) return ids.islands[index]!.islandId;
				++index;
			}
	throw new Error('Fixture island not found');
}

describe('native physical-network repair tools', () => {
	it('counts residential ownership and physical outages, including zero-population zones, without mutation', async () => {
		const { e, m } = await city();
		try {
			blockMap(e, m);
			const bits = e.MapTileBits;
			for (const x of [10, 11, 12]) m.setTile(x, 20,
				e.Tiles.FREEZ.value | bits.CONDBIT.value | bits.ZONEBIT.value |
				(x === 10 ? bits.PWRBIT.value : 0));
			expect(m.setZoneOwner(10, 20, 1)).toBe(true);
			expect(m.setZoneOwner(11, 20, 2)).toBe(true);
			conductor(e, m, 13, 20, true);
			m.setTile(13, 20, m.getTile(13, 20) | bits.PWRBIT.value);
			conductor(e, m, 50, 20);
			const before = snapshot(e, m);
			expect(diagnostics(m)).toMatchObject([
				{ islandId: 0, zones: 4, humanZones: 2, aiZones: 1, otherZones: 1,
					physicalPoweredZones: 2, unpoweredZones: 2, connectionQuote: { cost: 0, length: 0 } },
				{ islandId: 1, zones: 0, humanZones: 0, aiZones: 0, otherZones: 0,
					physicalPoweredZones: 0, unpoweredZones: 0, connectionQuote: null },
			]);
			expect(snapshot(e, m)).toEqual(before);
			expect(diagnostics(m)).toEqual(diagnostics(m));
			expect(snapshot(e, m)).toEqual(before);
		} finally { m.delete(); }
	});

	it.each([false, true])('quotes the same native water route regardless of funds (vertical=%s)', async (vertical) => {
		const { e, m } = await city();
		try {
			waterCorridor(e, m, vertical);
			m.setFunds(0);
			const before = snapshot(e, m);
			const islands = diagnostics(m);
			expect(islands.map(island => island.islandId)).toEqual([0, 1]);
			expect(islands[0]!.connectionQuote).toEqual({ cost: 96, length: 8 });
			expect(islands[1]!.connectionQuote).toEqual({ cost: 0, length: 0 });
			expect(snapshot(e, m)).toEqual(before);
			expect(connect(m, 0)).toMatchObject({ ...islands[0]!.connectionQuote,
				connected: false, failureReason: 'insufficient-funds' });
			expect(snapshot(e, m)).toEqual(before);
			m.setFunds(96);
			expect(diagnostics(m)).toEqual(islands);
			expect(connect(m, 0)).toEqual({ ...islands[0]!.connectionQuote, connected: true });
		} finally { m.delete(); }
	});

	it.each([false, true])('lays a straight native water wire with exact clearing/road/rail costs (vertical=%s)', async (vertical) => {
		const { e, m } = await city();
		try {
			waterCorridor(e, m, vertical);
			const homeX = vertical ? 20 : 9, homeY = vertical ? 9 : 20;
			const plantX = vertical ? 20 : 18, plantY = vertical ? 18 : 20;
			m.setTile(plantX, plantY, m.getTile(plantX, plantY) | e.MapTileBits.PWRBIT.value);
			m.setTile(homeX, homeY, e.Tiles.FREEZ.value |
				e.MapTileBits.CONDBIT.value | e.MapTileBits.ZONEBIT.value);
			expect(m.setZoneOwner(homeX, homeY, 1)).toBe(true);
			expect(diagnostics(m)[0]).toMatchObject({ humanZones: 1, unpoweredZones: 1, physicalPoweredZones: 0 });
			m.setFunds(96);
			expect(connect(m, 0)).toEqual({ cost: 96, length: 8, connected: true });
			expect(m.totalFunds).toBe(0);
			for (let step = 13; step <= 15; ++step)
				expect(m.getTile(vertical ? 20 : step, vertical ? step : 20) & e.MapTileBits.LOMASK.value)
					.toBe(vertical ? e.Tiles.HPOWER.value : e.Tiles.VPOWER.value);
			expect(advanceMonths(m, 1)).toBe(true);
			const networkReport = JSON.parse(m.getNetworkDiagnosticsJSON());
			expect(networkReport.islands).toHaveLength(1);
			expect(networkReport.islands[0].capacity).toBeGreaterThan(0);
			expect(networkReport.islands[0]).toMatchObject({
				humanZones: 1, physicalPoweredZones: 1
			});
			expect(connect(m, 0)).toEqual({ cost: 0, length: 0, connected: true });
		} finally { m.delete(); }
	});

	it('returns a full quote on insufficient funds without changing any map/owners/funds', async () => {
		const { e, m } = await city();
		try {
			waterCorridor(e, m);
			m.setFunds(95);
			const before = snapshot(e, m);
			expect(connect(m, 0)).toEqual({ cost: 96, length: 8, connected: false, failureReason: 'insufficient-funds' });
			expect(snapshot(e, m)).toEqual(before);
			m.setFunds(96);
			expect(connect(m, 0).connected).toBe(true);
		} finally { m.delete(); }
	});

	it('chooses a longer cheap legal land route over a shorter costly water crossing', async () => {
		const { e, m } = await city();
		try {
			blockMap(e, m);
			conductor(e, m, 10, 20);
			conductor(e, m, 16, 20, true);
			for (let x = 11; x < 16; ++x) m.setTile(x, 20, e.Tiles.RIVER.value);
			for (let x = 10; x <= 16; ++x) m.setTile(x, 19, e.Tiles.DIRT.value);
			m.setFunds(35);
			const before = snapshot(e, m);
			expect(diagnostics(m)[0]!.connectionQuote).toEqual({ cost: 35, length: 8 });
			expect(snapshot(e, m)).toEqual(before);
			expect(connect(m, 0)).toEqual({ cost: 35, length: 8, connected: true });
			for (let x = 11; x < 16; ++x) expect(m.getTile(x, 20)).toBe(e.Tiles.RIVER.value);
		} finally { m.delete(); }
	});

	it('reports unknown islands and disconnected or water-turn-only routes atomically', async () => {
		const { e, m } = await city();
		try {
			blockMap(e, m);
			conductor(e, m, 10, 20);
			conductor(e, m, 12, 22, true);
			for (const [x, y] of [[11, 20], [12, 20], [12, 21]]) m.setTile(x!, y!, e.Tiles.RIVER.value);
			const before = snapshot(e, m);
			expect(diagnostics(m)[0]!.connectionQuote).toBeNull();
			expect(snapshot(e, m)).toEqual(before);
			for (const id of [-1, 99, 0]) {
				expect(connect(m, id)).toEqual({ cost: 0, length: 0, connected: false, failureReason: 'no-route' });
				expect(snapshot(e, m)).toEqual(before);
			}
			m.setTile(12, 22, e.Tiles.LHPOWER.value | e.MapTileBits.CONDBIT.value);
			const noGeneration = snapshot(e, m);
			expect(diagnostics(m).every(island => island.connectionQuote === null)).toBe(true);
			expect(connect(m, 0).failureReason).toBe('no-route');
			expect(snapshot(e, m)).toEqual(noGeneration);
		} finally { m.delete(); }
	});

	it('prefers a plant site by the chosen current island without changing default ties', async () => {
		const { e, m } = await city();
		let baseline: Micropolis | undefined;
		let preferred: Micropolis | undefined;
		try {
			blockMap(e, m);
			for (const left of [10, 70]) {
				for (let x = left; x <= left + 20; ++x)
					for (let y = 10; y <= 30; ++y) m.setTile(x, y, e.Tiles.DIRT.value);
				for (let x = left; x <= left + 20; ++x) m.setTile(x, 30, e.Tiles.ROADS.value);
				conductor(e, m, left + 10, 25);
			}
			const right = islandAt(m, 80, 25, e);
			baseline = m.clone();
			preferred = m.clone();
			expect(m.autoBuild(3, 1)).toBe(1);
			expect(baseline.autoBuildNearIsland(3, 1, -1)).toBe(1);
			expect(snapshot(e, baseline)).toEqual(snapshot(e, m));
			expect(preferred.autoBuildNearIsland(3, 1, right)).toBe(1);
			const centers = (sim: Micropolis) => {
				const found: number[] = [];
				for (let x = 0; x < e.WORLD_W; ++x)
					for (let y = 0; y < e.WORLD_H; ++y)
						if ((sim.getTile(x, y) & e.MapTileBits.LOMASK.value) === e.Tiles.POWERPLANT.value &&
							(sim.getTile(x, y) & e.MapTileBits.ZONEBIT.value)) found.push(x);
				return found;
			};
			expect(centers(m)[0]).toBeLessThan(40);
			expect(centers(preferred)[0]).toBeGreaterThan(60);
			const before = snapshot(e, preferred);
			expect(preferred.autoBuildNearIsland(3, 1, 999)).toBe(0);
			expect(preferred.autoBuildFailure).toBe(2);
			expect(snapshot(e, preferred)).toEqual(before);
			baseline.setFunds(0);
			const unfunded = snapshot(e, baseline);
			expect(baseline.autoBuildNearIsland(3, 1, 0)).toBe(0);
			expect(baseline.autoBuildFailure).toBe(1);
			expect(snapshot(e, baseline)).toEqual(unfunded);
		} finally { preferred?.delete(); baseline?.delete(); m.delete(); }
	});
});
