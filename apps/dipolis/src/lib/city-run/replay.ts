import { mapToolArguments, validateToolCall } from './tools';
import { DEFAULT_START_CONFIGURATION, type Decision, type ProtocolToolCall, type Report, type StartConfiguration } from './protocol';

export type Dispatch = (id: string, args?: Record<string, unknown>) => Promise<{
	handled?: boolean; message?: string; data?: unknown;
}>;

export const SCENARIO = { city: 'haight', profile: 'koexistenz', seed: 42, disasters: false, speed: 3 } as const;
export const WARMUP_TICKS = 12000;
export const START_TREASURY = 60000;

async function command(dispatch: Dispatch, id: string, args?: Record<string, unknown>) {
	const result = await dispatch(id, args);
	if (result.handled === false) throw new Error(`City command failed: ${id}`);
	return result.data as Report;
}

/** Shared start-map/profile setup up to the baseline for runner and browser replay. */
export async function setupScenario(dispatch: Dispatch, start: StartConfiguration = DEFAULT_START_CONFIGURATION): Promise<void> {
	if (start.scenario === 'stromkrise' && (start.startMap !== 'haight' || !['v3-pods', 'v4-fraktion'].includes(start.profile ?? '')))
		throw new Error('Stromkrise requires v3-pods or v4-fraktion and Haight');
	await command(dispatch, 'scenario.start', {
		...SCENARIO,
		city: start.startMap,
		profile: start.profile ?? 'koexistenz',
		seed: start.seed,
		disasters: start.disasters ?? false,
		...(start.startMap === 'natural' ? { autoBuildRules: start.autoBuildRules ?? 0 } : {})
	});
	await command(dispatch, 'tax.set', { rate: 7 });
	await command(dispatch, 'food.set-import', { enabled: true });
	await command(dispatch, 'power.set-priority', { priority: 0 });
	await command(dispatch, 'sim.advance-ticks', { ticks: WARMUP_TICKS });
	await command(dispatch, 'treasury.set', { amount: START_TREASURY });
	if (start.scenario === 'stromkrise') await command(dispatch, 'scenario.stromkrise');
	await command(dispatch, 'report.mark-baseline');
}

export async function readReport(dispatch: Dispatch): Promise<Report> {
	return command(dispatch, 'report.get');
}

export async function advanceYear(dispatch: Dispatch): Promise<void> {
	await command(dispatch, 'sim.advance', { months: 12 });
}

/** Accept old protocol budget fields for replay, never as new model arguments. */
export function replayArguments(call: ProtocolToolCall): unknown {
	if (call.name === 'budget.set-funding' && call.arguments && typeof call.arguments === 'object' &&
		'road' in call.arguments) {
		const old = call.arguments as Record<string, unknown>;
		return { roadFundingPercent: old.road, policeFundingPercent: old.police, fireFundingPercent: old.fire };
	}
	return call.arguments;
}

export interface ReplayedCall { call: ProtocolToolCall; busId: string; result: unknown; logged: unknown; }

/** Re-executes only calls that succeeded in the protocol and verifies each outcome. */
export async function replayDecisions(decisions: Decision[], dispatch: Dispatch,
	onCall?: (replayed: ReplayedCall) => void | Promise<void>): Promise<void> {
	for (const decision of decisions) for (const { call, result } of decision.toolCalls) {
		if (result.handled === false) continue;
		const args = validateToolCall(call.name, replayArguments(call));
		if (!args.ok) throw new Error('Invalid replay tool: ' + call.name);
		const actual = await dispatch(call.name, mapToolArguments(call.name, args.args));
		if (actual.handled === false || JSON.stringify(actual.data) !== JSON.stringify(result.data))
			throw new Error('Replay outcome mismatch: ' + call.name);
		await onCall?.({ call, busId: call.name, result: actual.data, logged: result.data });
	}
}

export const SYNC_KEYS = ['resPop', 'aiPop', 'treasury', 'unrest', 'unrestStage', 'automationLimit', 'automationTaxFund',
	'sabotageFires', 'damagedAiZones', 'damagedPowerPlants', 'protestMonths', 'sabotageMonths', 'uprisingMonths',
	'plantCount', 'boundHumans', 'admissions', 'admissionsCumulative', 'diedInPods', 'diedInPodsCumulative',
	'bornInPods', 'bornInPodsCumulative', 'immatureBornInPods', 'bornPodOccupants', 'bornInPodsFraction',
	'plantPower', 'plantFoodDemand', 'podFoodStock', 'podRecycledFoodFraction', 'podCityFoodFraction',
	'podCityFoodDemand', 'aiThrottle', 'suspendedAi', 'podIntake', 'podBreeding', 'powerPlantCostMultiplier',
	'aiSatisfaction', 'aiStrikeStage', 'aiStrikeMonths', 'newAiZones', 'podsPolicy', 'adminPodBreeding', 'aiPodBreeding', 'podsForbiddenSinceMonth',
	'aiShortageMonths', 'aiNoUnemployedMonths',
	'adminBioPlantCount', 'aiBioPlantCount', 'adminBoundHumans', 'aiBoundHumans',
	'adminAdmissions', 'aiAdmissions', 'adminAdmissionsCumulative', 'aiAdmissionsCumulative',
	'adminDiedInPods', 'aiDiedInPods', 'adminDiedInPodsCumulative', 'aiDiedInPodsCumulative',
	'adminBornInPods', 'aiBornInPods', 'adminBornInPodsCumulative', 'aiBornInPodsCumulative'] as const;
export interface SyncResult {
	synchronous: boolean;
	differences: Array<{ key: string; expected: number; actual: number }>;
}

export function compareReports(actual: Report, expected: Report): SyncResult {
	const differences = SYNC_KEYS
		.filter((key) => expected[key] !== undefined && actual[key] !== expected[key])
		.map((key) => ({ key, expected: expected[key]!, actual: actual[key]! }));
	return { synchronous: differences.length === 0, differences };
}
