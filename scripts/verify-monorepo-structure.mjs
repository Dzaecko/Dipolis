#!/usr/bin/env node
/**
 * Verify Dipolis's explicit workspace inventory and runtime dependency closure.
 * Run `pnpm run verify:structure` from the repository root. Internal engine and
 * renderer package names remain @micropolis/* to preserve their public APIs.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventory = new Map([
	['apps/dipolis', 'dipolis'],
	['packages/micropolis-engine', '@micropolis/engine-wasm'],
	['packages/render-core', '@micropolis/render-core'],
	['packages/tile-renderer', '@micropolis/tile-renderer'],
]);
const failures = [];
const passes = [];

function check(label, fn) {
	try {
		const detail = fn();
		passes.push(detail ? `${label}: ${detail}` : label);
	} catch (err) {
		failures.push(`${label}: ${err.message}`);
	}
}

function readText(path) {
	return readFileSync(join(repoRoot, path), 'utf8');
}

function readJson(path) {
	return JSON.parse(readText(path));
}

check('workspace contains exactly Dipolis and its engine/renderers', () => {
	const declarations = [...readText('pnpm-workspace.yaml').matchAll(/^\s*-\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/gm)]
		.map((match) => match[1]);
	const expected = [...inventory.keys()];
	if (declarations.length !== expected.length || expected.some((path) => !declarations.includes(path))) {
		throw new Error(`expected ${expected.join(', ')}; got ${declarations.join(', ')}`);
	}
	return declarations.join(', ');
});

const workspacePackages = new Map();
for (const [path, name] of inventory) {
	check(`${path} has package name ${name}`, () => {
		const pkg = readJson(`${path}/package.json`);
		if (pkg.name !== name) throw new Error(`got ${JSON.stringify(pkg.name)}`);
		if (workspacePackages.has(pkg.name)) throw new Error(`duplicate package ${pkg.name}`);
		workspacePackages.set(pkg.name, { path, pkg });
	});
}

check('application and package directories contain only the retained inventory', () => {
	for (const root of ['apps', 'packages']) {
		const remaining = readdirSync(join(repoRoot, root), { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !inventory.has(`${root}/${entry.name}`))
			.map((entry) => `${root}/${entry.name}`);
		if (remaining.length) throw new Error(`unexpected directories: ${remaining.join(', ')}`);
	}
});

check('every workspace dependency resolves inside the retained inventory', () => {
	const issues = [];
	for (const { path, pkg } of workspacePackages.values()) {
		for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
			for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
				if (typeof spec === 'string' && spec.startsWith('workspace:') && !workspacePackages.has(name)) {
					issues.push(`${path} ${section}: ${name}@${spec}`);
				}
			}
		}
	}
	if (issues.length) throw new Error(issues.join('; '));
});

check('Dipolis retains all three runtime workspace dependencies', () => {
	const pkg = readJson('apps/dipolis/package.json');
	const deps = { ...pkg.devDependencies, ...pkg.dependencies };
	for (const name of [...inventory.values()].filter((name) => name !== 'dipolis')) {
		if (deps[name] !== 'workspace:*') throw new Error(`missing ${name}@workspace:*`);
	}
	if (!pkg.scripts?.prebuild?.includes('@micropolis/engine-wasm')) {
		throw new Error('prebuild must build @micropolis/engine-wasm before Vite');
	}
});

check('engine package exposes build and clean scripts', () => {
	const pkg = readJson('packages/micropolis-engine/package.json');
	if (!pkg.scripts?.build || !pkg.scripts?.clean) throw new Error('missing build or clean script');
});

check('engine preload retains Micropolis city assets', () => {
	if (!readText('packages/micropolis-engine/makefile').includes('../../content/micropolis/cities')) {
		throw new Error('missing ../../content/micropolis/cities preload');
	}
	const files = readdirSync(join(repoRoot, 'content/micropolis/cities')).filter((name) => name.endsWith('.cty'));
	if (!files.length) throw new Error('no .cty files');
	return `${files.length} .cty files`;
});

check('engine installs WASM and generated types into Dipolis', () => {
	const makefile = readText('packages/micropolis-engine/makefile');
	for (const path of ['../../apps/dipolis/src/lib', '../../apps/dipolis/src/types']) {
		if (!makefile.includes(path)) throw new Error(`missing install target ${path}`);
	}
	if (makefile.includes('../../apps/micropolis/')) throw new Error('obsolete app install target');
});

check('upstream licenses and notices remain available', () => {
	for (const path of ['LICENSE', 'MicropolisGPLLicenseNotice.md', 'MicropolisPublicNameLicense.md']) {
		if (!statSync(join(repoRoot, path)).isFile()) throw new Error(`${path} is not a file`);
	}
});

console.log('== Dipolis dependency inventory verification ==');
for (const pass of passes) console.log(`  PASS  ${pass}`);
if (failures.length) {
	for (const failure of failures) console.error(`  FAIL  ${failure}`);
	console.error(`\n${failures.length} failure(s), ${passes.length} pass(es).`);
	process.exit(1);
}
console.log(`\nAll ${passes.length} checks passed.`);
