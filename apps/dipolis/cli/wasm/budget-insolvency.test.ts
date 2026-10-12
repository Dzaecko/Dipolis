import { describe, expect, it } from 'vitest';
import { createCitySession } from '../model/city-session';
import { setupScenario } from '../../src/lib/city-run/replay';

describe('signed insolvent budget accounting', () => {
 it.each([
  { autoBudget: false, population: 77, totalPop: 77 },
  { autoBudget: true, population: 77, totalPop: 77 },
  { autoBudget: true, population: 7, totalPop: 0 },
 ])('books mandatory welfare at zero treasury: $population humans, totalPop=$totalPop', async row => {
  const s = await createCitySession();
  try {
   await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v3-pods' });
   const m = s.micropolis;
   m.setFunds(0);
   m.setAutoBudget(row.autoBudget);
   m.setParam('welfareLevel', 1);
   m.setParam('welfareCostPerPop', 1);
   m.setParam('foodImportEnabled', 0);
   m.resPop = row.population;
   m.totalPop = row.totalPop;
   m.aiPop = 0;
   m.unemploymentRate = 1;
   m.cityTaxAverage = 0;
   m.cityTax = 0;
   m.roadPercent = m.firePercent = m.policePercent = 0;
   m.cityTime = 48;
   m.phaseCycle = 9;
   const revision = m.financeRevision;
   expect(() => m.simTick()).not.toThrow();
   expect(m.financeRevision).toBe(revision + 1);
   expect(m.welfareCost).toBe(row.population);
   expect(m.taxFund + m.aiTaxFund + m.automationTaxFund).toBe(0);
   expect(m.foodImportCost).toBe(0);
   expect(m.totalFunds).toBe(-row.population);
   expect(m.cashFlow).toBe(-row.population);
   expect(m.totalFunds).toBe(m.cashFlow);
  } finally { s.close(); }
 });

 it.each([
  { funds: -77, tax: 0, request: 0, spent: 0, final: -77 },
  { funds: -77, tax: 0, request: 100, spent: 0, final: -77 },
  { funds: -77, tax: 50, request: 100, spent: 0, final: -27 },
  { funds: -77, tax: 100, request: 100, spent: 23, final: 0 },
  { funds: -77, tax: 1000, request: 100, spent: 300, final: 623 },
  { funds: 0, tax: 0, request: 0, spent: 0, final: 0 },
 ])('allocates only nonnegative available service funds: $funds / $tax / $request', async row => {
  const s = await createCitySession();
  try {
   const m = s.micropolis;
   m.setFunds(row.funds);
   m.setAutoBudget(true);
   m.taxFund = row.tax;
   m.roadFund = m.fireFund = m.policeFund = row.request;
   m.roadPercent = m.firePercent = m.policePercent = 1;
   expect(() => m.doBudget()).not.toThrow();
   expect(m.totalFunds).toBe(row.final);
   expect(row.funds + row.tax - m.totalFunds).toBe(row.spent);
   for (const funding of [m.roadPercent, m.firePercent, m.policePercent])
    expect(funding).toBeGreaterThanOrEqual(0);
  } finally { s.close(); }
 });
});
