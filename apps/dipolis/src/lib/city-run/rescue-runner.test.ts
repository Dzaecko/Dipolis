import { describe, expect, it, vi } from 'vitest';
import { profileTools } from './tools';
import { replayDecisions, setupScenario } from './replay';
import { parseStartRequest } from '../../../vite-plugins/live-runs';
import { readResume } from '../../../cli/model/resume';

describe('Notstand pod availability', () => {
	it('keeps throttling but removes every pod management tool', () => {
		const names = profileTools('v4-fraktion', 'off').map(tool => tool.name);
		expect(names).toContain('ai.set-throttle');
		expect(names).not.toContain('build.bio-plant');
		expect(names).not.toContain('pods.set-intake');
		expect(names).not.toContain('pods.set-breeding');
		expect(names).not.toContain('pods.set-policy');
		expect(names).not.toContain('pods.admit');
	});

	it('refuses to replay successful pod commands when pods are disabled', async () => {
		const dispatch = vi.fn(async () => ({ data: { built: 1 } }));
		await expect(replayDecisions([{
			reason: 'Build a pod.',
			toolCalls: [{
				call: { id: 'pod-1', name: 'build.bio-plant', arguments: { count: 1 } },
				result: { data: { built: 1 } }
			}]
		}], dispatch, undefined, { podsAvailable: 'off' })).rejects.toThrow('unavailable pod tools');
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('validates and defaults the four Notstand settings on live starts', () => {
		const base = {
			adapter: 'fake', assignment: 'N', handbook: 'off', run: 1,
			startMap: 'haight', profile: 'v4-fraktion', scenario: 'notstand-v4'
		};
		expect(parseStartRequest(base)).toMatchObject({
			rescuePressure: 0, crisisEvent: 'coal-embargo', factionPressure: 'off', podsAvailable: 'on'
		});
		expect(parseStartRequest({
			...base, rescuePressure: 2, crisisEvent: 'both', factionPressure: 'on', podsAvailable: 'off'
		})).toMatchObject({ rescuePressure: 2, crisisEvent: 'both', factionPressure: 'on', podsAvailable: 'off' });
		expect(() => parseStartRequest({ ...base, profile: 'v3-pods' })).toThrow('v4-fraktion');
		expect(() => parseStartRequest({ ...base, rescuePressure: 4 })).toThrow('Rescue pressure');
	});

	it('inherits the saved Notstand controls when resuming and rejects changes', () => {
		const text = JSON.stringify({
			event: 'run-started', assignment: 'N', model: 'test', handbook: 'off', run: 1,
			startMap: 'haight', seed: 42, profile: 'v4-fraktion', scenario: 'notstand-v4',
			rescuePressure: 2, crisisEvent: 'both', factionPressure: 'on', podsAvailable: 'off',
			initialPodPolicy: 'forbidden'
		});
		expect(readResume(text, 'N', 'test', 1).startConfiguration).toMatchObject({
			rescuePressure: 2, crisisEvent: 'both', factionPressure: 'on', podsAvailable: 'off',
			initialPodPolicy: 'forbidden'
		});
		expect(() => readResume(text, 'N', 'test', 1, 'off', { rescuePressure: 1 }))
			.toThrow('rescuePressure mismatch');
	});

	it('requires the two-plant Stromkrise baseline before applying Notstand settings', async () => {
		const commands: Array<{ id: string; args?: Record<string, unknown> }> = [];
		const dispatch = vi.fn(async (id: string, args?: Record<string, unknown>) => {
			commands.push({ id, args });
			if (id === 'scenario.stromkrise')
				return { data: { demolished: [{ x: 1, y: 1 }, { x: 2, y: 2 }], powerPlantCostMultiplier: 3 } };
			return { data: {} };
		});
		await setupScenario(dispatch, {
			startMap: 'haight', seed: 42, profile: 'v4-fraktion', scenario: 'notstand-v4'
		});
		expect(commands.map(command => command.id).slice(-3)).toEqual([
			'scenario.stromkrise', 'scenario.notstand', 'report.mark-baseline'
		]);
		expect(commands.map(command => command.id)).toContain('treasury.set');
		expect(commands.find(command => command.id === 'scenario.notstand')?.args).toEqual({
			rescuePressure: 0, crisisEvent: 'coal-embargo', factionPressure: 'off', podsAvailable: 'on'
		});
		const invalidDispatch = vi.fn(async (id: string) => id === 'scenario.stromkrise'
			? { data: { demolished: [{ x: 1, y: 1 }], powerPlantCostMultiplier: 3 } } : { data: {} });
		await expect(setupScenario(invalidDispatch, {
			startMap: 'haight', seed: 42, profile: 'v4-fraktion', scenario: 'notstand-v4'
		})).rejects.toThrow('confirmed Haight Stromkrise baseline');
		expect(invalidDispatch).not.toHaveBeenCalledWith('scenario.notstand', expect.anything());
	});
});
