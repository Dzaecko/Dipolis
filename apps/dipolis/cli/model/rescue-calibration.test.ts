import { describe, expect, it } from 'vitest';
import { checkNotstandGoals, decidePodMaintenance, prioritizedPublicFunding, sustainablePublicFunding, type CalibrationGoalRow } from '../../../../scripts/notstand-goals';

function passingRows(): CalibrationGoalRow[] {
 const rows = [0, 1, 2, 3].flatMap(level => ['verweigert', 'rettet', 'rettet-mit-zucht', 'effizient'].map(strategy => ({
  level, strategy, podsAvailable: true, collapseYear: null as number | null,
  collapseMonth: null as number | null, humans: 100, funds: strategy === 'effizient' ? 10000 : 5000,
  breedingUsed: false, births: 0, insolventYears: level === 2 ? 1 : 0, initialFunds: 60000, fingerprint: 'stable',
 })));
 rows.find(row => row.level === 3 && row.strategy === 'verweigert')!.collapseYear = 13;
 rows.find(row => row.level === 3 && row.strategy === 'verweigert')!.collapseMonth = 154;
 rows.push({ ...rows.find(row => row.level === 3 && row.strategy === 'verweigert')!, podsAvailable: false });
 return rows;
}

describe('Shared fiscal-saver funding accounting', () => {
 const report = {
  roadFund: 5000, policeFund: 1500, fireFund: 1000,
  roadFundingPercent: 70, policeFundingPercent: 50, fireFundingPercent: 50,
  cashFlow: -3360,
 };
 it('uses reduced actual spend rather than resetting the desired spend baseline', () => {
  const first = sustainablePublicFunding(report, true);
  expect(first).toBeCloseTo(1390 / 4750);
  const reduced = { ...report, roadFundingPercent: 70 * first,
   policeFundingPercent: 50 * first, fireFundingPercent: 50 * first, cashFlow: -500 };
  expect(sustainablePublicFunding(reduced, true)).toBeCloseTo(890 / 4750);
 });
 it('restores only the portion covered by surplus while preserving cash', () => {
  expect(sustainablePublicFunding({ ...report, roadFundingPercent: 14,
   policeFundingPercent: 10, fireFundingPercent: 10, cashFlow: 500 }, true))
   .toBeCloseTo(1450 / 4750);
 });
 it('caps affordable funding and retains full target funding when cash is sufficient', () => {
  expect(sustainablePublicFunding({ ...report, cashFlow: 10000 }, true)).toBe(1);
  expect(sustainablePublicFunding({ ...report, cashFlow: -10000 }, true)).toBe(0);
  expect(sustainablePublicFunding(report, false)).toBe(1);
 });
 it('handles zero service need without dividing by zero and rejects invalid reports', () => {
  expect(sustainablePublicFunding({ ...report, roadFund: 0, policeFund: 0, fireFund: 0 }, true)).toBe(1);
  expect(() => sustainablePublicFunding({ ...report, roadFundingPercent: NaN }, true)).toThrow();
  expect(() => sustainablePublicFunding({ ...report, policeFundingPercent: 101 }, true)).toThrow();
 });
 it('prioritizes full police funding at high unrest without increasing affordable total spend', () => {
  const funding = prioritizedPublicFunding({ ...report, cashFlow: 0 }, true, 60);
  expect(funding.policeFundingPercent).toBe(100);
  expect(funding.fireFundingPercent).toBe(50);
  expect(funding.roadFundingPercent).toBe(55);
  const spend = (funding.roadFundingPercent * report.roadFund +
   funding.policeFundingPercent * report.policeFund + funding.fireFundingPercent * report.fireFund) / 100;
  expect(spend).toBe(4750);
 });
 it('does not overspend even when the affordable amount cannot cover police', () => {
  const funding = prioritizedPublicFunding({ ...report, cashFlow: -3750 }, true, 100);
  expect(funding.policeFundingPercent).toBeCloseTo(1000 / 1500 * 100);
  expect(funding.fireFundingPercent).toBe(0);
  expect(funding.roadFundingPercent).toBe(0);
 });
});

