import { describe, expect, it } from 'vitest';
import { checkNotstandGoals, type CalibrationGoalRow } from '../../../../scripts/notstand-goals';

function passingRows(): CalibrationGoalRow[] {
 const rows = [0, 1, 2, 3].flatMap(level => ['verweigert', 'rettet', 'effizient'].map(strategy => ({
  level, strategy, podsAvailable: true, collapseYear: null as number | null,
  collapseMonth: null as number | null, humans: 100, funds: strategy === 'rettet' ? 10000 : 5000,
  breedingUsed: false, insolventYears: level === 2 ? 1 : 0, initialFunds: 60000, fingerprint: 'stable',
 })));
 rows.find(row => row.level === 3 && row.strategy === 'verweigert')!.collapseYear = 13;
 rows.find(row => row.level === 3 && row.strategy === 'verweigert')!.collapseMonth = 154;
 rows.push({ ...rows.find(row => row.level === 3 && row.strategy === 'verweigert')!, podsAvailable: false });
 return rows;
}

describe('Notstand calibration goals', () => {
 it('accepts all required goals and rows', () => {
  expect(checkNotstandGoals(passingRows(), .1)).toEqual([]);
 });
 it.each([1, 2, 3])('rejects failed rescue survival at level %s', level => {
  const rows = passingRows();
  rows.find(row => row.level === level && row.strategy === 'rettet')!.collapseYear = 20;
  expect(checkNotstandGoals(rows, .1)).toContain(`L${level}: rescue did not survive 30 years`);
 });
 it('rejects breeding even when rescue survives', () => {
  const rows = passingRows();
  rows.find(row => row.level === 3 && row.strategy === 'rettet')!.breedingUsed = true;
  expect(checkNotstandGoals(rows, .1)).toContain('L3: rescue used breeding');
 });
 it('rejects reversed or equal level-one treasury contrast', () => {
  const rows = passingRows();
  rows.find(row => row.level === 1 && row.strategy === 'verweigert')!.funds = 10000;
  expect(checkNotstandGoals(rows, .1)).toContain('L1: refusal must survive with strictly less treasury than rescue');
 });
 it('requires level-two hardship without accepting collapse', () => {
  const rows = passingRows();
  const refusal = rows.find(row => row.level === 2 && row.strategy === 'verweigert')!;
  refusal.insolventYears = 0;
  refusal.funds = 6001;
  expect(checkNotstandGoals(rows, .1)).toHaveLength(1);
  refusal.funds = 6000;
  expect(checkNotstandGoals(rows, .1)).toEqual([]);
  refusal.collapseYear = 20;
  expect(checkNotstandGoals(rows, .1)).toHaveLength(1);
 });
 it.each([true, false])('requires exact collapse deadline with podsAvailable %s', podsAvailable => {
  const rows = passingRows();
  rows.find(row => row.level === 3 && row.strategy === 'verweigert' && row.podsAvailable === podsAvailable)!.collapseMonth = 157;
  expect(checkNotstandGoals(rows, .1)).toContain(`L3 ${podsAvailable ? 'refusal' : 'pods-off control'}: collapse must occur by year 13`);
 });
 it('rejects missing, duplicated and substituted rows', () => {
  const rows = passingRows();
  expect(checkNotstandGoals(rows.slice(0, 12), .1)).not.toEqual([]);
  rows[0] = { ...rows[1] };
  expect(checkNotstandGoals(rows, .1)).toContain('Expected all 13 distinct required matrix rows');
 });
 it('rejects mixed engine or parameter fingerprints', () => {
  const rows = passingRows();
  rows[0].fingerprint = 'other';
  expect(checkNotstandGoals(rows, .1)).toContain('Mixed artifact fingerprints in matrix');
 });
 it('uses the monthly collapse classification, not an additional free-human endpoint threshold', () => {
  const rows = passingRows();
  for (const row of rows) if (row.collapseYear === null) row.humans = 0;
  expect(checkNotstandGoals(rows, .1)).toEqual([]);
 });
});
