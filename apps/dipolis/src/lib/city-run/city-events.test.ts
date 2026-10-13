import { describe, expect, it } from 'vitest';
import type { MainModule, Micropolis } from '../../types/micropolisengine.d.js';
import { CityEventLedger, describeCityEvent, eventSection, isCityEvent } from './city-events';

describe('city event ledger', () => {
	it('records engine disaster messages in the run-relative year and month', () => {
		const width = 90, height = 90, tiles = new Uint16Array(width * height);
		const memory = new WebAssembly.Memory({ initial: 2 });
		const owners = new Uint8Array(memory.buffer, 0, tiles.length);
		const engine = {
			WORLD_W: width,
			WORLD_H: height,
			wasmMemory: memory,
			MapTileBits: { LOMASK: { value: 1023 }, ZONEBIT: { value: 1024 }, CONDBIT: { value: 16384 } },
			Tiles: {
				POWERPLANT: { value: 750 }, NUCLEAR: { value: 816 }, SOLARPOWER: { value: 889 },
				ROADBASE: { value: 64 }, LASTROAD: { value: 206 },
				HROADPOWER: { value: 77 }, VROADPOWER: { value: 78 }, ROADVPOWERH: { value: 239 },
				POWERBASE: { value: 208 }, LASTPOWER: { value: 222 }, RAILHPOWERV: { value: 221 },
				RAILVPOWERH: { value: 222 }, RAILBASE: { value: 224 }
			},
			MessageNumber: {
				MESSAGE_FIRE_REPORTED: { value: 101 }, MESSAGE_FLOODING_REPORTED: { value: 103 },
				MESSAGE_EARTHQUAKE: { value: 102 }, MESSAGE_TORNADO_SIGHTED: { value: 104 },
				MESSAGE_MONSTER_SIGHTED: { value: 105 }, MESSAGE_NUCLEAR_MELTDOWN: { value: 106 },
				MESSAGE_PLANE_CRASHED: { value: 107 }, MESSAGE_SHIP_CRASHED: { value: 109 },
				MESSAGE_TRAIN_CRASHED: { value: 110 }, MESSAGE_HELICOPTER_CRASHED: { value: 111 },
				MESSAGE_EXPLOSION_REPORTED: { value: 112 }, MESSAGE_FIREBOMBING: { value: 108 }
			}
		} as unknown as MainModule;
		tiles[5 * height + 5] = 750 | 1024 | 16384;
		tiles[4 * height + 4] = 889 | 1024 | 16384;
		tiles[6 * height + 6] = 64 | 16384;
		tiles[7 * height + 7] = 100 | 1024;
		owners[7 * height + 7] = 2;
		const city = {
			cityTime: 400,
			getTile: (x: number, y: number) => tiles[x * height + y] ?? 0,
			getOwnerMapAddress: () => 0,
			getOwnerMapSize: () => owners.length
		} as Micropolis;
		const ledger = new CityEventLedger(engine, city);
		ledger.reset();
		city.cityTime = 412;
		ledger.receiveMessage(101, 5, 80);
		tiles[5 * height + 5] = 0;
		tiles[4 * height + 4] = 0;
		tiles[6 * height + 6] = 0;
		tiles[7 * height + 7] = 0;
		expect(ledger.drain()).toEqual([
			{
				kind: 'fire', year: 1, month: 4, x: 5, y: 80, location: 'Süd-West',
				destroyed: { humanZones: 0, aiZones: 1, otherZones: 0, wires: 0, roads: 1 },
				destroyedPlants: [
					{ type: 'solar', x: 4, y: 4, capacity: 1000, builtYear: 0 },
					{ type: 'coal', x: 5, y: 5, capacity: 700, builtYear: 0 }
				],
				lostCapacity: 1700, details: 'Zwischen den Berichten beobachtete Verluste.'
			}
		]);
		city.cityTime = 448;
		ledger.receiveMessage(102, -1, -1);
		expect(ledger.drain()).toEqual([
			{ kind: 'earthquake', year: 2, month: 1, x: null, y: null, location: 'unbekannter Ort' }
		]);
		expect(ledger.drain()).toEqual([]);
	});

	it('validates and renders events without recommendations', () => {
		const event = { kind: 'fire' as const, year: 3, month: 7, x: 10, y: 20, location: 'Zentrum' };
		expect(isCityEvent(event)).toBe(true);
		expect(isCityEvent({ ...event, month: 13 })).toBe(false);
		expect(describeCityEvent(event)).toBe('Jahr 3, Monat 7: Brand bei Zentrum (10, 20)');
		expect(eventSection([event])).toContain('Ereignisse seit dem letzten Bericht');
		expect(eventSection([event])).not.toMatch(/sollte|empfiehlt|empfehlung/i);
	});

	it('counts shared road-and-wire tiles as both losses', () => {
		const width = 2, height = 2, tiles = new Uint16Array(width * height);
		const memory = new WebAssembly.Memory({ initial: 1 });
		const owners = new Uint8Array(memory.buffer, 0, tiles.length);
		const engine = {
			WORLD_W: width, WORLD_H: height, wasmMemory: memory,
			MapTileBits: { LOMASK: { value: 1023 }, ZONEBIT: { value: 1024 }, CONDBIT: { value: 16384 } },
			Tiles: {
			POWERPLANT: { value: 750 }, NUCLEAR: { value: 816 }, SOLARPOWER: { value: 889 },
			ROADBASE: { value: 64 }, LASTROAD: { value: 206 },
				HROADPOWER: { value: 77 }, VROADPOWER: { value: 78 }, ROADVPOWERH: { value: 239 },
				POWERBASE: { value: 208 }, LASTPOWER: { value: 222 }, RAILHPOWERV: { value: 221 },
				RAILVPOWERH: { value: 222 }, RAILBASE: { value: 224 }
			},
			MessageNumber: {
				MESSAGE_FIRE_REPORTED: { value: 101 }, MESSAGE_FLOODING_REPORTED: { value: 103 },
				MESSAGE_EARTHQUAKE: { value: 102 }, MESSAGE_TORNADO_SIGHTED: { value: 104 },
				MESSAGE_MONSTER_SIGHTED: { value: 105 }, MESSAGE_NUCLEAR_MELTDOWN: { value: 106 },
				MESSAGE_PLANE_CRASHED: { value: 107 }, MESSAGE_SHIP_CRASHED: { value: 109 },
				MESSAGE_TRAIN_CRASHED: { value: 110 }, MESSAGE_HELICOPTER_CRASHED: { value: 111 },
				MESSAGE_EXPLOSION_REPORTED: { value: 112 }, MESSAGE_FIREBOMBING: { value: 108 }
			}
		} as unknown as MainModule;
		tiles[0] = 77 | 16384;
		const city = {
			cityTime: 0,
			getTile: (x: number, y: number) => tiles[x * height + y] ?? 0,
			getOwnerMapAddress: () => 0,
			getOwnerMapSize: () => owners.length
		} as Micropolis;
		const ledger = new CityEventLedger(engine, city);
		ledger.reset();
		city.cityTime = 4;
		ledger.receiveMessage(101, 0, 0);
		tiles[0] = 0;
		expect(ledger.drain()[0]?.destroyed).toEqual({
			humanZones: 0, aiZones: 0, otherZones: 0, wires: 1, roads: 1
		});
	});
});
