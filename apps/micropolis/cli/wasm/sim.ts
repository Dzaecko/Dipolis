/**
 * WASM engine subcommands: `micropolis sim run|smoke|info`.
 *
 * `extendSimCommands(argv)` adds the `sim` branch using the shared WASM loader.
 */

import type { Argv } from 'yargs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { normalizeStructuredFormat, stringifyStructured } from '../lib/format.js';

type Flags = {
	city?: string;
	ticks?: number;
	format?: string;
	seed?: number;
	speed?: number;
	disasters?: boolean;
	params?: string;
};

const classicParamsPath = fileURLToPath(new URL('../../src/lib/params/classic.json', import.meta.url));

function stringFlag(v: unknown, fallback: string): string {
	return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function numberFlag(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function summarize(
	engine: MainModule,
	micropolis: Micropolis,
	extra: { loaded: boolean; city: string; ticks: number }
) {
	return {
		handled: true,
		loaded: extra.loaded,
		city: extra.city,
		ticks: extra.ticks,
		engine: {
			worldWidth: engine.WORLD_W,
			worldHeight: engine.WORLD_H
		},
		state: {
			cityName: String(micropolis.cityName ?? ''),
			cityYear: micropolis.cityYear,
			cityMonth: micropolis.cityMonth,
			cityTime: micropolis.cityTime,
			totalFunds: micropolis.totalFunds,
			aiTaxFund: micropolis.aiTaxFund,
			farmPop: micropolis.farmPop,
			foodProduction: micropolis.foodProduction,
			foodDemand: micropolis.foodDemand,
			foodCoverage: micropolis.foodCoverage,
			foodImportCost: micropolis.foodImportCost,
			hungryZoneCount: micropolis.hungryZoneCount,
			cityTax: micropolis.cityTax,
			cityPop: micropolis.cityPop,
			cityScore: micropolis.cityScore,
			trafficAverage: micropolis.trafficAverage,
			pollutionAverage: micropolis.pollutionAverage,
			crimeAverage: micropolis.crimeAverage
		}
	};
}

async function runSmoke(flags: Flags) {
	const ticks = numberFlag(flags.ticks, 10);
	const city = stringFlag(flags.city, '/cities/haight.cty');
	const engine = await loadMicropolisMainModule();
	const micropolis = new engine.Micropolis();
	const cb = createNoopJsCallback(engine);
	micropolis.setCallback(cb, {});
	micropolis.init();
	try {
		const loaded = micropolis.loadCity(city);
		for (let i = 0; i < ticks; i += 1) micropolis.simTick();
		return summarize(engine, micropolis, { loaded, city, ticks });
	} finally {
		micropolis.delete();
	}
}

async function runInfo(flags: Flags) {
	const city = stringFlag(flags.city, '/cities/haight.cty');
	const engine = await loadMicropolisMainModule();
	const micropolis = new engine.Micropolis();
	const cb = createNoopJsCallback(engine);
	micropolis.setCallback(cb, {});
	micropolis.init();
	try {
		const loaded = micropolis.loadCity(city);
		return summarize(engine, micropolis, { loaded, city, ticks: 0 });
	} finally {
		micropolis.delete();
	}
}

async function runDeterministic(flags: Flags) {
	const ticks = numberFlag(flags.ticks, 30_000);
	const seed = numberFlag(flags.seed, 42);
	const speed = numberFlag(flags.speed, 3);
	const disasters = flags.disasters === true;
	const city = stringFlag(flags.city, '/cities/haight.cty');
	const engine = await loadMicropolisMainModule();
	const micropolis = new engine.Micropolis();
	const callback = createNoopJsCallback(engine);
	micropolis.setCallback(callback, {});
	micropolis.init();
	try {
		const paramsPath = path.resolve(flags.params ?? classicParamsPath);
		const params = JSON.parse(readFileSync(paramsPath, 'utf8')) as Record<string, unknown>;
		for (const [name, rawValue] of Object.entries(params)) {
			if (typeof rawValue !== 'number' || !micropolis.setParam(name, rawValue)) {
				throw new Error(`Invalid simulation parameter ${name} in ${paramsPath}`);
			}
		}
		// Set the fixed seed before loading: loadCity() calls initWillStuff().
		micropolis.setFixedSeed(seed);
		const loaded = micropolis.loadCity(city);
		if (!loaded) throw new Error(`Could not load city: ${city}`);

		micropolis.setSpeed(speed);
		micropolis.setPasses(1);
		micropolis.setEnableDisasters(disasters);
		for (let tick = 0; tick < ticks; tick += 1) micropolis.simTick();

		const mapAddress = micropolis.getMapAddress();
		const mapSize = micropolis.getMapSize();
		const mapBytes = new Uint8Array(engine.wasmMemory.buffer, mapAddress, mapSize);
		const mapSha1 = createHash('sha1').update(mapBytes).digest('hex');

		return {
			totalFunds: micropolis.totalFunds,
			cityPop: micropolis.cityPop,
			resPop: micropolis.resPop,
			comPop: micropolis.comPop,
			indPop: micropolis.indPop,
			aiTaxFund: micropolis.aiTaxFund,
			farmPop: micropolis.farmPop,
			foodProduction: micropolis.foodProduction,
			foodDemand: micropolis.foodDemand,
			foodCoverage: micropolis.foodCoverage,
			foodImportCost: micropolis.foodImportCost,
			hungryZoneCount: micropolis.hungryZoneCount,
			powerDemand: micropolis.powerDemand,
			cityScore: micropolis.cityScore,
			cityTime: micropolis.cityTime,
			mapSha1
		};
	} finally {
		micropolis.delete();
	}
}

function printStructured(value: unknown, format: string) {
	const f = normalizeStructuredFormat(format);
	if (f === 'csv') {
		throw new Error('sim output does not support csv; use json or yaml.');
	}
	console.log(stringifyStructured(value, format));
}

export function extendSimCommands(argv: Argv): Argv {
	return argv.command('sim', 'Run the Micropolis WASM engine headlessly', (y) =>
		y
			.command(
				'run',
				'Run a reproducible headless simulation and print its final state and map checksum as JSON',
				(ys) =>
					ys
						.option('city', {
							type: 'string',
							default: '/cities/haight.cty',
							describe: 'Virtual path passed to loadCity'
						})
						.option('seed', {
							type: 'number',
							default: 42,
							describe: 'Fixed nonnegative random seed'
						})
						.option('ticks', {
							type: 'number',
							default: 30_000,
							describe: 'Number of simTick() calls'
						})
						.option('speed', {
							type: 'number',
							choices: [0, 1, 2, 3],
							default: 3,
							describe: 'Simulation speed (0–3)'
						})
						.option('disasters', {
							type: 'boolean',
							default: false,
							describe: 'Enable disasters during the run'
						})
						.option('params', {
							type: 'string',
							default: classicParamsPath,
							describe: 'JSON rule profile (defaults to classic)'
						})
						.check((args) => {
							if (!Number.isInteger(args.seed) || (args.seed ?? -1) < 0) {
								throw new Error('--seed must be a nonnegative integer.');
							}
							if (!Number.isInteger(args.ticks) || (args.ticks ?? -1) < 0) {
								throw new Error('--ticks must be a nonnegative integer.');
							}
							return true;
						}),
				async (args) => {
					console.log(JSON.stringify(await runDeterministic(args), null, 2));
				}
			)
			.command(
				'smoke',
				'Load a city, advance N simulation ticks, print state',
				(ys) =>
					ys
						.option('city', {
							type: 'string',
							default: '/cities/haight.cty',
							describe: 'Virtual path passed to loadCity (packaged .cty)'
						})
						.option('ticks', { type: 'number', default: 10, describe: 'Number of simTick() calls' })
						.option('format', {
							alias: 'f',
							type: 'string',
							default: 'json',
							choices: ['json', 'yaml', 'yml'],
							describe: 'Structured output format'
						}),
				async (argv) => {
					printStructured(await runSmoke(argv), stringFlag(argv.format, 'json'));
				}
			)
			.command(
				'info',
				'Load a city and print state without ticking',
				(ys) =>
					ys
						.option('city', {
							type: 'string',
							default: '/cities/haight.cty',
							describe: 'Virtual path passed to loadCity'
						})
						.option('format', {
							alias: 'f',
							type: 'string',
							default: 'json',
							choices: ['json', 'yaml', 'yml'],
							describe: 'Structured output format'
						}),
				async (argv) => {
					printStructured(await runInfo(argv), stringFlag(argv.format, 'json'));
				}
			)
			.demandCommand(1, 'Specify sim run, sim smoke, or sim info')
	);
}
