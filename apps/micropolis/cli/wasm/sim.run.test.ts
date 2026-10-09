import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), 'cli/entry.ts');
const tsxPath = path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
const baselinePath = new URL('./sim-run-baselines.json', import.meta.url);
const classicParamsPath = fileURLToPath(new URL('../../src/lib/params/classic.json', import.meta.url));
const coexistenceParamsPath = fileURLToPath(new URL('../../src/lib/params/koexistenz.json', import.meta.url));

interface SimRunResult {
	totalFunds: number;
	cityPop: number;
	resPop: number;
	comPop: number;
	indPop: number;
	aiTaxFund: number;
	farmPop: number;
	foodProduction: number;
	foodDemand: number;
	foodCoverage: number;
	foodImportCost: number;
	hungryZoneCount: number;
	automationShare: number;
	unemploymentRate: number;
	welfareCost: number;
	baselineResPop: number;
	gainedResPop: number;
	lostToPower: number;
	lostToHunger: number;
	lostToDemand: number;
	yearlyFinance: Array<{
		year: number;
		taxFund: number;
		aiTaxFund: number;
		roadFund: number;
		policeFund: number;
		fireFund: number;
		foodImportCost: number;
		welfareCost: number;
		cashFlow: number;
	}>;
	powerDemand: number;
	cityScore: number;
	cityTime: number;
	mapSha1: string;
}

interface SimRunBaselines {
	seed: number;
	ticks: number;
	speed: number;
	disasters: boolean;
	cities: Record<string, SimRunResult>;
}

const baselines = JSON.parse(readFileSync(baselinePath, 'utf8')) as SimRunBaselines;

async function runSim(city: string, seed = 42, paramsPath = classicParamsPath, ticks = baselines.ticks): Promise<SimRunResult> {
	const args = [
		cliPath,
		'sim',
		'run',
		'--city',
		city,
		'--seed',
		String(seed),
		'--ticks',
		String(ticks),
		'--speed',
		String(baselines.speed),
		'--params',
		paramsPath,
		baselines.disasters ? '--disasters' : '--no-disasters'
	];
	const { stdout } = await execFileAsync(process.execPath, [tsxPath, ...args], {
		cwd: process.cwd(),
		timeout: 120_000,
		maxBuffer: 1024 * 1024
	});
	return JSON.parse(stdout) as SimRunResult;
}

describe('headless deterministic simulation CLI', () => {
	it(
		'sim run produces identical output in two separate processes with seed 42',
		async () => {
			const first = await runSim('/cities/haight.cty');
			const second = await runSim('/cities/haight.cty');
			expect(second).toEqual(first);
		},
		120_000
	);

	it('sim run loads the selected JSON rule profile', async () => {
		const result = await runSim('/cities/haight.cty', 42, coexistenceParamsPath, 30_000);
		expect(result.foodDemand).toBeGreaterThan(0);
		expect(result.foodCoverage).toBeGreaterThan(0.9);
		expect(result.foodImportCost).toBeGreaterThan(0);
		expect(result.yearlyFinance.length).toBeGreaterThan(0);
		for (const year of result.yearlyFinance) {
			expect(Object.keys(year).sort()).toEqual([
				'aiTaxFund', 'cashFlow', 'fireFund', 'foodImportCost', 'policeFund', 'roadFund', 'taxFund', 'welfareCost', 'year',
			].sort());
		}
	}, 120_000);

	it(
		'a different seed produces a different map checksum',
		async () => {
			const baseline = await runSim('/cities/haight.cty', 42);
			const differentSeed = await runSim('/cities/haight.cty', 43);
			expect(differentSeed.mapSha1).not.toBe(baseline.mapSha1);
		},
		120_000
	);

	it(
		'matches committed deterministic baselines for three packaged cities',
		async () => {
			for (const [city, expected] of Object.entries(baselines.cities)) {
				const actual = await runSim(city);
				for (const key of Object.keys(expected) as Array<keyof SimRunResult>) {
					expect(actual[key], `${city}.${key}`).toEqual(expected[key]);
				}
			}
		},
		120_000
	);
});