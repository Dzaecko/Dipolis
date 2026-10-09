import { beforeEach, describe, expect, it } from 'vitest';
import { commandBus } from './CommandBus';
import { registerMicropolisCommands } from './micropolisCommands';
import type { MicropolisSimulator } from './MicropolisSimulator';

describe('power priority command', () => {
	beforeEach(() => registerMicropolisCommands());

	it('dispatches power.set-priority to the engine and reads back the selected value', async () => {
		const params = new Map<string, number>([['powerPriority', 0]]);
		const engine = {
			setParam: (name: string, value: number) => { params.set(name, value); return true; },
			getParam: (name: string) => params.get(name) ?? Number.NaN,
		};
		const simulator = { micropolis: engine } as unknown as MicropolisSimulator;
		const result = await commandBus.dispatch('power.set-priority', {
			source: 'button',
			simulator,
			args: { priority: 2 },
		});

		expect(result.handled).not.toBe(false);
		expect(engine.getParam('powerPriority')).toBe(2);
	});

	it('rejects values outside the three supported priorities', async () => {
		const engine = {
			powerPriority: 0,
			setParam: () => false,
			getParam: (_name: string) => 0,
		};
		const simulator = { micropolis: engine } as unknown as MicropolisSimulator;
		const result = await commandBus.dispatch('power.set-priority', {
			source: 'button',
			simulator,
			args: { priority: 3 },
		});

		expect(result.handled).toBe(false);
		expect(engine.getParam('powerPriority')).toBe(0);
	});
});

describe('food import command', () => {
	beforeEach(() => registerMicropolisCommands());

	it('updates the engine setting and synchronizes the HUD state', async () => {
		const params = new Map<string, number>([['foodImportEnabled', 0]]);
		const engine = {
			setParam: (name: string, value: number) => { params.set(name, value); return true; },
			getParam: (name: string) => params.get(name) ?? Number.NaN,
		};
		const simulator = { micropolis: engine } as unknown as MicropolisSimulator;
		let synced = false;
		const result = await commandBus.dispatch('food.set-import', {
			source: 'button',
			simulator,
			syncFoodState: () => { synced = true; },
			args: { enabled: true },
		});

		expect(result.handled).not.toBe(false);
		expect(engine.getParam('foodImportEnabled')).toBe(1);
		expect(synced).toBe(true);
	});

	it('rejects non-boolean values', async () => {
		const engine = { setParam: () => false, getParam: (_name: string) => 0 };
		const simulator = { micropolis: engine } as unknown as MicropolisSimulator;
		const result = await commandBus.dispatch('food.set-import', {
			source: 'button',
			simulator,
			args: { enabled: 1 },
		});

		expect(result.handled).toBe(false);
	});
});
