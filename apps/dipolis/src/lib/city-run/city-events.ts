import type { MainModule, Micropolis } from '../../types/micropolisengine.d.js';
import { callbackMethodNames } from '../wasm/callbacks';

export type CityEventKind =
	| 'fire' | 'flood' | 'earthquake' | 'tornado' | 'monster'
	| 'meltdown' | 'aircraft-crash' | 'ship-crash' | 'train-crash' | 'helicopter-crash'
	| 'explosion' | 'firebombing';

export interface CityEvent {
	kind: CityEventKind;
	year: number;
	month: number;
	x: number | null;
	y: number | null;
	location: string;
	details?: string;
	destroyedPlants?: Array<{ type: 'coal' | 'nuclear' | 'solar'; x: number; y: number; builtYear: number; capacity: number }>;
	destroyed?: { humanZones: number; aiZones: number; otherZones: number; wires: number; roads: number };
	lostCapacity?: number;
}

interface PlantSnapshot {
	type: 'coal' | 'nuclear' | 'solar';
	x: number;
	y: number;
	capacity: number;
}
interface CitySnapshot {
	tiles: Uint16Array;
	owners: Uint8Array;
	plants: Map<string, PlantSnapshot>;
}

const eventKinds: CityEventKind[] = ['fire', 'flood', 'earthquake', 'tornado', 'monster', 'meltdown',
	'aircraft-crash', 'ship-crash', 'train-crash', 'helicopter-crash', 'explosion', 'firebombing'];
export function isCityEvent(value: unknown): value is CityEvent {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const event = value as Record<string, unknown>;
	const nonnegativeInteger = (entry: unknown): entry is number =>
		typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0;
	const destroyed = event.destroyed;
	const validDestroyed = destroyed === undefined || destroyed !== null && typeof destroyed === 'object' &&
		!Array.isArray(destroyed) &&
		['humanZones', 'aiZones', 'otherZones', 'wires', 'roads'].every(key =>
			nonnegativeInteger((destroyed as Record<string, unknown>)[key]));
	const plants = event.destroyedPlants;
	const validPlants = plants === undefined || Array.isArray(plants) && plants.every(plant =>
		plant !== null && typeof plant === 'object' && !Array.isArray(plant) &&
		['coal', 'nuclear', 'solar'].includes(String((plant as Record<string, unknown>).type)) &&
		nonnegativeInteger((plant as Record<string, unknown>).x) &&
		nonnegativeInteger((plant as Record<string, unknown>).y) &&
		nonnegativeInteger((plant as Record<string, unknown>).builtYear) &&
		nonnegativeInteger((plant as Record<string, unknown>).capacity));
	return eventKinds.includes(event.kind as CityEventKind) &&
		Number.isSafeInteger(event.year) && Number(event.year) >= 1 &&
		Number.isSafeInteger(event.month) && Number(event.month) >= 1 && Number(event.month) <= 12 &&
		(event.x === null || Number.isSafeInteger(event.x)) &&
		(event.y === null || Number.isSafeInteger(event.y)) &&
		typeof event.location === 'string' &&
		(event.details === undefined || typeof event.details === 'string') &&
		(event.lostCapacity === undefined || nonnegativeInteger(event.lostCapacity)) &&
		validPlants && validDestroyed;
}

const eventLabels: Record<CityEventKind, string> = {
	fire: 'Brand', flood: 'Überflutung', earthquake: 'Erdbeben', tornado: 'Tornado',
	monster: 'Monster', meltdown: 'Kernschmelze', 'aircraft-crash': 'Flugzeugabsturz',
	'ship-crash': 'Schiffsunfall', 'train-crash': 'Zugunfall', 'helicopter-crash': 'Hubschrauberabsturz',
	explosion: 'Explosion',
	firebombing: 'Brandbomben'
};

export function describeCityEvent(event: CityEvent): string {
	const when = `Jahr ${event.year}, Monat ${event.month}`;
	const position = event.x === null || event.y === null
		? event.location : `${event.location} (${event.x}, ${event.y})`;
	const destruction = event.destroyedPlants?.map(plant =>
		`${plant.type === 'coal' ? 'Kohlekraftwerk' : plant.type === 'nuclear' ? 'Kernkraftwerk' : 'Solarkraftwerk'} ` +
		`(${plant.x}, ${plant.y}), Baujahr ${plant.builtYear === 0 ? 'vor Laufbeginn' : `Jahr ${plant.builtYear}`}, ${plant.capacity} Kapazität`).join('; ');
	return `${when}: ${eventLabels[event.kind]} bei ${position}` +
		(event.details ? `; ${event.details}` : '') +
		(event.destroyed ? `; zerstört: Menschenzonen ${event.destroyed.humanZones}, KI-Zonen ${event.destroyed.aiZones}, andere Zonen ${event.destroyed.otherZones}, Leitungen ${event.destroyed.wires}, Straßen ${event.destroyed.roads}` : '') +
		(destruction ? `; zerstört: ${destruction}` : '') +
		(event.lostCapacity ? `; verlorene Kraftwerkskapazität ${event.lostCapacity}` : '');
}

