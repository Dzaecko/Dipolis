import { describe, expect, it } from 'vitest';
import { AI_TILESET, FARM_TILESET, HUMAN_TILESET, MicropolisSimulator } from './MicropolisSimulator';
import { createNoopJsCallback } from './wasm/callbacks';
import { loadMicropolisMainModule } from './wasm/node';

const centerIndex = (x: number, y: number, height: number) => x * height + y;

describe('Micropolis owner tileset synchronization', () => {
	it('colors all nine AI-zone tiles and restores the human tileset after demolition and map scan', async () => {
		const engine = await loadMicropolisMainModule();
		const micropolis = new engine.Micropolis();
		const callback = createNoopJsCallback(engine);
		micropolis.setCallback(callback, {});
		micropolis.init();

		const simulator = new MicropolisSimulator();
		simulator.micropolis = micropolis;
		simulator.micropolisengine = engine;

		try {
			micropolis.setFixedSeed(42);
			expect(micropolis.loadCity('/cities/haight.cty')).toBe(true);
			micropolis.clearMap();
			micropolis.setFunds(1_000_000);
			simulator.syncMapViews();
			simulator.syncOwnerToMop();

			const x = Math.floor(engine.WORLD_W / 2);
			const y = Math.floor(engine.WORLD_H / 2);
			const humanResult = micropolis.buildOwnedResidential(x - 10, y, 1);
			expect(humanResult.value).toBe(engine.ToolResult.TOOLRESULT_OK.value);

			const owners = new Uint8Array(
				engine.wasmMemory.buffer,
				micropolis.getOwnerMapAddress(),
				micropolis.getOwnerMapSize(),
			);
			expect(owners[centerIndex(x - 10, y, engine.WORLD_H)]).toBe(1);

			const aiResult = micropolis.buildOwnedResidential(x, y, 2);
			expect(aiResult.value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			const farmX = x + 10;
			const farmResult = micropolis.buildFarm(farmX, y);
			expect(farmResult.value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			expect(owners[centerIndex(farmX, y, engine.WORLD_H)]).toBe(3);
			simulator.syncMapViews();
			simulator.syncOwnerToMop();

			const mop = simulator.mopData!;
			for (let dx = -1; dx <= 1; dx += 1) {
				for (let dy = -1; dy <= 1; dy += 1) {
					expect(mop[centerIndex(x + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(AI_TILESET);
					expect(mop[centerIndex(farmX + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(FARM_TILESET);
				}
			}
			simulator.setHumanTileSet(2);
			simulator.syncOwnerToMop();
			for (let dx = -1; dx <= 1; dx += 1) {
				for (let dy = -1; dy <= 1; dy += 1) {
					expect(mop[centerIndex(x - 10 + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(2);
					expect(mop[centerIndex(x + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(AI_TILESET);
				}
			}
		simulator.setHumanTileSet(HUMAN_TILESET);
		simulator.syncOwnerToMop();

			expect(micropolis.doTool(engine.EditingTool.TOOL_BULLDOZER, x, y).value)
				.toBe(engine.ToolResult.TOOLRESULT_OK.value);
			for (let tick = 0; tick < 48; tick += 1) micropolis.simTick();
			expect(micropolis.checkOwnerInvariant()).toBe(0);
			simulator.syncMapViews();
			simulator.syncOwnerToMop();

			for (let dx = -1; dx <= 1; dx += 1) {
				for (let dy = -1; dy <= 1; dy += 1) {
					expect(mop[centerIndex(x + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(HUMAN_TILESET);
				}
			}
		} finally {
			micropolis.delete();
		}
	});
});
