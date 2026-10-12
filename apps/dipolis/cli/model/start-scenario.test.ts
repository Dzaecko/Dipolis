import { describe, expect, it } from 'vitest';
import { setupScenario } from '../../src/lib/city-run/replay';
import { readProtocol } from '../../src/lib/city-run/protocol';
import { createCitySession } from './city-session';

async function startMap(start: { startMap: 'haight' | 'natural'; seed: number }) {
	const session = await createCitySession();
	try {
		await setupScenario(session.dispatch, start);
		const { engine, micropolis } = session;
		const tiles = new Uint16Array(engine.wasmMemory.buffer, micropolis.getMapAddress(), micropolis.getMapSize() / 2);
		const rawTiles = Array.from(tiles, (tile) => tile & engine.MapTileBits.LOMASK.value);
		const owners = new Uint8Array(engine.wasmMemory.buffer, micropolis.getOwnerMapAddress(), micropolis.getOwnerMapSize());
		return {
			rawTiles,
			owners: Array.from(owners),
			treeCount: rawTiles.filter((tile) => tile >= engine.Tiles.TREEBASE.value && tile <= engine.Tiles.WOODS_HIGH.value).length,
			waterCount: rawTiles.filter((tile) => tile >= engine.Tiles.WATER_LOW.value && tile <= engine.Tiles.WATER_HIGH.value).length,
			aiZones: micropolis.getAiZoneCount(),
			treasury: micropolis.totalFunds
		};
	} finally {
		session.close();
	}
}

describe('natural city start', () => {
	it('starts with reproducible water and trees and no built city zones', async () => {
		const first = await startMap({ startMap: 'natural', seed: 42 });
		const replaySettings = readProtocol(JSON.stringify({
			event: 'run-started', assignment: 'N', model: 'm', handbook: 'off', run: 1,
			startMap: 'natural', seed: 42
		})).meta;
		const second = await startMap({ startMap: replaySettings.startMap, seed: replaySettings.seed });
		expect(first).toEqual(second);
		expect(first.treeCount).toBeGreaterThan(0);
		expect(first.waterCount).toBeGreaterThan(0);
		expect(first.aiZones).toBe(0);
		expect(first.owners.every((owner) => owner === 0)).toBe(true);
		expect(first.rawTiles.every((tile) => tile < 64)).toBe(true);
		expect(first.treasury).toBe(60_000);
	}, 120_000);

	it('changes the generated terrain when the recorded seed changes', async () => {
		const first = await startMap({ startMap: 'natural', seed: 42 });
		const second = await startMap({ startMap: 'natural', seed: 43 });
		expect(second.rawTiles).not.toEqual(first.rawTiles);
	}, 120_000);
});
