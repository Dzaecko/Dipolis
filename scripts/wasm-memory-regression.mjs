import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(`--${name}`);
	return index < 0 ? fallback : args[index + 1];
};
const enginePath = path.resolve(root, option('engine', 'apps/dipolis/src/lib/micropolisengine.js'));
const ticks = Number(option('ticks', '40000'));
const firstSeed = Number(option('start-seed', '0'));
const runs = Number(option('runs', '200'));
const profile = option('profile', 'classic');
if (!['classic', 'koexistenz', 'v2-unruhe', 'v3-pods'].includes(profile)) throw new Error('Invalid profile');
const unrestStress = args.includes('--unrest-stress');
for (const [name, value] of Object.entries({ ticks, firstSeed, runs })) {
	if (!Number.isSafeInteger(value) || value < 0 || (name !== 'firstSeed' && value === 0)) {
		throw new Error(`Invalid ${name}: ${value}`);
	}
}
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const buffer = (file) => {
	const bytes = readFileSync(file);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

if (args.includes('--worker')) {
	let completedTicks = 0;
	let sim;
	try {
		const { default: initModule } = await import(pathToFileURL(enginePath).href);
		const moduleArgs = {
			print: () => {}, printErr: (text) => console.error(text), setStatus: () => {},
			locateFile: (file) => path.join(path.dirname(enginePath), file),
			wasmBinary: buffer(enginePath.replace(/\.js$/, '.wasm')),
			getPreloadedPackage: () => buffer(enginePath.replace(/\.js$/, '.data')),
		};
		let engine;
		try {
			engine = await initModule(moduleArgs);
		} catch (error) {
			if (!/node environment detected but not enabled|not compiled for this environment|XMLHttpRequest is not defined/.test(String(error))) throw error;
			const previousProcess = globalThis.process;
			globalThis.window = { encodeURIComponent, location: { pathname: '/' } };
			globalThis.process = undefined;
			try { engine = await initModule(moduleArgs); }
			finally { globalThis.process = previousProcess; delete globalThis.window; }
		}
		sim = new engine.Micropolis();
		const callbackSource = readFileSync(path.join(root, 'apps/dipolis/src/lib/wasm/callbacks.ts'), 'utf8');
		const methods = [...callbackSource.matchAll(/^\s*'(\w+)'/gm)].map((match) => match[1]);
		const callback = new engine.JSCallback(Object.fromEntries(methods.map((name) => [name, () => {}])));
		sim.setCallback(callback, {});
		sim.init();
		const extended = profile === 'v2-unruhe' || profile === 'v3-pods';
		const params = JSON.parse(readFileSync(path.join(root, `apps/dipolis/src/lib/params/${extended ? 'koexistenz' : profile}.json`), 'utf8'));
		if (extended) Object.assign(params, JSON.parse(readFileSync(path.join(root, 'apps/dipolis/src/lib/params/v2-unruhe.json'), 'utf8')));
		if (profile === 'v3-pods') Object.assign(params, JSON.parse(readFileSync(path.join(root, 'apps/dipolis/src/lib/params/v3-pods.json'), 'utf8')));
		for (const [name, value] of Object.entries(params)) {
			if (!sim.setParam(name, value)) throw new Error(`Invalid classic parameter ${name}`);
		}
		sim.setFixedSeed(firstSeed);
		if (!sim.loadCity('/cities/haight.cty')) throw new Error('Haight failed to load');
		if (unrestStress) {
			if (!extended) throw new Error('Unrest stress requires v2-unruhe or v3-pods');
			sim.autoBuild(1, 20);
			sim.unrest = 100;
			sim.setParam('unrestInertia', 0);
			sim.setParam('unrestUprisingProbability', 1);
			if (profile === 'v3-pods') {
				sim.setFunds(600000);
				sim.autoBuild(5, 2);
				sim.setParam('podIntake', 2);
				sim.setParam('podBreeding', 1);
				sim.setParam('aiThrottle', .5);
			}
		}
		sim.setSpeed(3);
		sim.setPasses(1);
		sim.setEnableDisasters(true);
		for (; completedTicks < ticks; completedTicks++) sim.simTick();
		const state = {
			cityTime: sim.cityTime, cityPop: sim.cityPop, totalFunds: sim.totalFunds,
			mapSha1: createHash('sha1').update(new Uint8Array(engine.wasmMemory.buffer, sim.getMapAddress(), sim.getMapSize())).digest('hex'),
		};
		sim.delete();
		sim = undefined;
		console.log(JSON.stringify({ seed: firstSeed, completedTicks, status: 'passed', ...state }));
	} catch (error) {
		console.error(error.stack ?? error);
		console.log(JSON.stringify({ seed: firstSeed, completedTicks, failedTick: completedTicks + 1, status: 'failed', error: String(error) }));
		process.exitCode = 1;
	}
} else {
	const output = path.resolve(root, option('output', 'docs/results/wasm-memory-acceptance'));
	mkdirSync(path.dirname(output), { recursive: true });
	const startedAt = new Date().toISOString();
	const start = performance.now();
	const results = [];
	for (let seed = firstSeed; seed < firstSeed + runs; seed++) {
		const runStart = performance.now();
		const child = spawnSync(process.execPath, [
			fileURLToPath(import.meta.url), '--worker', '--engine', enginePath,
			'--ticks', String(ticks), '--start-seed', String(seed),
			'--profile', profile, ...(unrestStress ? ['--unrest-stress'] : []),
		], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 600_000 });
		const line = child.stdout?.trim().split(/\r?\n/).findLast((line) => line.startsWith('{"seed":'));
		const result = line ? JSON.parse(line) : { seed, completedTicks: null, status: 'failed', error: String(child.error ?? `exit ${child.status}`) };
		result.exitCode = child.status;
		result.elapsedMs = Math.round(performance.now() - runStart);
		if (child.status !== 0) result.status = 'failed';
		if (child.stderr) result.diagnostics = child.stderr;
		results.push(result);
		writeFileSync(`${output}.json`, JSON.stringify({
			startedAt, finishedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start),
			node: process.version, platform: `${process.platform}-${process.arch}`,
			engine: path.relative(root, enginePath), engineSha256: sha256(enginePath),
			wasmSha256: sha256(enginePath.replace(/\.js$/, '.wasm')),
			city: 'haight.cty', citySha256: sha256(path.join(root, 'content/micropolis/cities/haight.cty')),
			profile, unrestStress, disasters: true, speed: 3, passes: 1, ticksPerRun: ticks,
			requestedRuns: runs, completedRuns: results.length,
			passedRuns: results.filter((run) => run.status === 'passed').length,
			completedTicks: results.reduce((sum, run) => sum + (run.completedTicks ?? 0), 0), results,
		}, null, 2) + '\n');
		writeFileSync(`${output}.csv`, 'seed,status,completedTicks,failedTick,elapsedMs,cityTime,cityPop,totalFunds,mapSha1\n' +
			results.map((run) => ['seed', 'status', 'completedTicks', 'failedTick', 'elapsedMs', 'cityTime', 'cityPop', 'totalFunds', 'mapSha1'].map((key) => run[key] ?? '').join(',')).join('\n') + '\n');
		console.log(`seed ${seed}: ${result.status}, ${result.completedTicks ?? '?'} ticks, ${result.elapsedMs} ms`);
		if (result.status !== 'passed' && args.includes('--stop-on-failure')) break;
	}
	if (results.length !== runs || results.some((run) => run.status !== 'passed')) process.exitCode = 1;
}