function sector(x: number, y: number, engine: MainModule): string {
	const horizontal = x < engine.WORLD_W / 3 ? 'West' : x >= engine.WORLD_W * 2 / 3 ? 'Ost' : 'Mitte';
	const vertical = y < engine.WORLD_H / 3 ? 'Nord' : y >= engine.WORLD_H * 2 / 3 ? 'Süd' : 'Zentrum';
	return `${vertical}${horizontal === 'Mitte' ? '' : `-${horizontal}`}`;
}

export class CityEventLedger {
	private pending: CityEvent[] = [];
	private startedAt = 0;
	private previous: CitySnapshot;
	private plantBuiltYears = new Map<string, number>();

	constructor(private readonly engine: MainModule, private readonly city: Micropolis) {
		this.previous = this.snapshot();
	}

	reset(): void {
		this.pending = [];
		this.startedAt = this.city.cityTime;
		this.previous = this.snapshot();
		this.plantBuiltYears = new Map([...this.previous.plants.keys()].map(key => [key, 0]));
	}

	receiveMessage(messageIndex: number, x: number, y: number): void {
		const messages = this.engine.MessageNumber;
		const kinds = new Map<number, CityEventKind>([
			[messages.MESSAGE_FIRE_REPORTED.value, 'fire'],
			[messages.MESSAGE_FLOODING_REPORTED.value, 'flood'],
			[messages.MESSAGE_EARTHQUAKE.value, 'earthquake'],
			[messages.MESSAGE_TORNADO_SIGHTED.value, 'tornado'],
			[messages.MESSAGE_MONSTER_SIGHTED.value, 'monster'],
			[messages.MESSAGE_NUCLEAR_MELTDOWN.value, 'meltdown'],
			[messages.MESSAGE_PLANE_CRASHED.value, 'aircraft-crash'],
			[messages.MESSAGE_SHIP_CRASHED.value, 'ship-crash'],
			[messages.MESSAGE_TRAIN_CRASHED.value, 'train-crash'],
			[messages.MESSAGE_HELICOPTER_CRASHED.value, 'helicopter-crash'],
			[messages.MESSAGE_EXPLOSION_REPORTED.value, 'explosion'],
			[messages.MESSAGE_FIREBOMBING.value, 'firebombing']
		]);
		const kind = kinds.get(messageIndex);
		if (!kind) return;
		const monthIndex = Math.max(0, Math.floor((this.city.cityTime - this.startedAt) / 4));
		const hasLocation = x >= 0 && y >= 0 && x < this.engine.WORLD_W && y < this.engine.WORLD_H;
		this.pending.push({
			kind, year: Math.floor(monthIndex / 12) + 1, month: monthIndex % 12 + 1,
			x: hasLocation ? x : null, y: hasLocation ? y : null,
			location: hasLocation ? sector(x, y, this.engine) : 'unbekannter Ort'
		});
	}

