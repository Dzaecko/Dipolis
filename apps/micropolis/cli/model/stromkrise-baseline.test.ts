import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE_CONTROLS, baselineGate, csv, summaryRow } from '../../../../scripts/measure-v3-stromkrise-baseline';
import { CURRENT_ENGINE_ID } from '../../src/lib/city-run/compatibility';

describe('fixed Stromkrise A prerequisite', () => {
 it('requires all 30 years, all 360 months, strictly positive funds, unemployment and reconciled finances', () => {
  expect(baselineGate(30, 360, 1, true, true).passed).toBe(true);
  for (const args of [[30, 360, 0, true, true], [30, 360, -1, true, true],
   [29, 360, 1, true, true], [30, 359, 1, true, true], [30, 360, 1, false, true],
   [30, 360, 1, true, false]] as const)
   expect(baselineGate(...args).passed).toBe(false);
 });
 it('preserves the new fixed base and the prior CSV columns, adding unemployment, welfare, fires and actual plant count', () => {
  expect(BASELINE_CONTROLS).toMatchObject({ farmsFirstYear: 10,
   aiLotsWhenCashFlowNegative: 30, welfareLevel: 1, automationLimit: .9,
   tax: 7, police: 100, fire: 100, powerPriority: 0, autoBuildRules: 0, throttle: 0 });
  const row = summaryRow('A', 5, {});
  expect(Object.keys(row)).toEqual(['strategy', 'year', 'resPop', 'boundHumans',
   'diedInPods', 'bornInPods', 'aiPop', 'suspendedAi', 'reserve', 'plantPower',
   'plantFoodDemand', 'unrest', 'stage', 'cashFlow', 'totalFunds', 'unemploymentRate',
   'welfareCost', 'fires', 'plantCount']);
  expect(csv([row]).split('\n')[0]).toBe(Object.keys(row).join(','));
 });
 it('persists genuine failure evidence without starting experiments or fabricating missing samples', () => {
  const result = JSON.parse(readFileSync(new URL(
   '../../../../docs/results/v3-pods-stromkrise-welfare1-ai30-baseline.json', import.meta.url), 'utf8'));
  expect(result.engineId).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(result.weights).toMatchObject({ unrestHumanDeclineWeight: 150,
   unrestAutomationWeight: 55, unrestUnemploymentWeight: 120 });
  expect(result.experimentsStarted).toBe(false);
  const crisis = result.setupCommands.find((r: { id: string }) => r.id === 'scenario.stromkrise');
  expect(crisis.result.data.demolished).toHaveLength(2);
  expect(crisis.result.data.powerPlantCostMultiplier).toBe(3);
  expect(result.firstEmpty).toMatchObject({ year: 6, month: 7, funds: 0 });
  expect(result.firstEmpty.negativeLedger).toHaveLength(6);
  expect(result.firstEmpty.failedBuilds).toHaveLength(3);
  expect(result.gate.passed).toBe(false);
  expect(result.gate.unemploymentExists).toBe(true);
  expect(result.monthly.some((r: { year: number; unemploymentRate: number; resPop: number }) =>
   r.year < 6 && r.unemploymentRate > 0 && r.resPop > 0)).toBe(true);
  expect(result.annual).toHaveLength(result.completedAnnualSamples);
  expect(result.monthly).toHaveLength(result.completedMonthlySamples);
  expect(result.finance.completedBookingsReconciled).toBe(true);
  expect(result.finance.treasurySumReconciled).toBe(true);
  expect(result.ledger.some((r: { delta: number }) => r.delta === 0)).toBe(true);
  expect(result.runtimeFailure).toMatchObject({ year: 16, month: 7, fundsAtFailure: -77 });
  for (const row of [...result.annual, ...result.monthly]) {
   expect(row.strategy).toBe('A');
   expect(row.plantCount).toBe(0);
   expect(row).toHaveProperty('unemploymentRate');
   expect(row).toHaveProperty('welfareCost');
   expect(row).toHaveProperty('stage');
   expect(row).toHaveProperty('fires');
  }
 });
 it('completes the corrected-engine horizon without turning bankruptcy into a passing gate', () => {
  const result = JSON.parse(readFileSync(new URL(
   '../../../../docs/results/v3-pods-stromkrise-welfare1-ai30-baseline-complete.json', import.meta.url), 'utf8'));
  expect(result.engineId).toBe(CURRENT_ENGINE_ID);
  expect(result.completedAnnualSamples).toBe(30);
  expect(result.completedMonthlySamples).toBe(360);
  expect(result.gate.passed).toBe(false);
  expect(result.gate.unemploymentExists).toBe(true);
  expect(result.firstEmpty).toMatchObject({ year: 6, month: 7, funds: 0 });
  expect(result.experimentsStarted).toBe(false);
  expect(result.finance.completedBookingsReconciled).toBe(true);
  expect(result.finance.treasurySumReconciled).toBe(true);
  expect(result.annual.at(-1).totalFunds).toBe(-102);
 });
});
