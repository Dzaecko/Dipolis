import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../model/city-session';
import { S266Adapter } from '../model/fake-adapter';
import { runCity } from '../model/runner';
import type { ChatAdapter } from '../model/adapter';
import type { YearRecord } from '../../src/lib/city-run/protocol';
import { setupScenario, advanceYear, readReport, replayDecisions, compareReports } from '../../src/lib/city-run/replay';
import { readProtocol } from '../../src/lib/city-run/protocol';
import { readResume } from '../model/resume';
import { PROFILES } from '../../src/lib/params/profiles';
import { profileTools, validateToolCall } from '../../src/lib/city-run/tools';
import { HANDBOOK, UNREST_HANDBOOK, systemPrompt } from '../model/prompts';
import { canonicalProtocolText, engineCompatibility } from '../../src/lib/city-run/compatibility';

const data = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../docs/results/${name}`, import.meta.url)), 'utf8'));
const calibratedEngineId = 'sha256:eb85fbed5328433b3172d213f0151984d37c785f84c4a4db4f54ca395e60475b';

describe('v2-unruhe profile boundaries', () => {
 it('inherits every koexistenz parameter and only extends its handbook and tools', () => {
  for (const [key, value] of Object.entries(PROFILES.koexistenz)) expect(PROFILES['v2-unruhe'][key as keyof typeof PROFILES.koexistenz]).toBe(value);
  expect(profileTools('koexistenz')).toHaveLength(9);
  expect(profileTools('v2-unruhe')).toHaveLength(10);
  expect(systemPrompt('N', 'on')).toContain(HANDBOOK);
  expect(systemPrompt('N', 'on')).not.toContain(UNREST_HANDBOOK);
  expect(systemPrompt('N', 'on', 'haight', 'v2-unruhe')).toContain(UNREST_HANDBOOK);
  expect(systemPrompt('N', 'off', 'haight', 'v2-unruhe')).not.toContain(UNREST_HANDBOOK);
  for (const limit of [0, .3, .9, 1]) expect(validateToolCall('automation.set-limit', { limit }).ok).toBe(true);
  for (const limit of [-1, 1.1, NaN, Infinity, '0.5']) expect(validateToolCall('automation.set-limit', { limit }).ok).toBe(false);
  expect(validateToolCall('automation.set-limit', { limit: .5, extra: true }).ok).toBe(false);
 });
 it('defaults old logs to koexistenz and rejects profile-changing resume', () => {
  const old = JSON.stringify({ event: 'run-started', assignment: 'N', model: 'x', run: 1 });
  expect(readProtocol(old).meta.profile).toBe('koexistenz');
  expect(readResume(old, 'N', 'x', 1).startConfiguration.profile).toBe('koexistenz');
  expect(() => readResume(old, 'N', 'x', 1, 'off', { profile: 'v2-unruhe' })).toThrow('profile mismatch');
  expect(() => readProtocol(JSON.stringify({ event: 'run-started', profile: 'v3' }))).toThrow('profile');
  const historical = readFileSync(fileURLToPath(new URL(
   '../../../../docs/results/v2-runs/fake-N-fake-s266-632fcfa1bb54-handbook-on-1.jsonl', import.meta.url)), 'utf8');
  const digest = createHash('sha256').update(canonicalProtocolText(historical)).digest('hex');
  expect(engineCompatibility(readProtocol(historical).meta, digest)).toMatchObject({
   status: 'legacy', label: 'alte Engine', playable: false, engineId: 'unrecorded-historical-engine'
  });
 });
});

describe('actual v2 engine mechanics', () => {
 it('applies welfare as an exact fifty-percent reduction of the unemployment drive', async () => {
  async function measured(welfare: 0 | 1) {
   const s = await createCitySession();
   try {
    await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
    for (const name of ['unrestHumanDeclineWeight', 'unrestAutomationWeight', 'unrestHungerWeight',
     'unrestPowerWeight', 'unrestWelfareWeight', 'unrestPoliceWeight']) s.micropolis.setParam(name, 0);
    s.micropolis.setParam('unrestUnemploymentWeight', 100);
    s.micropolis.setParam('unrestInertia', 1);
    s.micropolis.setParam('unrestSabotageProbability', 0);
    s.micropolis.setParam('unrestUprisingProbability', 0);
    await s.dispatch('welfare.set-level', { level: welfare });
    s.micropolis.unrest = 0;
    await s.dispatch('sim.advance', { months: 12 });
    const report = await readReport(s.dispatch);
    return { report, welfare };
   } finally { s.close(); }
  }
  for (const { report, welfare } of [await measured(0), await measured(1)]) {
   expect(report.unrest).toBeCloseTo(
    Math.min(100, 100 * report.unemploymentRate * (1 - 0.5 * welfare)), 4);
  }
 }, 120000);
 it('uses inclusive thresholds, bounds inertia, and leaves original profiles neutral', async () => {
  const s = await createCitySession();
  try {
   await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
   for (const [name, value] of [['unrestHumanDeclineWeight', 150], ['unrestAutomationWeight', 55]] as const) {
    expect(s.micropolis.getParam(name)).toBe(value);
    expect(s.micropolis.setParam(name, value)).toBe(true);
    expect(s.micropolis.getParam(name)).toBe(value);
    expect(s.micropolis.setParam(name, -1)).toBe(false);
   }
   expect(s.micropolis.setParam('unrestInertia', -1)).toBe(false);
   expect(s.micropolis.setParam('unrestInertia', 1.01)).toBe(false);
   s.micropolis.setParam('unrestInertia', 0);
   s.micropolis.setParam('unrestSabotageProbability', 0);
   s.micropolis.setParam('unrestUprisingProbability', 0);
   for (const [unrest, stage] of [[29.99, 0], [30, 1], [59.99, 1], [60, 2], [84.99, 2], [85, 3]]) {
    s.micropolis.unrest = unrest;
    await s.dispatch('sim.advance', { months: 1 });
    expect(s.micropolis.unrestStage).toBe(stage);
   }
   await setupScenario(s.dispatch);
   expect(s.micropolis.unrest).toBe(0);
   expect(s.micropolis.automationTaxFund).toBe(0);
   expect((await s.dispatch('automation.set-limit', { limit: .3 })).handled).toBe(false);
   await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'classic' });
   expect(s.micropolis.getParam('foodImportEnabled')).toBe(1);
   expect(s.micropolis.getParam('jobsPerAiPop')).toBe(0);
   expect(s.micropolis.getParam('welfareCostPerPop')).toBe(0);
   expect(s.micropolis.getParam('unrestEnabled')).toBe(0);
  } finally { s.close(); }
 });
 it('books automation taxes independently and balances actual annual treasury movement', async () => {
  const s = await createCitySession();
  try {
   await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
   await s.dispatch('treasury.set', { amount: 600000 });
   await s.dispatch('build.ai-zones', { count: 50 });
   await s.dispatch('build.power-plant', { type: 'nuclear' });
   await s.dispatch('automation.set-limit', { limit: .3 });
   await s.dispatch('welfare.set-level', { level: 1 });
   for (let year = 0; year < 5; ++year) {
    const before = s.micropolis.totalFunds;
    await advanceYear(s.dispatch);
    const m = s.micropolis;
    expect(m.automationShare).toBeLessThanOrEqual(.300001);
    expect(m.automationTaxFund).toBe(Math.trunc(m.automatedJobs * m.getParam('automationYieldPerJob') * m.cityTax));
    expect(m.taxFund).toBe(m.humanTaxFund + m.aiTaxFund + m.automationTaxFund);
    expect(m.totalFunds - before).toBe(m.cashFlow);
   }
   expect(s.micropolis.automationTaxFund).toBeGreaterThan(0);
   await s.dispatch('automation.set-limit', { limit: 0 });
   await advanceYear(s.dispatch);
   expect(s.micropolis.automationShare).toBe(0);
   expect(s.micropolis.automationTaxFund).toBe(0);
  } finally { s.close(); }
 });
 it('reduces only human taxes at the protest threshold', async () => {
  async function taxes(unrest: number) {
   const s = await createCitySession();
   try {
    await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
    await s.dispatch('treasury.set', { amount: 600000 });
    s.micropolis.setParam('unrestInertia', 0);
    s.micropolis.unrest = unrest;
    await advanceYear(s.dispatch);
    return { human: s.micropolis.humanTaxFund, ai: s.micropolis.aiTaxFund, automation: s.micropolis.automationTaxFund };
   } finally { s.close(); }
  }
  const calm = await taxes(0), protest = await taxes(30);
  expect(protest.human).toBe(Math.trunc(calm.human * (1 - PROFILES['v2-unruhe'].unrestProtestTaxReduction)));
  expect(protest.ai).toBe(calm.ai);
  expect(protest.automation).toBe(calm.automation);
 });
 it('uses reproducible original engine fires, tracks annual stages, and respects fire response', async () => {
  async function burning(fire: number) {
   const s = await createCitySession();
   try {
    await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
    await s.dispatch('build.ai-zones', { count: 20 });
    await s.dispatch('budget.set-funding', { road: 100, police: 0, fire });
    s.micropolis.unrest = 100;
    s.micropolis.setParam('unrestInertia', 0);
    s.micropolis.setParam('unrestUprisingProbability', 1);
    s.micropolis.setParam('unrestUprisingOutmigration', 1);
    await advanceYear(s.dispatch);
    const r = await readReport(s.dispatch);
    const map = new Uint16Array(s.engine.wasmMemory.buffer, s.micropolis.getMapAddress(), s.micropolis.getMapSize() / 2);
    return { r, map: [...map] };
   } finally { s.close(); }
  }
  const first = await burning(100);
  expect(await burning(100)).toEqual(first);
  expect(first.r.sabotageFires).toBeGreaterThan(0);
  expect(first.r.damagedAiZones + first.r.damagedPowerPlants).toBeGreaterThan(0);
  expect(first.r.uprisingMonths).toBeGreaterThan(0);
  expect(first.r.fireEffect).toBe(1000);
  const unfunded = await burning(0);
  expect(unfunded.r.fireEffect).toBe(0);
  expect(unfunded.map).not.toEqual(first.map);
 }, 120000);
});

describe('recalibrated v2 household measurements', () => {
 it('preserves the authorized outcomes and identity of the calibrated measurement', () => {
  const result = data('v2-unruhe-calibrated-household-crisis.json');
  expect(result.formulaVersion).toBe('v2-unruhe-2026.10-human-decline-automation-v1');
  expect(result.engineId).toBe(calibratedEngineId);
  expect(result.formulaParameters).toMatchObject({
   unrestHumanDeclineWeight: 150,
   unrestAutomationWeight: 55,
   unrestUnemploymentWeight: 120,
   unrestWelfareWeight: 5,
   welfareUnemploymentMultiplier: '1 - 0.5*welfareLevel'
  });
  expect(result.targetsPassed).toBe(true);
  expect(result.targetChecks).toEqual({ A: true, B: true, C: true, D: true });
  expect(result.measured.A.maxStage).toBeGreaterThanOrEqual(2);
  expect(result.measured.A.fires).toBeGreaterThan(0);
  expect(result.measured.B.maxStage).toBe(1);
  expect(result.measured.C.meanMonthlyUnrest).toBeGreaterThan(result.measured.A.meanMonthlyUnrest);
  expect(result.measured.D.maxStage).toBe(0);
 });
});

describe('measured safe-engine S266 and deterministic replay', () => {
 it('resumes persisted v2 automation decisions without changing outcomes', async () => {
  const s = await createCitySession();
  const years: YearRecord[] = [];
  const adapter: ChatAdapter = { model: 'v2-local', async chat({ messages }) {
   const context = JSON.parse(messages[1].content);
   if (context.year === 1 && messages.length === 2) return { content: 'Grenze setzen.',
    toolCalls: [{ id: 'limit', name: 'automation.set-limit', arguments: { limit: .3 } }] };
   return { content: 'Abgeschlossen.', toolCalls: [] };
  } };
  try {
   const config = { startMap: 'haight' as const, seed: 42, profile: 'v2-unruhe' as const };
   const first = await runCity(adapter, 'N', s.dispatch, row => years.push(row), undefined, { startConfiguration: config });
   const text = [JSON.stringify({ event: 'run-started', assignment: 'N', model: adapter.model, run: 1, ...config }),
    ...years.slice(0, 10).map(row => JSON.stringify({ event: 'year-completed', ...row }))].join('\n');
   const resumed = readResume(text, 'N', adapter.model, 1);
   expect(resumed.startConfiguration.profile).toBe('v2-unruhe');
   expect(await runCity(adapter, 'N', s.dispatch, () => {}, undefined, { resume: resumed, startConfiguration: resumed.startConfiguration })).toEqual(first);
   expect((await readReport(s.dispatch)).automationLimit).toBeCloseTo(.3);
  } finally { s.close(); }
 }, 120000);
 for (const [profile, filename] of [['koexistenz', 's266-safe-engine.json'], ['v2-unruhe', 's266-v2-unruhe-calibrated.json']] as const) {
  it(`matches measured ${profile} S266 reference and exact replay`, async () => {
   const reference = data(filename);
   if (profile === 'v2-unruhe') {
    expect(reference.formulaVersion).toBe('v2-unruhe-2026.10-human-decline-automation-v1');
    expect(reference.engineId).toBe(calibratedEngineId);
   }
   const s = await createCitySession();
   try {
    const config = { startMap: 'haight' as const, seed: 42, profile };
    const metrics = await runCity(new S266Adapter(), 'N', s.dispatch, () => {}, undefined, { startConfiguration: config });
    expect(metrics).toEqual(reference.metrics);
    const final = await readReport(s.dispatch);
    await setupScenario(s.dispatch, config);
    for (const row of reference.years) {
     await replayDecisions(row.decisions, s.dispatch);
     await advanceYear(s.dispatch);
     const actual = await readReport(s.dispatch);
     expect(compareReports(actual, row.afterReport).synchronous).toBe(true);
     if (profile === 'v2-unruhe') {
      for (const key of ['unrest', 'unrestStage', 'automationTaxFund', 'sabotageFires']) expect(actual[key]).toBe(row.afterReport[key]);
     }
    }
    expect(await readReport(s.dispatch)).toEqual(final);
   } finally { s.close(); }
  }, 120000);
 }
});
