import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCitySession } from '../model/city-session';
import { setupScenario, replayDecisions } from '../../src/lib/city-run/replay';
import { readProtocol } from '../../src/lib/city-run/protocol';
import { liveStartConfiguration } from '../../src/lib/city-run/compatibility';

type Session = Awaited<ReturnType<typeof createCitySession>>;
type Result = { requested: number; built: number; cost: number; totalFunds: number; failureReason?: string };
const image = ({ engine, micropolis: m }: Session) => ({
	tiles: new Uint16Array(engine.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2).slice(),
	owners: new Uint8Array(engine.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize()).slice(),
	funds: m.totalFunds
});
const digest = (s: Session) => createHash('sha256').update(image(s).tiles).update(image(s).owners).digest('hex');
async function natural<T>(seed: number, run: (s: Session) => Promise<T>, rules: 0 | 1 = 1) {
	const s = await createCitySession();
	try {
		await setupScenario(s.dispatch, { startMap: 'natural', seed, profile: 'v3-pods', autoBuildRules: rules });
		return await run(s);
	} finally { s.close(); }
}
async function build(s: Session, id: string, args: Record<string, unknown>): Promise<Result> {
	const before = image(s);
	const result = await s.dispatch(id, args);
	expect(result.handled).not.toBe(false);
	const data = result.data as Result;
	expect(data.cost).toBe(before.funds - s.micropolis.totalFunds);
	expect(data.built).toBeGreaterThan(0);
	expect(data.built).toBe(data.requested);
	expect(data.cost).toBeGreaterThan(0);
	return data;
}
function assertAccess(s: Session) {
	const { engine: e } = s;
	const { tiles, owners } = image(s);
	const mask = e.MapTileBits.LOMASK.value, cond = e.MapTileBits.CONDBIT.value;
	const road = (v: number) => (v & mask) >= e.Tiles.ROADBASE.value && (v & mask) < e.Tiles.POWERBASE.value;
	const neighbors = (id: number) => {
		const x = Math.floor(id / e.WORLD_H), y = id % e.WORLD_H;
		return [[x - 1, y], [x, y - 1], [x, y + 1], [x + 1, y]]
			.filter(([a, b]) => a! >= 0 && a! < e.WORLD_W && b! >= 0 && b! < e.WORLD_H)
			.map(([a, b]) => a! * e.WORLD_H + b!);
	};
	const plant = [...tiles.keys()].find(i => (tiles[i]! & mask) === e.Tiles.POWERPLANT.value)!;
	expect(plant).toBeDefined();
	const conductive = new Set([plant]), queue = [plant];
	for (let n = 0; n < queue.length; n++) for (const i of neighbors(queue[n]!))
		if (!conductive.has(i) && (tiles[i]! & cond)) { conductive.add(i); queue.push(i); }
	const roads = [...tiles.keys()].filter(i => road(tiles[i]!));
	expect(roads.length).toBeGreaterThan(0);
	const seen = new Set([roads[0]!]), rq = [roads[0]!];
	for (let n = 0; n < rq.length; n++) for (const i of neighbors(rq[n]!))
		if (!seen.has(i) && road(tiles[i]!)) { seen.add(i); rq.push(i); }
	expect(seen.size).toBe(roads.length);
	for (const i of [...tiles.keys()].filter(i => (tiles[i]! & e.MapTileBits.ZONEBIT.value) && owners[i])) {
		expect(conductive.has(i), `conductive zone ${i}`).toBe(true);
		const x = Math.floor(i / e.WORLD_H) - 1, y = i % e.WORLD_H - 1;
		const perimeter: number[] = [];
		for (let j = 0; j < 3; j++) for (const [a, b] of [[x - 1, y + j], [x + 3, y + j], [x + j, y - 1], [x + j, y + 3]])
			if (a! >= 0 && b! >= 0 && a! < e.WORLD_W && b! < e.WORLD_H) perimeter.push(a! * e.WORLD_H + b!);
		expect(perimeter.some(i => road(tiles[i]!))).toBe(true);
	}
}

