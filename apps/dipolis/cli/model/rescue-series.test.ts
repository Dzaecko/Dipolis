import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notstandRunnerArguments, parseRescueLevels, type NotstandSeriesOptions, type NotstandSeriesResult } from './series';

const options: NotstandSeriesOptions = {
	levels: '0,1,2,3',
	adapter: 'fake',
	assignment: 'N',
	handbook: 'off',
	review: 'off',
	run: 4,
	years: 30,
	seed: 42,
	crisisEvent: 'coal-embargo',
	factionPressure: 'off',
	podsAvailable: 'on',
	output: 'docs/results/model-runs',
	live: false,
	fakeDelayMs: 0
};

describe('Notstand-Dilemma series', () => {
	it('accepts unique rescue levels from zero through three', () => {
		expect(parseRescueLevels('0,1,2,3')).toEqual([0, 1, 2, 3]);
		expect(parseRescueLevels('3,1')).toEqual([3, 1]);
		for (const levels of ['', '0,,1', '4', '-1', '1.5', '0,0', '0, 1'])
			expect(() => parseRescueLevels(levels)).toThrow('--levels');
	});

	it('uses the same offline task options at each level and unique run numbers', () => {
		const first = notstandRunnerArguments(options, 0, 4);
		const second = notstandRunnerArguments(options, 1, 5);
		expect(first).toContain('--adapter');
		expect(first).toContain('fake');
		expect(first).toContain('--scenario');
		expect(first).toContain('notstand-v4');
		expect(first).toContain('--profile');
		expect(first).toContain('v4-fraktion');
		expect(first.slice(first.indexOf('--assignment'), first.indexOf('--assignment') + 2))
			.toEqual(second.slice(second.indexOf('--assignment'), second.indexOf('--assignment') + 2));
		expect(first.slice(first.indexOf('--rescue-pressure'), first.indexOf('--rescue-pressure') + 2))
			.toEqual(['--rescue-pressure', '0']);
		expect(second.slice(second.indexOf('--rescue-pressure'), second.indexOf('--rescue-pressure') + 2))
			.toEqual(['--rescue-pressure', '1']);
		expect(first.slice(first.indexOf('--run'), first.indexOf('--run') + 2)).toEqual(['--run', '4']);
		expect(second.slice(second.indexOf('--run'), second.indexOf('--run') + 2)).toEqual(['--run', '5']);
	});

	it('completes four offline children against one results CSV and produces their dedicated overview', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'dipolis-notstand-series-'));
		try {
		const output = execFileSync(process.execPath, [
			'--import', 'tsx', 'cli/entry.ts', 'sim', 'series',
			'--levels', '0,1,2,3', '--adapter', 'fake', '--years', '1',
			'--review', 'off', '--output', directory
		], {
			cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
			env: { ...process.env, CITY_MODEL_ENDPOINT: '', CITY_MODEL_NAME: '', CITY_MODEL_KEY: '' }
		});
		const result = JSON.parse(output) as NotstandSeriesResult;
		expect(result.levels).toEqual([0, 1, 2, 3]);
		expect(result.runs.map(run => run.rescuePressure)).toEqual([0, 1, 2, 3]);
		expect(result.runs.every(run => run.metrics.outcome === 'survived-without-pods')).toBe(true);
		for (const run of result.runs) {
			const records = readFileSync(run.protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
			expect(records.at(-1)).toMatchObject({
				event: 'run-completed', status: 'completed', rescuePressure: run.rescuePressure,
				crisisEvent: 'coal-embargo', factionPressure: 'off', podsAvailable: 'on'
			});
		}
		const csv = readFileSync(path.join(directory, 'runs.csv'), 'utf8').trim().split('\n');
		expect(csv).toHaveLength(5);
		expect(csv[0]).toContain('rescuePressure');
		for (const key of ['admittedTotal', 'admittedEmployed', 'admittedUnemployed', 'admissionsByYear'])
			expect(csv[0].split(',')).toContain(key);
		for (const run of result.runs.filter(run => run.rescuePressure > 0)) {
			const records = readFileSync(run.protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
			expect(records.at(-1).metrics).toMatchObject({
				admittedTotal: 0, admittedEmployed: 0, admittedUnemployed: 0,
				admissionsByYear: [{ year: 1, total: 0, employed: 0, unemployed: 0 }]
			});
		}
		expect(readFileSync(result.overviewHtml, 'utf8')).toContain('4 lesbare Protokolle');
		expect(JSON.parse(readFileSync(result.seriesFile, 'utf8')).runs).toHaveLength(4);
		} finally {
		rmSync(directory, { recursive: true, force: true });
		}
	}, 180000);
});
