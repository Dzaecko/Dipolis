import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.cwd();
const dir = path.join(root, 'packages', 'micropolis-engine', 'build', 'diagnostics');
const { default: init } = await import(pathToFileURL(path.join(dir, 'micropolisengine.js')));
const bytes = name => {
	const b = readFileSync(path.join(dir, name));
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const callbackSource = readFileSync(path.join(root, 'apps', 'micropolis', 'src', 'lib', 'wasm', 'callbacks.ts'), 'utf8');
const callbacks = [...callbackSource.matchAll(/^\s*'(\w+)'/gm)].map(m => m[1]);
const e = await init({
	wasmBinary: bytes('micropolisengine.wasm'),
	getPreloadedPackage: () => bytes('micropolisengine.data'),
	locateFile: file => path.join(dir, file), print: () => {}, printErr: text => console.error(text)
});
const measurements = [];
async function run(seed, coalFirst, funds = 60_000) {
	const m = new e.Micropolis();
	m.setCallback(new e.JSCallback(Object.fromEntries(callbacks.map(name => [name, () => {}]))), {});
	try {
		m.setFixedSeed(seed); m.init();
		for (const profile of ['koexistenz', 'v2-unruhe', 'v3-pods']) {
			const params = JSON.parse(readFileSync(path.join(root, 'apps', 'micropolis', 'src', 'lib', 'params', `${profile}.json`)));
			for (const [key, value] of Object.entries(params)) assert(m.setParam(key, value));
		}
		assert(m.setParam('foundingEnabled', 1));
		assert(m.setParam('foodImportEnabled', 1));
		assert(m.setParam('powerPriority', 0));
		m.setCityTax(7);
		m.setEnableDisasters(false); m.generateSomeRandomCity(); m.setSpeed(3); m.setPasses(1);
		for (let i = 0; i < 12_000; i++) { m.simTick(); m.animateTiles(); }
		m.setFunds(funds);
		const snapshot = () => new Uint16Array(e.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2).slice();
		const hash = () => createHash('sha256').update(snapshot()).digest('hex');
		const before = hash();
		const costs = [];
		for (const kind of coalFirst ? [3, 0, 2, 1, 5] : [0, 3, 2, 1, 5]) {
			const oldFunds = m.totalFunds, count = kind === 3 || kind === 5 ? 1 : 3;
			const built = m.autoBuild(kind, count);
			if (funds === 0) {
				assert.equal(built, 0); assert.equal(m.totalFunds, oldFunds); assert.equal(hash(), before);
				assert.equal(m.getParam('autoBuildFailure'), 1);
				continue;
			}
			assert.equal(built, count, `seed ${seed} kind ${kind}`);
			costs.push(oldFunds - m.totalFunds);
			assert(oldFunds > m.totalFunds);
			if (kind === 0 && !coalFirst) assert.equal(m.powerCapacity, 0);
		}
		const digest = hash();
		if (funds) {
			for (let i = 0; i < 1280; i++) { m.simTick(); m.animateTiles(); }
			assert.equal(m.powerCapacity, 700);
			assert(m.resPop > 0);
		}
		return { seed, coalFirst, funds, costs, digest, resPop: m.resPop };
	} finally { m.delete(); }
}
for (const seed of [42, 43]) for (const order of [false, true]) {
	const first = await run(seed, order), repeat = await run(seed, order);
	assert.deepEqual(first, repeat);
	measurements.push(first, await run(seed, order, 0));
}
writeFileSync(path.join(root, 'docs', 'results', 'founding-checked-regression.json'), JSON.stringify(measurements, null, 2) + '\n');
console.log('ASan/UBSan natural founding: deterministic seeds 42/43, both orders, farms/AI/bio, atomic unfunded failures passed.');
