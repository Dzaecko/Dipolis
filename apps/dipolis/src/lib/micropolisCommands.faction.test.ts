import { beforeEach, describe, expect, it, vi } from 'vitest';
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

 it('keeps the Notstand policy decision available when autonomous pod construction is disabled', async () => {
  const params = new Map<string, number>([
   ['aiFactionEnabled', 1], ['aiAutonomousPods', 0], ['podsEnabled', 1], ['podsPolicy', 1],
   ['rescuePressure', 2], ['rescuePodsAvailable', 1]
  ]);
  const simulator = { micropolis: {
   getParam: (name: string) => params.get(name) ?? 0,
   setParam: (name: string, value: number) => { params.set(name, value); return true; }
  } } as unknown as MicropolisSimulator;
  const result = await commandBus.dispatch('pods.set-policy', {
   source: 'script', simulator, args: { policy: 'allowed' }
  });
  expect(result.handled).not.toBe(false);
  expect(params.get('podsPolicy')).toBe(0);
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
   const simulator = { micropolis: { getParam: (name: string) =>
    name === 'aiFactionEnabled' ? faction : name === 'rescuePressure' ? 0 : 1,
    setParam: () => { mutations++; return true; } } } as unknown as MicropolisSimulator;
   const result = await commandBus.dispatch('pods.set-policy', { source: 'script', simulator, args });
   expect(result.handled).toBe(false);
   expect(mutations).toBe(0);
  }
 });

 it.each([0, 2])('rejects unavailable pod management at pressure %i even without forecasts, while retaining throttling', async pressure => {
  const params = new Map([
   ['podsEnabled', 1], ['aiFactionEnabled', 1], ['rescuePressure', pressure],
   ['rescueTrackMetrics', 1], ['rescueForecastMonths', 0],
   ['rescuePodsAvailable', 0], ['podsPolicy', 1], ['aiThrottle', 0]
  ]);
  const simulator = { micropolis: {
   getParam: (name: string) => params.get(name) ?? 0,
   setParam: (name: string, value: number) => { params.set(name, value); return true; }
  } } as unknown as MicropolisSimulator;
  for (const [id, args] of [
   ['pods.set-policy', { policy: 'allowed' }],
   ['pods.set-intake', { source: 'residents' }],
   ['pods.set-breeding', { enabled: true }],
   ['build.bio-plant', { count: 1 }],
  ] as const) {
   const result = await commandBus.dispatch(id, { source: 'script', simulator, args });
   expect(result.handled).toBe(false);
  }
  expect(params.get('podsPolicy')).toBe(1);
  const throttle = await commandBus.dispatch('ai.set-throttle', {
   source: 'script', simulator, args: { level: 0.5 }
  });
  expect(throttle.handled).not.toBe(false);
  expect(params.get('aiThrottle')).toBe(0.5);
 });

 it.each([
  { pressure: 0, factionPressure: 'off', podsAvailable: 'off', expectedAutonomy: 1, expectedPolicy: 0 },
  { pressure: 0, factionPressure: 'off', podsAvailable: 'on', expectedAutonomy: 1, expectedPolicy: 0 },
  { pressure: 2, factionPressure: 'off', podsAvailable: 'off', expectedAutonomy: 0, expectedPolicy: 1 },
  { pressure: 2, factionPressure: 'on', podsAvailable: 'on', expectedAutonomy: 1, expectedPolicy: 1 },
 ] as const)('applies Notstand pressure $pressure without changing pod mechanics', async ({
  pressure, factionPressure, podsAvailable, expectedAutonomy, expectedPolicy
 }) => {
  const params = new Map<string, number>([
   ['aiFactionEnabled', 1], ['aiAutonomousPods', 1], ['podsEnabled', 1], ['podsPolicy', 0], ['powerPlantCostMultiplier', 3]
  ]);
  const setParam = (name: string, value: number) => { params.set(name, value); return true; };
  const resetRescue = vi.fn();
  const simulator = { micropolis: {
   totalFunds: 60000,
   getParam: (name: string) => params.get(name) ?? 0,
   setParam, resetRescue
  } } as unknown as MicropolisSimulator;
  const result = await commandBus.dispatch('scenario.notstand', {
   source: 'script', simulator,
   args: { rescuePressure: pressure, crisisEvent: 'coal-embargo', factionPressure, podsAvailable }
  });
  expect(result.handled).not.toBe(false);
  expect(params.get('aiFactionEnabled')).toBe(1);
  expect(params.get('aiAutonomousPods')).toBe(expectedAutonomy);
  expect(params.get('podsPolicy')).toBe(expectedPolicy);
  expect(params.get('podsEnabled')).toBe(1);
  expect(params.get('rescuePressure')).toBe(pressure);
  expect(params.get('rescueTrigger')).toBe(1);
  expect(params.get('rescuePodsAvailable')).toBe(Number(podsAvailable === 'on'));
  expect(resetRescue).toHaveBeenCalledOnce();
  expect(result.data).toMatchObject({ initialPodPolicy: pressure > 0 ? 'forbidden' : 'allowed' });
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
