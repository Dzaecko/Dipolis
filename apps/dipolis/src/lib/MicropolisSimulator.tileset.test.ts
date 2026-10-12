import { describe, expect, it } from 'vitest';
import { AI_TILESET, FARM_TILESET, BIO_TILESET, AI_BIO_TILESET, HUMAN_TILESET, MICROPOLIS_TILESET_COUNT, MicropolisSimulator } from './MicropolisSimulator';

describe('Dipolis internal human/AI atlas selection', () => {
	it('reserves farm and both plant-owner palettes from human tiles', () => {
		const simulator = new MicropolisSimulator();
		expect(simulator.humanTileSet).toBe(HUMAN_TILESET);

		simulator.setHumanTileSet(AI_TILESET - 1);
		simulator.setHumanTileSet(simulator.humanTileSet + 1);
		expect(simulator.humanTileSet).toBe(0);

		simulator.setHumanTileSet(AI_TILESET + 1);
		simulator.setHumanTileSet(simulator.humanTileSet - 1);
		expect(simulator.humanTileSet).toBe(AI_TILESET - 1);

		simulator.setHumanTileSet(HUMAN_TILESET);
		expect(simulator.humanTileSet).toBe(HUMAN_TILESET);
		simulator.setHumanTileSet(HUMAN_TILESET - 1);
		expect(simulator.humanTileSet).toBe(FARM_TILESET - 2);
		expect(simulator.humanTileSet).not.toBe(FARM_TILESET);
		expect(MICROPOLIS_TILESET_COUNT).toBe(AI_BIO_TILESET + 1);
		simulator.setHumanTileSet(BIO_TILESET);
		expect(simulator.humanTileSet).not.toBe(BIO_TILESET);
		simulator.setHumanTileSet(AI_BIO_TILESET);
		expect(simulator.humanTileSet).not.toBe(AI_BIO_TILESET);
	});
});