describe('versioned natural city founding in the real engine', () => {
	it('live bootstrap uses the same rules and exact power-plant outcome as the runner', async () => {
		const start = { startMap: 'natural' as const, seed: 42, profile: 'koexistenz' as const, autoBuildRules: 1 as const };
		const run = async (configuration: typeof start | ReturnType<typeof liveStartConfiguration>) => {
			const s = await createCitySession();
			try {
				await setupScenario(s.dispatch, configuration);
				return (await s.dispatch('build.power-plant', { type: 'coal' })).data as Result;
			} finally { s.close(); }
		};
		const logged = await run(start);
		expect(logged.built).toBe(1);
		expect(await run(liveStartConfiguration(start))).toEqual(logged);
		expect(await run({ ...start, autoBuildRules: 0 } as ReturnType<typeof liveStartConfiguration>))
			.toMatchObject({ built: 0, cost: 0 });
	});
	it.each([42, 43])('supports either residential/coal order, farms and AI on seed %i deterministically', async seed => {
		for (const coalFirst of [false, true]) {
			const run = () => natural(seed, async s => {
				const before = image(s);
				expect(before.tiles.some(v => (v & s.engine.MapTileBits.LOMASK.value) === s.engine.Tiles.RIVER.value)).toBe(true);
				const plant = () => build(s, 'build.power-plant', { type: 'coal' });
				if (coalFirst) await plant();
				await build(s, 'build.residential', { count: 3 });
				if (!coalFirst) {
					expect(s.micropolis.powerCapacity).toBe(0);
					expect(image(s).tiles.some(v => v & s.engine.MapTileBits.PWRBIT.value)).toBe(false);
					await plant();
				}
				await build(s, 'build.farms', { count: 3 });
				await build(s, 'build.ai-zones', { count: 3 });
				await build(s, 'build.bio-plant', { count: 1 });
				assertAccess(s); // Works before any scan: new plant is a physical source.
				const hash = digest(s), funds = s.micropolis.totalFunds;
				// Test grid founding independently of the separately tested sabotage mechanics.
				expect(s.micropolis.setParam('unrestInertia', 0)).toBe(true);
				await s.dispatch('sim.advance-ticks', { ticks: 1280 });
				expect(s.micropolis.powerCapacity).toBe(700);
				expect(s.micropolis.resPop).toBeGreaterThan(0);
				return { hash, funds };
			});
			expect(await run()).toEqual(await run());
		}
	}, 120_000);

	it.each(['build.farms', 'build.ai-zones', 'build.bio-plant'])('can found the unpowered grid with %s first', async id => {
		await natural(43, async s => {
			await build(s, id, { count: 2 });
			expect(s.micropolis.powerCapacity).toBe(0);
			await build(s, 'build.power-plant', { type: 'coal' });
			await build(s, 'build.residential', { count: 2 });
			assertAccess(s);
		});
	});

	it('nuclear can seed the physical grid before a power scan', async () => {
		await natural(42, async s => {
			await build(s, 'build.power-plant', { type: 'nuclear' });
			expect(s.micropolis.powerCapacity).toBe(0);
			await build(s, 'build.residential', { count: 2 });
			await build(s, 'build.ai-zones', { count: 2 });
			await build(s, 'build.farms', { count: 2 });
			expect(s.micropolis.setParam('unrestInertia', 0)).toBe(true);
			await s.dispatch('sim.advance-ticks', { ticks: 1280 });
			expect(s.micropolis.powerCapacity).toBe(2000);
			expect(s.micropolis.resPop).toBeGreaterThan(0);
		});
	});

	it.each(['build.residential', 'build.power-plant'])('funds the entire first %s transaction or changes nothing', async id => {
		const args = id === 'build.residential' ? { count: 1 } : { type: 'coal' };
		const full = await natural(42, async s => ({ result: await build(s, id, args), hash: digest(s) }));
		await natural(42, async s => {
			s.micropolis.setFunds(full.result.cost - 1);
			const before = image(s);
			const failure = await s.dispatch(id, args);
			expect(failure.data).toMatchObject({ built: 0, cost: 0, failureReason: 'insufficient-funds' });
			expect(image(s)).toEqual(before);
			s.micropolis.setFunds(full.result.cost);
			expect(await build(s, id, args)).toMatchObject({ built: 1, cost: full.result.cost, totalFunds: 0 });
			expect(digest(s)).toBe(full.hash);
		});
	}, 120_000);

	it('reports an unavailable site without editing water or spending', async () => {
		await natural(43, async s => {
			for (let x = 0; x < s.engine.WORLD_W; x++) for (let y = 0; y < s.engine.WORLD_H; y++)
				s.micropolis.setTile(x, y, s.engine.Tiles.RIVER.value);
			const before = image(s);
			expect((await s.dispatch('build.residential', { count: 1 })).data)
				.toMatchObject({ built: 0, cost: 0, failureReason: 'no-connected-site' });
			expect(image(s)).toEqual(before);
		});
	});

	it('replays historical natural built-zero outcomes under the recorded legacy rules', async () => {
		const protocol = readProtocol(JSON.stringify({ event: 'run-started', startMap: 'natural', seed: 42 }));
		expect(protocol.meta.autoBuildRules).toBe(0);
		await natural(42, async s => {
			const before = image(s);
			await replayDecisions([{ reason: '', toolCalls: [{
				call: { id: 'old', name: 'build.residential', arguments: { count: 3 } },
				result: { data: { requested: 3, built: 0, cost: 0, totalFunds: 60_000 } }
			}] }], s.dispatch);
			expect(image(s)).toEqual(before);
		}, protocol.meta.autoBuildRules);
		expect(() => readProtocol(JSON.stringify({ event: 'run-started', autoBuildRules: 99 })))
			.toThrow('Unsupported protocol autoBuildRules');
	});
});
