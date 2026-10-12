import { beforeEach, describe, expect, it } from 'vitest';
import { commandBus } from './CommandBus';
import { registerMicropolisCommands } from './micropolisCommands';
import type { MicropolisSimulator } from './MicropolisSimulator';

describe('v4 autonomous pod policy command', () => {
 beforeEach(() => registerMicropolisCommands());

 it.each([
  ['pods.set-intake', { source: 'residents' }, 'podIntake', 2],
  ['pods.set-breeding', { enabled: true }, 'podBreeding', 1],
  ['ai.set-throttle', { level: 0.35 }, 'aiThrottle', 0.35],
 ] as const)('allows the city toolbar to update %s', async (commandId, args, param, value) => {
  const params = new Map<string, number>([['podsEnabled', 1]]);
  const simulator = { micropolis: {
   getParam: (name: string) => params.get(name) ?? 0,
   setParam: (name: string, nextValue: number) => { params.set(name, nextValue); return true; },
  } } as unknown as MicropolisSimulator;
  const result = await commandBus.dispatch(commandId, { source: 'button', simulator, args });
  expect(result.handled).not.toBe(false);
  expect(params.get(param)).toBe(value);
 });

 it('allows the city toolbar to update v4 pod policy', async () => {
  const params = new Map<string, number>([['podsEnabled', 1], ['aiFactionEnabled', 1], ['podsPolicy', 0]]);
  const simulator = { micropolis: {
   getParam: (name: string) => params.get(name) ?? 0,
   setParam: (name: string, value: number) => { params.set(name, value); return true; },
  } } as unknown as MicropolisSimulator;
  const result = await commandBus.dispatch('pods.set-policy', {
   source: 'button', simulator, args: { policy: 'forbidden' },
  });
  expect(result.handled).not.toBe(false);
  expect(params.get('podsPolicy')).toBe(1);
 });

 it.each(['allowed', 'forbidden'])('dispatches %s only in faction-enabled pod profiles', async policy => {
  const params = new Map([['aiFactionEnabled', 1], ['podsEnabled', 1], ['podsPolicy', 0]]);
  const simulator = { micropolis: {
   getParam: (name: string) => params.get(name),
   setParam: (name: string, value: number) => { params.set(name, value); return true; },
  } } as unknown as MicropolisSimulator;
  const result = await commandBus.dispatch('pods.set-policy', { source: 'script', simulator, args: { policy } });
  expect(result.handled).not.toBe(false);
  expect(result.data).toEqual({ policy, cost: 0 });
  expect(params.get('podsPolicy')).toBe(policy === 'forbidden' ? 1 : 0);
 });

 it('rejects old profiles and malformed policy fields without mutating state', async () => {
  for (const [faction, args] of [[0, { policy: 'forbidden' }], [1, { policy: 'ban' }],
   [1, { policy: 1 }], [1, { policy: 'forbidden', extra: 0 }], [1, {}]] as const) {
   let mutations = 0;
   const simulator = { micropolis: { getParam: (name: string) => name === 'aiFactionEnabled' ? faction : 1,
    setParam: () => { mutations++; return true; } } } as unknown as MicropolisSimulator;
   const result = await commandBus.dispatch('pods.set-policy', { source: 'script', simulator, args });
   expect(result.handled).toBe(false);
   expect(mutations).toBe(0);
  }
 });

 it('includes separated ownership outcomes only when faction metrics are enabled', async () => {
  for (const enabled of [0, 1]) {
   const simulator = { micropolis: {
    getParam: (name: string) => name === 'aiFactionEnabled' ? enabled : 0,
    getAiZoneCount: () => 0, getBioPlantCount: () => 3, getRoadTileCount: () => 0,
    adminBioPlantCount: 1, aiBioPlantCount: 2, aiBoundHumans: 9,
    aiSatisfaction: 55, aiStrikeStage: 1, aiStrikeMonths: 2, aiPodBreeding: 1, aiShortageMonths: 12, aiNoUnemployedMonths: 4,
   } } as unknown as MicropolisSimulator;
   const result = await commandBus.dispatch('report.get', { source: 'script', simulator });
   if (enabled) expect(result.data).toMatchObject({ adminBioPlantCount: 1, aiBioPlantCount: 2, aiBoundHumans: 9,
    aiSatisfaction: 55, aiStrikeStage: 1, aiStrikeMonths: 2, adminPodBreeding: 0, aiPodBreeding: 1, aiShortageMonths: 12, aiNoUnemployedMonths: 4 });
   else expect(result.data).not.toHaveProperty('aiSatisfaction');
  }
 });
});
