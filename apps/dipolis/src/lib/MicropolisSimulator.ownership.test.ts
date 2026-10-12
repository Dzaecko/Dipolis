import { describe, expect, it } from 'vitest';
import { AI_TILESET, AI_BIO_TILESET, FARM_TILESET, BIO_TILESET, HUMAN_TILESET, MICROPOLIS_TILESET_COUNT, MicropolisSimulator } from './MicropolisSimulator';
import { createNoopJsCallback } from './wasm/callbacks';
import { loadMicropolisMainModule } from './wasm/node';

const centerIndex = (x: number, y: number, height: number) => x * height + y;

describe('Micropolis owner tileset synchronization', () => {
	it('distinguishes AI-owned pods from administrative pods across their entire footprint', () => {
		const width = 12, height = 6, memory = new ArrayBuffer(width * height), owners = new Uint8Array(memory);
		const simulator = new MicropolisSimulator();
		simulator.micropolisengine = {
			WORLD_W: width, WORLD_H: height, wasmMemory: { buffer: memory },
			MapTileBits: { ZONEBIT: { value: 0x400 }, LOMASK: { value: 0x3ff } },
			Tiles: { HOSPITAL: { value: 409 }, INDCLR: { value: 616 }, IZB: { value: 625 } },
		} as unknown as NonNullable<MicropolisSimulator['micropolisengine']>;
		simulator.micropolis = {
			getOwnerMapAddress: () => 0, getOwnerMapSize: () => owners.length,
		} as unknown as NonNullable<MicropolisSimulator['micropolis']>;
		simulator.mapData = new Uint16Array(width * height);
		simulator.mopData = new Uint16Array(width * height).fill(0x1200);
		for (const [x, owner] of [[2, 4], [7, 5]]) {
			simulator.mapData[centerIndex(x, 2, height)] = 616 | 0x400;
			owners[centerIndex(x, 2, height)] = owner;
		}
		simulator.syncOwnerToMop();
		expect(AI_BIO_TILESET).not.toBe(BIO_TILESET);
		expect(MICROPOLIS_TILESET_COUNT).toBeGreaterThan(AI_BIO_TILESET);
		simulator.setHumanTileSet(AI_BIO_TILESET);
		expect(simulator.humanTileSet).not.toBe(AI_BIO_TILESET);
		for (const [x, tileset] of [[2, BIO_TILESET], [7, AI_BIO_TILESET]])
			for (let dx = -1; dx <= 1; ++dx) for (let dy = -1; dy <= 1; ++dy)
				expect(simulator.mopData[centerIndex(x + dx, 2 + dy, height)]).toBe(0x1200 | tileset);
		owners[centerIndex(7, 2, height)] = 0;
		simulator.syncOwnerToMop();
		expect(simulator.mopData[centerIndex(7, 2, height)] & 0xff).toBe(HUMAN_TILESET);
	});

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
			micropolis.setParam('podsEnabled', 1);
			const bioX = x + 20;
			expect(micropolis.buildFarm(bioX, y).value).toBe(engine.ToolResult.TOOLRESULT_OK.value);
			expect(micropolis.setZoneOwner(bioX, y, 4)).toBe(true);
			simulator.syncMapViews();
			simulator.syncOwnerToMop();

			const mop = simulator.mopData!;
			for (let dx = -1; dx <= 1; dx += 1) {
				for (let dy = -1; dy <= 1; dy += 1) {
					expect(mop[centerIndex(x + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(AI_TILESET);
					expect(mop[centerIndex(farmX + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(FARM_TILESET);
					expect(mop[centerIndex(bioX + dx, y + dy, engine.WORLD_H)]! & 0xff).toBe(BIO_TILESET);
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
