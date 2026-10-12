import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autonomousPlantGate, bulldozeEmptyAutonomousPlants, fixedYearCommands, measureV4, preflightEvidence, V4_BASELINE,
 V4_FIELDS, v4Csv, v4SummaryRow, type MeasurementSession } from '../../../../scripts/measure-v4-fraktion';
import type { Report } from '../../src/lib/city-run/protocol';
import { engineCompatibility } from '../../src/lib/city-run/compatibility';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
const report = (overrides: Report = {}): Report => ({
 resPop: 100, aiPop: 50, treasury: 60000, cashFlow: -1, unemploymentRate: .2,
 adminBoundHumans: 3, aiBoundHumans: 4, adminDiedInPodsCumulative: 5, aiDiedInPodsCumulative: 6,
 adminBornInPodsCumulative: 7, aiBornInPodsCumulative: 8, adminBioPlantCount: 1, aiBioPlantCount: 0,
 aiSatisfaction: .5, aiStrikeMonths: 9, aiShortageMonths: 12, aiNoUnemployedMonths: 0, aiEligibleUnemployed: 20,
 aiPlantSiteAvailable: 1, aiPlantBuildAllowed: 1, powerReserve: -.2, unrest: .3, unrestStage: 2,
 sabotageFires: 10, ...overrides,
});
function fakeFactory(autonomousPlant: boolean) {
 const sessions: Array<{ calls: Array<{ id: string; args: unknown }>; closed: boolean }> = [];
 const create = async (): Promise<MeasurementSession> => {
  const observed = { calls: [] as Array<{ id: string; args: unknown }>, closed: false };
  sessions.push(observed); let months = 0, allowed = true;
  return { async dispatch(id, args) {
   observed.calls.push({ id, args });
   if (id === 'pods.set-policy') allowed = args?.policy === 'allowed';
   if (id === 'report.get') return { handled: true, data: report({
    aiBioPlantCount: autonomousPlant && allowed && months >= 12 ? 1 : 0, aiPlantBuildAllowed: allowed ? 1 : 0,
    treasury: 60000 - months, aiShortageMonths: months,
   }) };
   return { handled: true, data: { built: 1 } };
  }, async advanceMonth() { months++; }, cityTime: () => months * 4, close() { observed.closed = true; } };
 };
 return { create, sessions };
}
describe('fixed v4-fraktion measurement', () => {
 it('cleans only empty owner5 AIplants and leaves occupied/admin plants unchanged', async () => {
  const calls: number[][] = [];
  const result = await bulldozeEmptyAutonomousPlants([
   { x: 1, y: 1, owner: 4, occupied: false }, { x: 2, y: 2, owner: 5, occupied: true },
   { x: 3, y: 3, owner: 5, occupied: false }, { x: 4, y: 4, owner: 2, occupied: false },
  ], async (x, y) => { calls.push([x, y]); return true; });
  expect(calls).toEqual([[3, 3]]);
  expect(result).toEqual({ handled: true, data: { demolished: [{ x: 3, y: 3 }], failed: [], owner: 5, emptyOnly: true } });
 });
 it('keeps the corrected inherited baseline without the old mandatory coal rule', () => {
  expect(V4_BASELINE).toMatchObject({ farmsFirstYear: 10, aiLotsWhenCashFlowNegative: 30,
   automationLimit: .9, welfareLevel: 1, tax: 7, road: 100, police: 100, fire: 100,
   demolishedPlants: 2, powerPlantCostMultiplier: 3 });
  for (const strategy of ['A', 'B', 'C'] as const) {
   expect(fixedYearCommands(strategy, 1, report()).map(command => command.id)).toEqual(['build.farms', 'build.ai-zones']);
   expect(fixedYearCommands(strategy, 2, report({ cashFlow: 0 }))).toEqual([]);
  }
  expect(fixedYearCommands('D', 1, report()).map(command => command.id)).toEqual([
   'build.farms', 'build.ai-zones', 'build.power-plant']);
  expect(fixedYearCommands('D', 2, report({ cashFlow: 0, powerReserve: .1 }))).toEqual([]);
 });
 it('requires a full actual ten-year sample and a real autonomous plant, not administration pods', () => {
  const samples = Array.from({ length: 120 }, () => ({ report: report() }));
  expect(autonomousPlantGate(samples).passed).toBe(false);
  samples[119]!.report.aiBioPlantCount = 1;
  expect(autonomousPlantGate(samples).passed).toBe(true);
  expect(autonomousPlantGate(samples.slice(1)).passed).toBe(false);
  delete samples[0]!.report.aiEligibleUnemployed;
  expect(autonomousPlantGate(samples)).toMatchObject({ passed: true, missingFields: ['aiEligibleUnemployed'] });
 });
 it('does not count pre-existing warmup plants as first-ten-year autonomous construction', () => {
  const samples = Array.from({ length: 120 }, () => ({ report: report({ aiBioPlantCount: 2 }) }));
  expect(autonomousPlantGate(samples, V4_FIELDS, 2)).toMatchObject({
   passed: false, actualPlantObserved: false, baselineAiPlantCount: 2, constructionEvidence: [] });
  samples[35]!.report.aiBioPlantCount = 3;
  const gate = autonomousPlantGate(samples, V4_FIELDS, 2);
  expect(gate.passed).toBe(true);
  expect(gate.constructionEvidence[0]).toEqual({ monthIndex: 36, previousCount: 2, count: 3, increase: 1 });
 });
 it('preserves exact missing evidence as unknown and separate birth/death custody totals', () => {
  const row = v4SummaryRow('C', 5, report());
  expect(row).toMatchObject({ adminBoundHumans: 3, aiBoundHumans: 4,
   adminDeathsCumulative: 5, aiDeathsCumulative: 6, adminBirthsCumulative: 7, aiBirthsCumulative: 8,
   aiSatisfaction: .5, strikeMonths: 9, sabotageFires: 10, aiPlantsAllowed: 0, policeFundingTarget: 40 });
  expect(v4SummaryRow('A', 5, {}).aiPlantCount).toBeNull();
  expect(preflightEvidence([{ year: 1, month: 1, report: {} }])[0]).toMatchObject({
   shortageMonths: null, eligibleUnemployed: null, siteAvailable: null, buildAllowed: null });
  expect(v4Csv([row])).toContain('adminDeathsCumulative,aiDeathsCumulative');
  expect(v4Csv([])).toBe('');
 });
 it('stops B/C/D after failed A preflight without tuning or adding extra coal', async () => {
  const fake = fakeFactory(false), result = await measureV4({
   sessionFactory: fake.create, writeResults: false, provenance: { engineId: 'unit-test-no-engine' }
  });
  expect(result.status).toBe('prerequisite-failed'); expect(result.comparisonsStarted).toBe(false);
  expect(result.preflight.completedMonths).toBe(120); expect(result.preflightEvidence).toHaveLength(120);
  expect(result.measurements).toHaveLength(1); expect(result.measurements[0]!.annual).toHaveLength(10);
  expect(fake.sessions).toHaveLength(1); expect(fake.sessions[0]!.closed).toBe(true);
  expect(fake.sessions[0]!.calls.some(call => call.id === 'build.power-plant')).toBe(false);
  expect(fake.sessions[0]!.calls.filter(call => call.id === 'build.farms')).toHaveLength(1);
  expect(result.explanation).toContain('B/C/D were not started');
 });
 it('continues the same A session to thirty years and runs exactly B/C/D only after passing preflight', async () => {
  const fake = fakeFactory(true), result = await measureV4({
   sessionFactory: fake.create, writeResults: false, provenance: { engineId: 'unit-test-no-engine' }
  });
  expect(result.status).toBe('complete'); expect(result.comparisonsStarted).toBe(true);
  expect(result.measurements.map(record => record.strategy)).toEqual(['A', 'B', 'C', 'D']);
  expect(result.preflightEvidence).toHaveLength(120);
  for (const record of result.measurements) {
   expect(record.monthly).toHaveLength(360); expect(record.annual).toHaveLength(30);
   expect(record.commands.filter(command => command.id === 'build.farms')).toHaveLength(1);
   const funding = record.commands.find(command => command.id === 'budget.set-funding')!;
   expect(funding.args).toEqual({ road: 100, police: record.strategy === 'C' ? 40 : 100, fire: 100 });
  }
  expect(fake.sessions.every(session => session.closed)).toBe(true);
  for (const record of result.measurements.filter(record => record.strategy !== 'D'))
   expect(record.commands.some(command => command.id === 'build.power-plant' || command.id === 'ai.bulldoze-empty-plants')).toBe(false);
  const d = result.measurements[3]!;
  expect(d.commands.filter(command => command.id === 'build.power-plant')).toHaveLength(361);
  expect(d.commands.filter(command => command.id === 'ai.bulldoze-empty-plants')).toHaveLength(390);
  expect(result.fields).toEqual(V4_FIELDS);
 });
 it('persists honest failed preflight CSV/JSON/report evidence without fictional B/C/D data', async () => {
  const directory = path.join(fileURLToPath(new URL('../../', import.meta.url)), `.v4-measurement-test-${randomUUID()}`);
  directories.push(directory);
  const fake = fakeFactory(false);
  await measureV4({ directory, sessionFactory: fake.create, provenance: { engineId: 'unit-test-no-engine' } });
  const stem = path.join(directory, 'v4-fraktion-stromkrise');
  const persisted = JSON.parse(readFileSync(stem + '.json', 'utf8'));
  expect(persisted.measurements).toHaveLength(1); expect(persisted.preflightEvidence).toHaveLength(120);
  expect(existsSync(stem + '-monthly.csv')).toBe(true);
  const csv = readFileSync(stem + '-5year.csv', 'utf8').trim().split('\n');
  expect(csv).toHaveLength(3); expect(csv[1]).toMatch(/^A,5,/); expect(csv[2]).toMatch(/^A,10,/);
  const report = readFileSync(stem + '-report.md', 'utf8');
  expect(report).toContain('prerequisite-failed');
  expect(report).toContain('A/B/C have no annual coal rule');
  expect(report).toContain('B/C/D were not started');
  expect(report).toContain('Mangelfolge-Monate');
 });
 it('preserves engine advance failure as a partial prerequisite without starting comparisons', async () => {
  const fake = fakeFactory(false); const create = async () => {
   const session = await fake.create();
   let months = 0; const advance = session.advanceMonth;
   session.advanceMonth = async () => { if (++months === 4) throw new Error('Failure'); await advance(); };
   return session;
  };
  const result = await measureV4({ sessionFactory: create, writeResults: false, provenance: { engineId: 'test' } });
  expect(result.status).toBe('prerequisite-failed'); expect(result.measurements).toHaveLength(1);
  expect(result.measurements[0]!.failure).toMatchObject({ year: 1, month: 4 });
  expect(result.measurements[0]!.monthly).toHaveLength(3); expect(fake.sessions[0]!.closed).toBe(true);
 });
 it('continues D after rejected bulldozing while recording every genuine failed attempt', async () => {
  const fake = fakeFactory(true); const create = async () => {
   const session = await fake.create(), dispatch = session.dispatch;
   session.dispatch = async (id, args) => id === 'ai.bulldoze-empty-plants'
    ? { handled: false, data: { failed: [{ x: 1, y: 2 }], fundsBefore: 0 } } : dispatch(id, args);
   return session;
  };
  const result = await measureV4({ sessionFactory: create, writeResults: false, provenance: { engineId: 'test' } });
  expect(result.status).toBe('complete');
  const d = result.measurements[3]!;
  expect(d.monthly).toHaveLength(360); expect(d.failure).toBeUndefined();
  expect(d.commands.filter(command => command.id === 'ai.bulldoze-empty-plants' &&
   (command.result as { handled: boolean }).handled === false)).toHaveLength(390);
 });
 it('reruns D only with monthly coal snapshots while preserving A/B/C exactly', async () => {
  const fake = fakeFactory(true), original = await measureV4({
   sessionFactory: fake.create, writeResults: false, provenance: { engineId: 'test' },
  });
  const again = fakeFactory(true), result = await measureV4({
   sessionFactory: again.create, writeResults: false, provenance: { engineId: 'test' }, existingResult: original,
  });
  expect(result.measurements.slice(0, 3)).toEqual(original.measurements.slice(0, 3));
  const coal = result.measurements[3]!.commands.filter(command => command.id === 'build.power-plant');
  expect(coal).toHaveLength(361);
  expect(coal.filter(command => command.month === 0)).toHaveLength(1);
  expect(coal.some(command => command.year === 1 && command.month === 1)).toBe(true);
  expect(coal.some(command => command.year === 30 && command.month === 12)).toBe(true);
 });
 it('preserves the verified original-engine A-D horizons and proves post-stichtag construction', () => {
  const file = fileURLToPath(new URL('../../../../docs/results/v4-fraktion-stromkrise.json', import.meta.url));
  const actual = JSON.parse(readFileSync(file, 'utf8'));
  expect(actual.status).toBe('complete');
  expect(engineCompatibility({ engineId: actual.engineId, rescuePressure: 0 }))
   .toMatchObject({ status: 'current', playable: true });
  expect(actual.preflight).toMatchObject({ passed: true, completedMonths: 120, baselineAiPlantCount: 0 });
  expect(actual.preflight.constructionEvidence[0]).toEqual({
   monthIndex: 26, previousCount: 0, count: 1, increase: 1 });
  expect(actual.measurements.map((record: { strategy: string }) => record.strategy)).toEqual(['A', 'B', 'C', 'D']);
  for (const record of actual.measurements) {
   expect(record.annual).toHaveLength(30); expect(record.monthly).toHaveLength(360);
   expect(record.baseline).toBeDefined(); expect(record.failure).toBeUndefined();
   if (record.strategy !== 'D') expect(record.commands.some((command: { id: string }) =>
    command.id === 'build.power-plant' || command.id === 'ai.bulldoze-empty-plants')).toBe(false);
  }
  expect(actual.measurements[3].commands.some((command: { id: string; result: { handled?: boolean } }) =>
   command.id === 'ai.bulldoze-empty-plants' && command.result.handled === false)).toBe(true);
  expect(actual.measurements[3].commands.some((command: { id: string; month: number }) =>
   command.id === 'build.power-plant' && command.month > 0)).toBe(true);
 });
});
