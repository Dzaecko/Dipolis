import { describe, expect, it } from 'vitest';
import { commandBus } from '../../src/lib/CommandBus';
import { registerMicropolisCommands } from '../../src/lib/micropolisCommands';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';

async function run(strategy: string) {
 const engine = await loadMicropolisMainModule();
 const m = new engine.Micropolis();
 m.setCallback(createNoopJsCallback(engine), {});
 const simulator = { micropolis: m, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
 const dispatch = async (id: string, args?: Record<string, unknown>) => {
  const result = await commandBus.dispatch(id, { source: 'script', simulator, args });
  expect(result.handled, `${id}: ${result.message}`).not.toBe(false);
  return result.data as Record<string, number>;
 };
 const rows: Record<string, number>[] = [];
 const builds: Record<string, number>[] = [];
 let firstZeroTreasuryYear: number | null = null;
 let lowestYearlyFunds = Infinity;
 try {
  // Both repeats exercise the default seed, not a separate direct engine setup.
  const started = await dispatch('scenario.start', { city: 'haight', profile: 'koexistenz', disasters: false, speed: 3 });
  expect(started.seed).toBe(42);
  await dispatch('tax.set', { rate: 7 });
  await dispatch('food.set-import', { enabled: true });
  await dispatch('power.set-priority', { priority: 0 });
  await dispatch('sim.advance-ticks', { ticks: 12000 });
  await dispatch('treasury.set', { amount: 60000 });
  const phaseCensus = await dispatch('report.get');
  await dispatch('report.mark-baseline');
  const baseline = await dispatch('report.get');
  expect(baseline.baselineResPop).toBe(phaseCensus.resPop);
  expect(baseline.netResPopChange).toBe(0);
  if (strategy === 'B') {
   await dispatch('tax.set', { rate: 9 });
   await dispatch('budget.set-funding', { road: 100, police: 60, fire: 60 });
  }
  if (strategy === 'C' || strategy === 'D') {
   await dispatch('welfare.set-level', { level: strategy === 'D' ? 1 : 0 });
   await dispatch('power.set-priority', { priority: strategy === 'D' ? 1 : 2 });
  }
  for (let year = 1; year <= 30; year++) {
   const report = await dispatch('report.get');
   if (strategy === 'C' || strategy === 'D') {
    if (report.cashFlow < 0) builds.push({ year, ...(await dispatch('build.ai-zones', { count: 15 })) });
    if (report.powerReserve < 0.1) builds.push({ year, ...(await dispatch('build.power-plant', { type: 'coal' })) });
    if (strategy === 'C' && report.treasury < 10000) await dispatch('food.set-import', { enabled: false });
   }
   await dispatch('sim.advance', { months: 12 });
   const after = await dispatch('report.get');
  if (after.treasury === 0 && firstZeroTreasuryYear === null) firstZeroTreasuryYear = year;
  lowestYearlyFunds = Math.min(lowestYearlyFunds, after.treasury);
   if (year % 5 === 0) rows.push({ year, resPop: after.resPop, netResPopChange: after.netResPopChange,
    aiPop: after.aiPop, unemploymentRate: Number(after.unemploymentRate.toFixed(3)),
    automationShare: Number(after.automationShare.toFixed(3)), lostToPower: after.lostToPower,
    lostToHunger: after.lostToHunger, taxFund: after.taxFund, aiTaxFund: after.aiTaxFund,
    welfareCost: after.welfareCost, foodImportCost: after.foodImportCost, cashFlow: after.cashFlow,
    totalFunds: after.treasury, aiZones: after.aiZoneCount });
  }
  return { rows, builds, firstZeroTreasuryYear, lowestYearlyFunds };
 } finally { m.delete(); }
}

describe('Haushaltskrise via command bus', () => {
 it('repeats all four fixed 30-year strategies', async () => {
  registerMicropolisCommands();
  for (const strategy of ['A', 'B', 'C', 'D']) {
   const first = await run(strategy);
   expect(await run(strategy)).toEqual(first);
   expect(first.rows).toHaveLength(6);
   console.log(`CRISIS_${strategy}=${JSON.stringify(first)}`);
  }
 }, 240000);
});