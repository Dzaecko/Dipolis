import { readFileSync } from 'node:fs';
import { createCitySession } from './city-session';
import { readProtocol, type StartConfiguration, type YearRecord } from '../../src/lib/city-run/protocol';
import { advanceYear, replayDecisions, setupScenario } from '../../src/lib/city-run/replay';
import { advanceMonths } from '../../src/lib/city-run/advance';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';

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
function compare(expected: Record<string, number>, actual: Record<string, number>) {
	return Object.keys(expected).filter(key => expected[key] !== actual[key])
		.map(key => `${key}:${expected[key]}→${actual[key]}`).slice(0, 8).join(',');
}
async function run() {
	await setupScenario(dispatch, start);
	await checkedDispatch('events.reset');
	await checkedDispatch('events.drain');
	const years = protocol.years as YearRecord[];
	for (const year of years.slice(0, 20)) {
		await replayDecisions(year.decisions, dispatch);
		await advanceYear(dispatch);
		await checkedDispatch('events.drain');
		if (year.year % 5 === 0) console.log(`REPLAYED_YEAR ${year.year}`);
	}
	const year = years[20]!;
	await replayDecisions(year.decisions, dispatch);
	for (let month = 1; month <= 8; month++) {
		await checkedDispatch('sim.advance', { months: 1 });
		await checkedDispatch('events.drain');
	}
	const clone = micropolis.clone();
	if (!clone) throw new Error('Could not clone the run-45 city for the network intervention');
	try {
		clone.setCallback(createNoopJsCallback(engine), {});
		const before = JSON.parse(clone.getNetworkDiagnosticsJSON()) as {
			islands: Array<{
				islandId: number; bankIds: number[]; capacity: number; demand: number;
				humanZones: number; unpoweredZones: number; physicalPoweredZones: number;
				connectionQuote: { cost: number; length: number } | null;
			}>;
		};
		const totals = (islands: typeof before.islands) => ({
			islands: islands.length,
			humanZones: islands.reduce((sum, island) => sum + island.humanZones, 0),
			unpoweredZones: islands.reduce((sum, island) => sum + island.unpoweredZones, 0),
			physicalPoweredZones: islands.reduce((sum, island) => sum + island.physicalPoweredZones, 0)
		});
		const candidates = before.islands
			.filter(island => island.unpoweredZones > 0)
			.sort((a, b) => b.unpoweredZones - a.unpoweredZones ||
				(a.connectionQuote?.cost ?? Number.MAX_SAFE_INTEGER) -
				(b.connectionQuote?.cost ?? Number.MAX_SAFE_INTEGER));
		console.log(JSON.stringify({
			interventionCandidates: candidates.slice(0, 10).map(island => ({
				id: island.islandId, humanZones: island.humanZones, unpoweredZones: island.unpoweredZones,
				connectionQuote: island.connectionQuote
			})),
			candidateCount: candidates.length, funds: clone.totalFunds, islands: before.islands.length
		}));
		const target = candidates.find(island => island.connectionQuote !== null &&
			island.connectionQuote.cost <= clone.totalFunds);
		if (target) {
			const result = JSON.parse(clone.connectPowerIsland(target.islandId)) as {
				cost: number; length: number; connected: boolean; failureReason?: string;
			};
			if (!result.connected) throw new Error(`power.connect failed: ${result.failureReason ?? 'unknown'}`);
			const afterConnection = JSON.parse(clone.getNetworkDiagnosticsJSON()) as {
				islands: typeof before.islands;
			};
			if (!advanceMonths(clone, 1)) throw new Error('Intervention clone failed to advance one month');
			const after = JSON.parse(clone.getNetworkDiagnosticsJSON()) as {
				islands: Array<{
					bankIds: number[]; humanZones: number; unpoweredZones: number; physicalPoweredZones: number;
				}>;
			};
			console.log(JSON.stringify({
				intervention: 'power.connect', year: 21, month: 8, targetIsland: target.islandId,
				targetHumanZones: target.humanZones, targetUnpoweredBefore: target.unpoweredZones,
				fundsBefore: clone.totalFunds + result.cost, result,
				before: totals(before.islands),
				afterConnection: totals(afterConnection.islands),
				afterOneMonth: totals(after.islands)
			}));
		}
	} finally {
		clone.delete();
	}
	for (let month = 9; month <= 12; month++) {
		await checkedDispatch('sim.advance', { months: 1 });
		await checkedDispatch('events.drain');
	}
	const afterYear = await checkedDispatch('report.get');
	const mismatch = compare(year.afterReport, afterYear.data as Record<string, number>);
	console.log(`ORIGINAL_RUN_UNCHANGED ${mismatch ? `no: ${mismatch}` : 'yes'}`);
}
try {
	await run();
} finally {
	close();
}
