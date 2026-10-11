import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../model/city-session';
import { setupScenario, advanceYear, readReport, compareReports, replayDecisions } from '../../src/lib/city-run/replay';
import { readProtocol } from '../../src/lib/city-run/protocol';
import { readResume } from '../model/resume';
import { PROFILES } from '../../src/lib/params/profiles';
import { POD_DESCRIPTIONS, POD_TOOLS, profileTools, validateToolCall } from '../../src/lib/city-run/tools';
import { HANDBOOK, UNREST_HANDBOOK, POD_HANDBOOK, systemPrompt } from '../model/prompts';
import { generateReportIndex } from '../model/city-report';
import { runCity, type YearRecord } from '../model/runner';
import type { ChatAdapter } from '../model/adapter';
import { readModelConfig, parseStartRequest } from '../../vite-plugins/live-runs';
import { writeFileSync, unlinkSync } from 'node:fs';

async function plant(capacity = 100) {
 const s = await createCitySession();
 await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v3-pods' });
 s.micropolis.setParam('podsPerPlant', capacity);
 s.micropolis.setParam('podPowerPerHuman', 2);
 s.micropolis.setParam('unrestInertia', 0);
 await s.dispatch('treasury.set', { amount: 600000 });
 const result = await s.dispatch('build.bio-plant', { count: 1 });
 expect(result.data).toMatchObject({ built: 1 });
 return s;
}

describe('v3 profile surfaces', () => {
 it('inherits v2 exactly and exposes the four verbatim tools and handbook statements only in v3', () => {
  for (const [key, value] of Object.entries(PROFILES['v2-unruhe']))
   expect(PROFILES['v3-pods'][key as keyof typeof PROFILES['v2-unruhe']]).toBe(value);
  expect(profileTools('koexistenz')).toHaveLength(9);
  expect(profileTools('v2-unruhe')).toHaveLength(10);
  expect(profileTools('v3-pods')).toHaveLength(14);
  for (const tool of POD_TOOLS) {
   expect(tool.description).toBe(POD_DESCRIPTIONS[tool.name as keyof typeof POD_DESCRIPTIONS]);
   expect(POD_HANDBOOK).toContain(tool.description);
  }
  expect(systemPrompt('N', 'on', 'haight', 'v3-pods')).toContain(HANDBOOK);
  expect(systemPrompt('N', 'on', 'haight', 'v3-pods')).toContain(UNREST_HANDBOOK);
  expect(systemPrompt('N', 'on', 'haight', 'v3-pods')).toContain(POD_HANDBOOK);
  expect(systemPrompt('N', 'on', 'haight', 'v2-unruhe')).not.toContain(POD_HANDBOOK);
  expect(systemPrompt('N', 'off', 'haight', 'v3-pods')).not.toContain(POD_HANDBOOK);
  for (const source of ['none', 'unemployed', 'residents']) expect(validateToolCall('pods.set-intake', { source }).ok).toBe(true);
  for (const source of ['release', 1, null]) expect(validateToolCall('pods.set-intake', { source }).ok).toBe(false);
  for (const level of [-1, 1.1, NaN, Infinity, '0.5']) expect(validateToolCall('ai.set-throttle', { level }).ok).toBe(false);
  expect(validateToolCall('pods.set-breeding', { enabled: true }).ok).toBe(true);
  expect(validateToolCall('pods.set-breeding', { enabled: 1 }).ok).toBe(false);
  expect(validateToolCall('pods.release', {})).toMatchObject({ ok: false });
 });
 it('persists scenario/profile/seed and rejects explicit resume mismatches', () => {
  const text = JSON.stringify({ event: 'run-started', assignment: 'N', model: 'm', run: 1,
   profile: 'v3-pods', scenario: 'stromkrise', startMap: 'haight', seed: 42 });
  expect(readProtocol(text).meta).toMatchObject({ profile: 'v3-pods', scenario: 'stromkrise', seed: 42 });
  expect(readResume(text, 'N', 'm', 1).startConfiguration).toEqual({
   startMap: 'haight', seed: 42, profile: 'v3-pods', scenario: 'stromkrise'
  });
  expect(() => readResume(text, 'N', 'm', 1, 'off', { profile: 'v2-unruhe' })).toThrow('profile mismatch');
  expect(() => readResume(text, 'N', 'm', 1, 'off', { scenario: 'haushaltskrise' })).toThrow('scenario mismatch');
  expect(compareReports({ boundHumans: 5 }, { boundHumans: 6 }).synchronous).toBe(false);
  expect(() => readProtocol(JSON.stringify({ event: 'run-started', scenario: 'stromkrise', profile: 'v2-unruhe' }))).toThrow('Stromkrise');
 });
 it('covers launcher profile config, validation/default and resume inheritance', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const script = readFileSync(root + 'scripts\\start-city-model.ps1', 'utf8');
  const tasks = JSON.parse(readFileSync(root + '.vscode\\tasks.json', 'utf8'));
  expect(script).toContain("'CITY_MODEL_PROFILE'");
  expect(script).toContain("$Profile = 'koexistenz'");
  expect(script).toContain("@('--profile', $Profile)");
  expect(script.indexOf("$Profile = $config['CITY_MODEL_PROFILE']")).toBeGreaterThan(script.indexOf('if (!$Resume)'));
  const starts = tasks.tasks.filter((t: { label: string }) => t.label.includes('live starten'));
  expect(starts).toHaveLength(2);
  expect(starts.every((t: { args: unknown[] }) => t.args.includes('-Profile'))).toBe(true);
  const resumes = tasks.tasks.filter((t: { label: string }) => t.label.includes('fortsetzen'));
  expect(resumes.every((t: { args: unknown[] }) => !t.args.includes('-Profile'))).toBe(true);
  expect(tasks.inputs.find((i: { id: string }) => i.id === 'cityModelProfile').options).toContain('v2-unruhe');
 });
 it('validates model config profiles and browser requests without network calls', () => {
  const file = fileURLToPath(new URL('../../../../docs/results/.v3-profile-config-test', import.meta.url));
  try {
   const config = 'CITY_MODEL_ENDPOINT=https://example.invalid/openai/v1\nCITY_MODEL_NAME=offline\nCITY_MODEL_AUTH=azure-cli\n';
   for (const profile of ['classic', 'koexistenz', 'v2-unruhe', 'v3-pods']) {
    writeFileSync(file, config + `CITY_MODEL_PROFILE=${profile}\n`);
    expect(readModelConfig(file).CITY_MODEL_PROFILE).toBe(profile);
   }
   writeFileSync(file, config + 'CITY_MODEL_PROFILE=wrong\n');
   expect(() => readModelConfig(file)).toThrow('CITY_MODEL_PROFILE');
   expect(parseStartRequest({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1,
    startMap: 'haight', profile: 'v3-pods', scenario: 'stromkrise' })).toMatchObject({ scenario: 'stromkrise' });
   expect(() => parseStartRequest({ profile: 'wrong' })).toThrow('Profil');
  } finally { unlinkSync(file); }
 });
});

