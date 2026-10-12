import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(appRoot, '../..');
const appPackage = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

describe('Dipolis workspace dependencies', () => {
	it('depends only on the engine and shared rendering workspace packages', () => {
		const workspaceDependencies = {
			...appPackage.dependencies,
			...appPackage.devDependencies
		};
		const expected = {
			'@micropolis/engine-wasm': 'workspace:*',
			'@micropolis/render-core': 'workspace:*',
			'@micropolis/tile-renderer': 'workspace:*'
		};
		const actual = Object.fromEntries(
			Object.entries(workspaceDependencies).filter(([, version]) => version === 'workspace:*')
		);

		expect(actual).toEqual(expected);
	});

	it.each([
		['@micropolis/engine-wasm', 'packages/micropolis-engine/package.json'],
		['@micropolis/render-core', 'packages/render-core/package.json'],
		['@micropolis/tile-renderer', 'packages/tile-renderer/package.json']
	])('resolves %s to its workspace package', (name, packagePath) => {
		const workspacePackage = JSON.parse(readFileSync(path.join(repoRoot, packagePath), 'utf8')) as {
			name: string;
		};

		expect(workspacePackage.name).toBe(name);
	});
});
