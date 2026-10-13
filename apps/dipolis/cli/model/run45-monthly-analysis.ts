import { readFileSync } from 'node:fs';
import { createCitySession } from './city-session';
import { readProtocol, type StartConfiguration, type YearRecord } from '../../src/lib/city-run/protocol';
import { advanceYear, readReport, replayDecisions, setupScenario } from '../../src/lib/city-run/replay';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

const path = process.argv[2];
if (!path) throw new Error('A protocol JSONL path is required');
const protocol = readProtocol(readFileSync(path, 'utf8'));
const start: StartConfiguration = {
	startMap: protocol.meta.startMap,
	seed: protocol.meta.seed,
	profile: protocol.meta.profile,
	scenario: protocol.meta.scenario,
	totalYears: protocol.meta.totalYears,
	disasters: protocol.meta.disasters,
	...(protocol.meta.startMap === 'natural' ? { autoBuildRules: protocol.meta.autoBuildRules } : {})
};
const { dispatch, engine, micropolis, close } = await createCitySession();
async function checkedDispatch(id: string, args?: Record<string, unknown>) {
	const result = await dispatch(id, args);
	if (result.handled === false) throw new Error(`City command failed: ${id}: ${result.message ?? 'no details'}`);
	return result;
}
function reportDiff(expected: Record<string, number>, actual: Record<string, number>) {
	return Object.keys(expected).filter(key => expected[key] !== actual[key])
		.map(key => `${key}:${expected[key]}→${actual[key]}`).slice(0, 8).join(',');
}
function plants(e: MainModule, city: Micropolis) {
	const found: string[] = [];
	for (let x = 0; x < e.WORLD_W; x++) for (let y = 0; y < e.WORLD_H; y++) {
		const tile = city.getTile(x, y);
		if ((tile & e.MapTileBits.ZONEBIT.value) === 0) continue;
		const base = tile & e.MapTileBits.LOMASK.value;
		if (base === e.Tiles.POWERPLANT.value) found.push(`coal@${x},${y}`);
		else if (base === e.Tiles.NUCLEAR.value) found.push(`nuclear@${x},${y}`);
		else if (base === e.Tiles.SOLARPOWER.value) found.push(`solar@${x},${y}`);
	}
	return found.join(';') || 'none';
}
async function run() {
	await setupScenario(dispatch, start);
	await checkedDispatch('events.reset');
	await checkedDispatch('events.drain');
	const mismatches: string[] = [];
	const years = protocol.years as YearRecord[];
	for (const year of years) {
		if (year.year >= 20) {
			const before = await readReport(dispatch);
			const mismatch = reportDiff(year.report, before);
			if (mismatch) mismatches.push(`year ${year.year} before: ${mismatch}`);
		}
		await replayDecisions(year.decisions, dispatch);
		if (year.year < 20) {
			await advanceYear(dispatch);
			await checkedDispatch('events.drain');
			if (year.year % 5 === 0) console.log(`REPLAYED_YEAR ${year.year}`);
			continue;
		}
		for (let month = 1; month <= 12; month++) {
			await checkedDispatch('sim.advance', { months: 1 });
			const drained = await checkedDispatch('events.drain');
			const events = (drained.data as { events?: Array<Record<string, unknown>> } | undefined)?.events ?? [];
			const diagnostics = JSON.parse(micropolis.getNetworkDiagnosticsJSON()) as {
				islands: Array<{ capacity: number; demand: number; unpoweredZones: number }>;
			};
			const capacity = diagnostics.islands.reduce((sum, island) => sum + island.capacity, 0);
			const demand = diagnostics.islands.reduce((sum, island) => sum + island.demand, 0);
			const damages = events.map(event => {
				const destroyed = event.destroyed as Record<string, number> | undefined;
				const plants = event.destroyedPlants as Array<Record<string, unknown>> | undefined;
				return `${event.kind}@${event.x},${event.y}` +
					(plants?.length ? ` plants=${plants.map(plant => `${plant.type}@${plant.x},${plant.y}:${plant.capacity}`).join('|')}` : '') +
					(destroyed ? ` wires=${destroyed.wires} roads=${destroyed.roads} zones=${destroyed.humanZones}/${destroyed.aiZones}/${destroyed.otherZones}` : '');
			});
			console.log([
				year.year, month, `human=${micropolis.resPop}`, `ai=${micropolis.aiPop}`,
				`capacity=${capacity}`, `demand=${demand}`,
				`islands=${diagnostics.islands.length}`,
				`unpowered=${diagnostics.islands.reduce((sum, island) => sum + island.unpoweredZones, 0)}`,
				`damagedPlants=${micropolis.damagedPowerPlants}`,
				`plants=${plants(engine, micropolis)}`,
				damages.join(',')
			].join('\t'));
		}
		const after = await readReport(dispatch);
		const delta = reportDiff(year.afterReport, after);
		if (delta) mismatches.push(`year ${year.year} after: ${delta}`);
	}
	console.log(`REPLAY ${protocol.complete ? 'complete' : 'partial'}; years=${years.length}; mismatches=${mismatches.length}`);
	for (const mismatch of mismatches) console.log(`MISMATCH ${mismatch}`);
}
try {
	await run();
} finally {
	close();
}