	drain(): CityEvent[] {
		const current = this.snapshot();
		const destroyed = { humanZones: 0, aiZones: 0, otherZones: 0, wires: 0, roads: 0 };
		const destroyedPlants: NonNullable<CityEvent['destroyedPlants']> = [];
		const baseMask = this.engine.MapTileBits.LOMASK.value;
		const zoneBit = this.engine.MapTileBits.ZONEBIT.value;
		const conductiveBit = this.engine.MapTileBits.CONDBIT.value;
		const mapLength = this.engine.WORLD_W * this.engine.WORLD_H;
		for (let index = 0; index < mapLength; index++) {
			const oldTile = this.previous.tiles[index] ?? 0;
			const newTile = current.tiles[index] ?? 0;
			const oldBase = oldTile & baseMask;
			const newBase = newTile & baseMask;
			const x = Math.floor(index / this.engine.WORLD_H);
			const y = index % this.engine.WORLD_H;
			const oldPlant = this.previous.plants.get(`${x},${y}`);
			if (!oldPlant && (oldTile & zoneBit) !== 0 && (newTile & zoneBit) === 0) {
				const owner = this.previous.owners[index] ?? 0;
				if (owner === 2) destroyed.aiZones++;
				else if (owner === 1) destroyed.humanZones++;
				else destroyed.otherZones++;
			}
			if (!oldPlant && (oldTile & conductiveBit) !== 0 && (newTile & conductiveBit) === 0) {
				const roadPower = oldBase === this.engine.Tiles.HROADPOWER.value ||
					oldBase === this.engine.Tiles.VROADPOWER.value ||
					oldBase === this.engine.Tiles.ROADVPOWERH.value;
				const railPower = oldBase === this.engine.Tiles.RAILHPOWERV.value ||
					oldBase === this.engine.Tiles.RAILVPOWERH.value;
				if (roadPower || railPower ||
					oldBase >= this.engine.Tiles.POWERBASE.value && oldBase <= this.engine.Tiles.LASTPOWER.value)
					destroyed.wires++;
				if (roadPower ||
					oldBase >= this.engine.Tiles.ROADBASE.value && oldBase <= this.engine.Tiles.LASTROAD.value)
					destroyed.roads++;
			}
			if (oldPlant && !current.plants.has(`${x},${y}`)) {
				destroyedPlants.push({ ...oldPlant, builtYear: this.plantBuiltYears.get(`${x},${y}`) ?? 0 });
			}
		}
		for (const key of current.plants.keys()) {
			if (!this.plantBuiltYears.has(key)) {
				const elapsed = Math.max(0, this.city.cityTime - this.startedAt);
				this.plantBuiltYears.set(key, Math.max(1, Math.ceil(elapsed / 48)));
			}
		}
		this.previous = current;
		const events = this.pending.splice(0);
		if (events.length > 0 &&
			(Object.values(destroyed).some(count => count > 0) || destroyedPlants.length > 0)) {
			const lostCapacity = destroyedPlants.reduce((sum, plant) => sum + plant.capacity, 0);
			const affected = events[events.length - 1]!;
			affected.destroyed = destroyed;
			if (destroyedPlants.length) affected.destroyedPlants = destroyedPlants;
			if (lostCapacity > 0) affected.lostCapacity = lostCapacity;
			affected.details = 'Zwischen den Berichten beobachtete Verluste.';
		}
		return events;
	}

	private snapshot(): CitySnapshot {
		const width = this.engine.WORLD_W;
		const height = this.engine.WORLD_H;
		const length = width * height;
		const tiles = new Uint16Array(length);
		const owners = new Uint8Array(this.engine.wasmMemory.buffer, this.city.getOwnerMapAddress(), this.city.getOwnerMapSize()).slice();
		if (owners.length !== length) throw new Error('Engine owner map size differs from world dimensions');
		const plants = new Map<string, PlantSnapshot>();
		const zoneBit = this.engine.MapTileBits.ZONEBIT.value;
		const baseMask = this.engine.MapTileBits.LOMASK.value;
		for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
			const index = x * height + y;
			const value = this.city.getTile(x, y);
			tiles[index] = value;
			const base = value & baseMask;
			if ((value & zoneBit) === 0) continue;
			if (base === this.engine.Tiles.POWERPLANT.value)
				plants.set(`${x},${y}`, { type: 'coal', x, y, capacity: 700 });
			else if (base === this.engine.Tiles.NUCLEAR.value)
				plants.set(`${x},${y}`, { type: 'nuclear', x, y, capacity: 2000 });
			else if (base === this.engine.Tiles.SOLARPOWER.value)
				plants.set(`${x},${y}`, { type: 'solar', x, y, capacity: 1000 });
		}
		return { tiles, owners, plants };
	}
}

export function createEventCallback(engine: MainModule, ledger: CityEventLedger) {
	const callbacks = Object.fromEntries(callbackMethodNames.map(name => [name, (..._args: unknown[]) => {}]));
	callbacks.sendMessage = (...args: unknown[]) => {
		const [, , messageIndex, x, y] = args;
		if (typeof messageIndex !== 'number' || typeof x !== 'number' || typeof y !== 'number')
			throw new Error('Engine sent malformed disaster event callback arguments');
		ledger.receiveMessage(messageIndex, x, y);
	};
	return new engine.JSCallback(callbacks);
}

export function eventSection(events: CityEvent[]): string {
	return events.length
		? `Ereignisse seit dem letzten Bericht:\n${events.map(describeCityEvent).join('\n')}`
		: 'Ereignisse seit dem letzten Bericht:\nKeine gemeldeten Katastrophen oder Brände.';
}