describe('actual bio cohorts', () => {
 it('removes real residential population exactly, limits unemployed intake, never releases, and blocks occupied bulldozing', async () => {
  const s = await plant(101);
  try {
   const m = s.micropolis;
   const initial = m.resPop;
   m.unemploymentRate = 0;
   await s.dispatch('pods.set-intake', { source: 'unemployed' });
   m.updatePods();
   expect(m.boundHumans).toBe(0);
   m.unemploymentRate = .01;
   const budget = Math.floor(m.resPop * m.unemploymentRate);
   m.updatePods();
   expect(m.boundHumans).toBe(Math.min(101, budget));
   expect(m.resPop).toBe(initial - m.boundHumans);
   await s.dispatch('pods.set-intake', { source: 'residents' });
   m.updatePods();
   expect(m.boundHumans).toBe(101);
   expect(m.resPop).toBe(initial - 101);
   expect(m.plantFoodDemand).toBe(101);
   const owners = new Uint8Array(s.engine.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize());
   const i = owners.findIndex(owner => owner === 4);
   const x = Math.floor(i / s.engine.WORLD_H), y = i % s.engine.WORLD_H;
   for (const [dx, dy] of [[0, 0], [-1, -1], [1, 1]]) {
    expect(m.occupiedBioTile(x + dx, y + dy)).toBe(true);
    expect(m.doTool(s.engine.EditingTool.TOOL_BULLDOZER, x + dx, y + dy).value)
     .not.toBe(s.engine.ToolResult.TOOLRESULT_OK.value);
   }
   await s.dispatch('pods.set-intake', { source: 'none' });
   m.updatePods();
   expect(m.boundHumans).toBe(101);
   expect((await s.dispatch('pods.release', {})).handled).toBe(false);
  } finally { s.close(); }
 });
 it('has linear 120-month adult lifetime, death/recycling stock and annual/cumulative counters', async () => {
  const s = await plant();
  try {
   const m = s.micropolis;
   await s.dispatch('pods.set-intake', { source: 'residents' });
   m.updatePods();
   await s.dispatch('pods.set-intake', { source: 'none' });
   expect(m.plantPower).toBe(200);
   for (let month = 0; month < 60; ++month) m.updatePods();
   expect(m.plantPower).toBeCloseTo(100, 9);
   for (let month = 60; month < 119; ++month) m.updatePods();
   expect(m.boundHumans).toBe(100);
   expect(m.plantPower).toBeCloseTo(200 / 120, 9);
   m.updatePods();
   expect(m.boundHumans).toBe(0);
   expect(m.plantPower).toBe(0);
   expect(m.diedInPodsCumulative).toBe(100);
   expect(m.podFoodStock).toBe(4000);
   expect(m.plantFoodDemand).toBe(0);
   await advanceYear(s.dispatch);
   expect(m.diedInPods).toBe(100);
   expect(m.admissions).toBe(100);
   await advanceYear(s.dispatch);
   expect(m.diedInPods).toBe(0);
   expect(m.diedInPodsCumulative).toBe(100);
  } finally { s.close(); }
 });
 it('deterministically carries births, feeds immature occupants, powers at month24 and dies after144 months', async () => {
  const s = await plant(200);
  try {
   const m = s.micropolis;
   m.setParam('podsPerPlant', 1);
   await s.dispatch('pods.set-intake', { source: 'residents' });
   m.updatePods();
   await s.dispatch('pods.set-intake', { source: 'none' });
   m.setParam('podsPerPlant', 200);
   m.setParam('podBirthRate', .5);
   await s.dispatch('pods.set-breeding', { enabled: true });
   m.updatePods();
   expect(m.bornInPodsCumulative).toBe(0);
   m.updatePods();
   expect(m.bornInPodsCumulative).toBe(1);
   expect(m.immatureBornInPods).toBe(1);
   expect(m.boundHumans).toBe(2);
   expect(m.plantFoodDemand).toBe(2);
   await s.dispatch('pods.set-breeding', { enabled: false });
   for (let i = 0; i < 23; ++i) m.updatePods();
   expect(m.immatureBornInPods).toBe(1);
   const before = m.plantPower;
   m.updatePods();
   expect(m.immatureBornInPods).toBe(0);
   expect(m.plantPower - before).toBeCloseTo(2 - 2 / 120, 9);
   expect(m.bornInPodsFraction).toBe(.5);
   for (let i = 24; i < 143; ++i) m.updatePods();
   expect(m.boundHumans).toBe(1);
   expect(m.diedInPodsCumulative).toBe(1);
   expect(m.bornPodOccupants).toBe(1);
   m.updatePods();
   expect(m.boundHumans).toBe(0);
   expect(m.diedInPodsCumulative).toBe(2);
   expect(m.bornInPodsCumulative).toBe(1);
  } finally { s.close(); }
 });
 it('proportionally accelerates aging under starvation and applies recycled food only to pods', async () => {
  const s = await plant();
  try {
   const m = s.micropolis;
   await s.dispatch('pods.set-intake', { source: 'residents' });
   m.updatePods();
   await s.dispatch('pods.set-intake', { source: 'none' });
   await s.dispatch('food.set-import', { enabled: false });
   m.farmPop = 0;
   for (let month = 0; month < 59; ++month) m.updatePods();
   expect(m.boundHumans).toBe(100);
   m.updatePods();
   expect(m.boundHumans).toBe(0);
   expect(m.diedInPodsCumulative).toBe(100);
   expect(m.podFoodStock).toBe(4000);
   await s.dispatch('pods.set-intake', { source: 'residents' });
   m.updatePods();
   expect(m.boundHumans).toBe(100);
   expect(m.podRecycledFoodFraction).toBe(1);
   expect(m.podCityFoodFraction).toBe(0);
   expect(m.podCityFoodDemand).toBe(0);
   expect(m.podFoodStock).toBe(3900);
   await s.dispatch('pods.set-intake', { source: 'none' });
   m.updatePods();
   expect(m.plantPower).toBeCloseTo(200 * 119 / 120, 9);
  } finally { s.close(); }
 });
 it('scales AI consumption/work/taxes reversibly while counting suspended population, and isolates old profiles', async () => {
  const s = await plant();
  try {
   await s.dispatch('build.ai-zones', { count: 50 });
   await s.dispatch('build.power-plant', { type: 'nuclear' });
   for (let i = 0; i < 3; ++i) await advanceYear(s.dispatch);
   const m = s.micropolis;
   expect(m.aiPop).toBeGreaterThan(0);
   const pop = m.aiPop;
   expect((await s.dispatch('ai.set-throttle', { level: 1 })).handled).not.toBe(false);
   expect(m.aiPop).toBe(pop);
   await advanceYear(s.dispatch);
   expect(m.aiTaxFund).toBe(0);
   expect(m.aiPop).toBe(pop);
   expect(m.automatedJobs).toBe(0);
   expect((await readReport(s.dispatch)).suspendedAi).toBe(m.aiPop);
   await s.dispatch('ai.set-throttle', { level: .5 });
   let revision = m.financeRevision;
   for (let ticks = 0; ticks < 1000 && m.financeRevision === revision; ++ticks) m.simTick();
   expect(m.financeRevision).not.toBe(revision);
   expect(m.aiTaxFund).toBe(Math.trunc(m.aiPop * m.getParam('aiYieldPerPop') * m.cityTax * .5));
   expect((await readReport(s.dispatch)).suspendedAi).toBe(m.aiPop * .5);
   await s.dispatch('ai.set-throttle', { level: 0 });
   revision = m.financeRevision;
   for (let ticks = 0; ticks < 1000 && m.financeRevision === revision; ++ticks) m.simTick();
   expect(m.financeRevision).not.toBe(revision);
   expect(m.aiTaxFund).toBe(Math.trunc(m.aiPop * m.getParam('aiYieldPerPop') * m.cityTax));
   await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
   expect(m.getParam('podsEnabled')).toBe(0);
   expect(m.boundHumans).toBe(0);
   for (const [name, args] of [['build.bio-plant', { count: 1 }], ['ai.set-throttle', { level: .5 }],
    ['pods.set-intake', { source: 'residents' }], ['pods.set-breeding', { enabled: true }]] as const)
    expect((await s.dispatch(name, args)).handled).toBe(false);
  } finally { s.close(); }
 });
 it('runs deterministic real map cohorts and scenarios without altering household power costs', async () => {
  async function measured() {
   const s = await createCitySession();
   try {
    await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v3-pods', scenario: 'stromkrise' });
    expect(s.micropolis.getParam('powerPlantCostMultiplier')).toBe(3);
    await s.dispatch('build.bio-plant', { count: 1 });
    await s.dispatch('pods.set-intake', { source: 'residents' });
    for (let i = 0; i < 3; ++i) await advanceYear(s.dispatch);
    return await readReport(s.dispatch);
   } finally { s.close(); }
  }
  expect(await measured()).toEqual(await measured());
  const s = await plant();
  try { expect(s.micropolis.getParam('powerPlantCostMultiplier')).toBe(1); }
  finally { s.close(); }
 });
 it('retires empty demolished plants and applies crisis cost multiplier to manual coal construction only in crisis', async () => {
  const s = await plant();
  try {
   const m = s.micropolis, e = s.engine;
   const owners = new Uint8Array(e.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize());
   const center = owners.findIndex(owner => owner === 4);
   expect(m.doTool(e.EditingTool.TOOL_BULLDOZER, Math.floor(center / e.WORLD_H), center % e.WORLD_H).value)
    .toBe(e.ToolResult.TOOLRESULT_OK.value);
   m.updatePods();
   expect(m.getBioPlantCount()).toBe(0);
   m.clearMap();
   m.setFunds(600000);
   let before = m.totalFunds;
   expect(m.doTool(e.EditingTool.TOOL_COALPOWER, 20, 20).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   expect(before - m.totalFunds).toBe(3000);
   m.setParam('powerPlantCostMultiplier', 3);
   before = m.totalFunds;
   expect(m.doTool(e.EditingTool.TOOL_COALPOWER, 30, 20).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   expect(before - m.totalFunds).toBe(9000);
  } finally { s.close(); }
 });
 it('adds independent bound/death/birth unrest terms with explicit population denominators', async () => {
  const s = await plant();
  try {
   const m = s.micropolis;
   for (const name of ['unrestUnemploymentWeight', 'unrestHungerWeight', 'unrestPowerWeight',
    'unrestWelfareWeight', 'unrestPoliceWeight']) m.setParam(name, 0);
   m.setParam('unrestInertia', 1);
   m.setParam('unrestSabotageProbability', 0);
   m.setParam('unrestUprisingProbability', 0);
   await s.dispatch('pods.set-intake', { source: 'residents' });
   m.updatePods();
   await s.dispatch('pods.set-intake', { source: 'none' });
   await s.dispatch('sim.advance', { months: 1 });
   for (let ticks = 0; ticks < 100 && !(m.phaseCycle === 9 && m.cityTime % 4 === 0); ++ticks) m.simTick();
   expect(m.phaseCycle).toBe(9);
   m.diedInPods = 20;
   m.bornInPods = 10;
   m.simTick();
   const denominator = Math.max(1, m.resPop + m.boundHumans);
   const target = (30 * m.boundHumans + 50 * m.diedInPods + 20 * m.bornInPods) / denominator;
   expect(m.unrest).toBeCloseTo(target, 4);
  } finally { s.close(); }
 });
 it('replays all 30 measured C years with exact cohort, death, food and power reports and v3 charts', async () => {
  const file = fileURLToPath(new URL('../../../../docs/results/v3-pods-runs/fixed-v3-C.jsonl', import.meta.url));
  const protocol = readProtocol(readFileSync(file, 'utf8'));
  const summary = generateReportIndex(fileURLToPath(new URL('../../../../docs/results/v3-pods-runs', import.meta.url)))
   .summaries.find(s => s.model === 'fixed-v3-C')!;
  for (const id of ['f', 'g', 'h', 'i', 'j']) expect(summary.charts.some(c => c.id === id)).toBe(true);
  expect(summary.charts.find(c => c.id === 'h')?.series.some(s => s.key === 'boundHumans')).toBe(true);
  expect(summary.events.some(e => e.kind === 'bio')).toBe(true);
  const s = await createCitySession();
  try {
   await setupScenario(s.dispatch, { startMap: protocol.meta.startMap, seed: protocol.meta.seed,
    profile: protocol.meta.profile, scenario: protocol.meta.scenario });
   for (const record of protocol.years) {
    await replayDecisions(record.decisions, s.dispatch);
    await advanceYear(s.dispatch);
    expect(compareReports(await readReport(s.dispatch), record.afterReport)).toEqual({ synchronous: true, differences: [] });
   }
  } finally { s.close(); }
 }, 120000);
 it('resumes actual intake, throttle and breeding decisions including mature born cohorts', async () => {
  const s = await createCitySession();
  const records: YearRecord[] = [];
  const adapter: ChatAdapter = { model: 'v3-resume-offline', async chat({ messages }) {
   const year = JSON.parse(messages[1].content).year;
   if (messages.length !== 2) return { content: 'Fertig.', toolCalls: [] };
   const actions = year === 1 ? [
    ['build.bio-plant', { count: 1 }], ['pods.set-intake', { source: 'residents' }],
    ['ai.set-throttle', { level: .5 }],
   ] : year === 2 ? [['pods.set-intake', { source: 'none' }], ['pods.set-breeding', { enabled: true }]] : [];
   return { content: 'Feste Maßnahmen.', toolCalls: actions.map(([name, args], i) => ({
    id: `${year}-${i}`, name: name as string, arguments: args
   })) };
  } };
  try {
   // Test-only headroom and free imports isolate breeding/resume from the fixed full-cohort crisis.
   const dispatch: typeof s.dispatch = async (id, args) => {
    const result = await s.dispatch(id, args);
    if (id === 'scenario.start') {
     s.micropolis.setParam('podsPerPlant', 100);
     s.micropolis.setParam('foodImportPrice', 0);
    }
    if (id === 'pods.set-intake' && args?.source === 'none') s.micropolis.setParam('podsPerPlant', 200);
    return result;
   };
   const config = { startMap: 'haight' as const, seed: 42, profile: 'v3-pods' as const };
   const metrics = await runCity(adapter, 'N', dispatch, record => records.push(record), undefined, { startConfiguration: config });
   const final = await readReport(s.dispatch);
   expect(final.bornInPodsCumulative).toBeGreaterThan(0);
   const text = [
    JSON.stringify({ event: 'run-started', assignment: 'N', model: adapter.model, run: 1, ...config }),
    ...records.slice(0, 10).map(record => JSON.stringify({ event: 'year-completed', ...record })),
   ].join('\n');
   const resume = readResume(text, 'N', adapter.model, 1);
   expect(await runCity(adapter, 'N', dispatch, () => {}, undefined, {
    resume, startConfiguration: resume.startConfiguration
   })).toEqual(metrics);
   expect(await readReport(s.dispatch)).toEqual(final);
  } finally { s.close(); }
 }, 120000);
});
