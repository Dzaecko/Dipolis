import { describe, expect, it } from 'vitest';
import { AI_TILESET, FARM_TILESET, HUMAN_TILESET, MICROPOLIS_TILESET_COUNT, MicropolisSimulator } from './MicropolisSimulator';

describe('Micropolis human/AI tileset selection', () => {
	it('keeps AI and Farm tilesets reserved while cycling human variants', () => {
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
	});
});