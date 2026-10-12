import { describe, expect, it } from 'vitest';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { PROFILES } from '../../src/lib/params/profiles';
import type { MainModule } from '../../src/types/micropolisengine.d.js';

let loaded: Promise<MainModule> | undefined;
async function fixture(profile: 'v2-unruhe' | 'v3-pods' | 'v4-fraktion') {
 const engine = await (loaded ??= loadMicropolisMainModule());
 const m = new engine.Micropolis();
 m.setCallback(createNoopJsCallback(engine), {});
 m.setFixedSeed(2); m.init(); m.clearMap();
 for (const [key, value] of Object.entries(PROFILES[profile])) expect(m.setParam(key, value)).toBe(true);
 m.setEnableDisasters(false); m.setSpeed(3); m.setPasses(1);
 const bits = engine.MapTileBits.ZONEBIT.value | engine.MapTileBits.CONDBIT.value;
 m.setTile(10, 10, engine.Tiles.FREEZ.value | bits);
 m.setZoneOwner(10, 10, 1);
 m.setTile(30, 30, engine.Tiles.RZB.value + 27 | bits);
 m.setZoneOwner(30, 30, 2);
 return { m, engine };
}

describe('absolute human unrest from v2 onward', () => {
 it.each(['v2-unruhe', 'v3-pods', 'v4-fraktion'] as const)(
  '%s excludes empty housing and clears human unrest at zero humans, independently of AI', async profile => {
   const { m } = await fixture(profile);
   try {
    m.resPop = 0; m.aiPop = 3000; m.aiSatisfaction = 100;
    m.unrest = 96; m.unemploymentRate = 1;
    m.setParam('unrestInertia', 0);
    m.setParam('unrestSabotageProbability', 1);
    m.setParam('unrestUprisingProbability', 1);
    for (let month = 0; month < 60; month++) m.updateUnrest();
    expect(m.unrest).toBe(0);
    expect(m.unrestStage).toBe(0);
    expect(m.humanUnrestScale).toBe(0);
    expect(m.unrestUnemploymentContribution).toBe(0);
    expect(m.sabotageFires).toBe(0);
    expect(m.damagedAiZones).toBe(0);
   } finally { m.delete(); }
  });

 it.each([{ population: 3, rate: 1, expected: .72 },
  { population: 5000, rate: .4, expected: 48 }])(
  'scales unemployment at $population humans without changing its saturated contribution', async ({
   population, rate, expected
  }) => {
   const { m } = await fixture('v2-unruhe');
   try {
    for (const key of ['unrestHumanDeclineWeight', 'unrestAutomationWeight', 'unrestHungerWeight',
     'unrestPowerWeight', 'unrestWelfareWeight', 'unrestPoliceWeight']) m.setParam(key, 0);
    m.setParam('welfareLevel', 0); m.setParam('unrestInertia', 1);
    m.resPop = population; m.unemploymentRate = rate;
    m.updateUnrest();
    expect(m.unrestUnemploymentContribution).toBeCloseTo(expected, 4);
    expect(m.unrest).toBeCloseTo(expected, 4);
    expect(m.setParam('humanUnrestReferencePop', 0)).toBe(false);
    expect(m.setParam('humanUnrestReferencePop', -1)).toBe(false);
    expect(m.getParam('humanUnrestReferencePop')).toBe(500);
   } finally { m.delete(); }
  });

 it('advances five real simulation years with AI-only residents without human sabotage', async () => {
  const { m, engine } = await fixture('v4-fraktion');
  try {
   m.setParam('aiAutonomousPods', 0);
   m.setFunds(1000000);
   m.setTile(50, 50, engine.Tiles.NUCLEAR.value |
    engine.MapTileBits.ZONEBIT.value | engine.MapTileBits.CONDBIT.value);
   m.setParam('unrestSabotageProbability', 1); m.setParam('unrestUprisingProbability', 1);
   m.resPop = 0; m.aiPop = 3000; m.aiSatisfaction = 100; m.unrest = 96;
   const start = m.cityTime;
   while (m.cityTime < start + 5 * 48) m.simTick();
   expect(m.resPop).toBe(0);
   expect(m.unemploymentRate).toBe(0);
   expect(m.unrest).toBe(0);
   expect(m.sabotageFires).toBe(0);
   expect(m.damagedAiZones).toBe(0);
   expect(m.damagedPowerPlants).toBe(0);
  } finally { m.delete(); }
 });
});