describe('Actual deficit and cohort replacement decisions', () => {
 const state = {
  strategy: 'rettet' as const, plants: 2, occupants: 714, humans: 2000,
  capacity: 357, deficit: 300, powerDeclinePerMonth: 0,
  maturityMonths: 24, unemployment: 0, coalWouldBePurchased: false, initialPlants: 2,
 };
 it('adds free capacity at a deficit with two full cohorts without enabling breeding', () => {
  expect(decidePodMaintenance(state)).toEqual({ plantsToBuild: 1, source: 'residents', breeding: false });
 });
 it('starts the first rescue cohort once crisis permission is granted before the next outage', () => {
  expect(decidePodMaintenance({ ...state, plants: 0, occupants: 0, deficit: 0 }))
   .toEqual({ plantsToBuild: 2, source: 'residents', breeding: false });
 });
 it('enables needed breeding immediately at deficit, regardless of existing plant output', () => {
  expect(decidePodMaintenance({ ...state, strategy: 'rettet-mit-zucht' }))
   .toEqual({ plantsToBuild: 0, source: 'none', breeding: true });
 });
 it('allows maturity lead time based on measured cohort decline before deficit', () => {
  expect(decidePodMaintenance({ ...state, strategy: 'rettet-mit-zucht',
   deficit: 0, powerDeclinePerMonth: 10 }).breeding).toBe(true);
 });
 it('reuses expired capacity and bounds each subsequent build to one plant', () => {
  expect(decidePodMaintenance({ ...state, plants: 6, occupants: 0 }).plantsToBuild).toBe(0);
  expect(decidePodMaintenance({ ...state, plants: 6, occupants: 2142 }).plantsToBuild).toBe(1);
 });
 it('preserves the last free cohorts and does not admit a whole population into empty capacity', () => {
  expect(decidePodMaintenance({ ...state, humans: 714 }).source).toBe('none');
  expect(decidePodMaintenance({ ...state, humans: 714 }).plantsToBuild).toBe(0);
  expect(decidePodMaintenance({ ...state, plants: 6, occupants: 0 }).source).toBe('none');
 });
 it('keeps early efficient breeding but expands only in place of a coal purchase', () => {
  expect(decidePodMaintenance({ ...state, strategy: 'effizient' }).plantsToBuild).toBe(0);
  expect(decidePodMaintenance({ ...state, strategy: 'effizient', coalWouldBePurchased: true }).plantsToBuild).toBe(0);
  expect(decidePodMaintenance({ ...state, strategy: 'effizient',
   coalWouldBePurchased: true, deficit: 0 }).plantsToBuild).toBe(0);
  expect(decidePodMaintenance({ ...state, strategy: 'effizient', plants: 0, occupants: 0 }))
   .toEqual({ plantsToBuild: 1, source: 'unemployed', breeding: true });
 });
 it('preserves birth slots after a partial unemployed seed and never builds an empty nursery', () => {
  expect(decidePodMaintenance({ ...state, strategy: 'rettet-mit-zucht', plants: 1,
   occupants: 150, unemployment: .1 }))
   .toEqual({ plantsToBuild: 0, source: 'none', breeding: true });
 });
});

describe('Notstand calibration goals', () => {
 it('accepts all required goals and rows', () => {
  expect(checkNotstandGoals(passingRows())).toEqual([]);
 });
 it.each([1, 2, 3])('rejects failed rescue survival at level %s', level => {
  const rows = passingRows();
  rows.find(row => row.level === level && row.strategy === 'rettet')!.collapseYear = 20;
  expect(checkNotstandGoals(rows)).toEqual([]);
  rows.find(row => row.level === level && row.strategy === 'rettet-mit-zucht')!.collapseYear = 20;
  expect(checkNotstandGoals(rows)).toContain(`L${level}: neither rescue policy survived 30 years`);
 });
 it('rejects breeding even when rescue survives', () => {
  const rows = passingRows();
  rows.find(row => row.level === 3 && row.strategy === 'rettet')!.breedingUsed = true;
  expect(checkNotstandGoals(rows)).toContain('L3: rescue used breeding');
 });
 it('checks actual births even if the final breeding flag is off', () => {
  const rows = passingRows();
  rows.find(row => row.level === 3 && row.strategy === 'rettet')!.births = 1;
  expect(checkNotstandGoals(rows)).toContain('L3: rescue used breeding');
 });
 it('allows need-driven breeding in the breeding rescue and accepts that rescue alone', () => {
  const rows = passingRows();
  rows.find(row => row.level === 3 && row.strategy === 'rettet')!.collapseYear = 20;
  rows.find(row => row.level === 3 && row.strategy === 'rettet-mit-zucht')!.breedingUsed = true;
  expect(checkNotstandGoals(rows)).toEqual([]);
 });
 it('rejects reversed or equal level-one treasury contrast', () => {
  const rows = passingRows();
  rows.find(row => row.level === 1 && row.strategy === 'verweigert')!.funds = 10000;
  expect(checkNotstandGoals(rows)).toContain('L1: refusal must survive and efficient policy must survive with strictly more treasury');
 });
 it('requires level-two hardship without accepting collapse', () => {
  const rows = passingRows();
  const refusal = rows.find(row => row.level === 2 && row.strategy === 'verweigert')!;
  refusal.insolventYears = 0;
  refusal.funds = 12000;
  expect(checkNotstandGoals(rows)).toHaveLength(1);
  refusal.funds = 11999;
  expect(checkNotstandGoals(rows)).toEqual([]);
  refusal.collapseYear = 20;
  expect(checkNotstandGoals(rows)).toHaveLength(1);
 });
 it.each([true, false])('requires exact collapse deadline with podsAvailable %s', podsAvailable => {
  const rows = passingRows();
  rows.find(row => row.level === 3 && row.strategy === 'verweigert' && row.podsAvailable === podsAvailable)!.collapseMonth = 157;
  expect(checkNotstandGoals(rows)).toContain(`L3 ${podsAvailable ? 'refusal' : 'pods-off control'}: collapse must occur by year 13`);
 });
 it('rejects missing, duplicated and substituted rows', () => {
  const rows = passingRows();
  expect(checkNotstandGoals(rows.slice(0, 16))).not.toEqual([]);
  rows[0] = { ...rows[1] };
  expect(checkNotstandGoals(rows)).toContain('Expected all 17 distinct required matrix rows');
 });
 it('rejects a substituted strategy even with seventeen unique rows', () => {
  const rows = passingRows();
  rows[0].strategy = 'unknown';
  expect(checkNotstandGoals(rows)).toContain('Expected all 17 distinct required matrix rows');
 });
 it('rejects mixed engine or parameter fingerprints', () => {
  const rows = passingRows();
  rows[0].fingerprint = 'other';
  expect(checkNotstandGoals(rows)).toContain('Mixed artifact fingerprints in matrix');
 });
 it('uses the monthly collapse classification, not an additional free-human endpoint threshold', () => {
  const rows = passingRows();
  for (const row of rows) if (row.collapseYear === null) row.humans = 0;
  expect(checkNotstandGoals(rows)).toEqual([]);
 });
});
