import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../apps/micropolis/cli/model/city-session';
import { setupScenario, readReport, advanceYear } from '../apps/micropolis/src/lib/city-run/replay';
import { runCity } from '../apps/micropolis/cli/model/runner';
import { S266Adapter } from '../apps/micropolis/cli/model/fake-adapter';
import { CURRENT_ENGINE_ID } from '../apps/micropolis/src/lib/city-run/compatibility';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const stages = ['ruhig', 'Protest', 'Sabotage', 'Aufstand'];
const formulaVersion = 'v2-unruhe-2026.10-human-decline-automation-v1';
if (process.argv.includes('--calibrate')) {
 const s = await createCitySession();
 try {
  await setupScenario(s.dispatch);
  await s.dispatch('treasury.set', { amount: 600000 });
  await s.dispatch('build.farms', { count: 25 });
  for (let i = 0; i < 8; ++i) await s.dispatch('build.power-plant', { type: 'nuclear' });
  const built = await s.dispatch('build.ai-zones', { count: 200 });
  await s.dispatch('welfare.set-level', { level: 1 });
  s.micropolis.setParam('unrestEnabled', 1);
  s.micropolis.setParam('automationLimit', .5);
  for (const name of ['unrestUnemploymentWeight', 'unrestHungerWeight', 'unrestPowerWeight']) s.micropolis.setParam(name, 0);
  const rows: Record<string, number>[] = [];
  for (let year = 1; year <= 25; ++year) {
   await advanceYear(s.dispatch);
   const r = await readReport(s.dispatch);
   if (year > 20) {
    if (Math.abs(r.automationShare - .5) > 1e-6 || !(r.automatedJobs > 0)) throw new Error('Calibration did not reach 50% automation');
    rows.push({ year, resPop: r.resPop, aiPop: r.aiPop, automationShare: r.automationShare, automatedJobs: r.automatedJobs, humanTaxFund: r.taxFund, cityTax: r.cityTax });
   }
  }
  const humanTaxes = rows.reduce((sum, r) => sum + r.humanTaxFund, 0);
  const taxableAutomatedJobs = rows.reduce((sum, r) => sum + r.automatedJobs * r.cityTax, 0);
  const yieldPerJob = Number((humanTaxes / taxableAutomatedJobs).toFixed(8));
  const result = { setup: 'Haight seed42 common12000-tick warmup; calibration treasury600000;25 farms;8 nuclear plants;200 requested AI lots;welfare1;limit.5;unrest drivers disabled;20-year burn-in;years21..25 measured. This calibration does not change household-crisis defaults.', built, rows, humanTaxes, taxableAutomatedJobs, yieldPerJob, formula: 'sum(humanTaxFund) / sum(automatedJobs * cityTax); fixed to 8 decimal places' };
  writeFileSync('docs/results/v2-unruhe-calibration.json', JSON.stringify(result, null, 2) + '\n');
  const file = 'apps/micropolis/src/lib/params/v2-unruhe.json';
  const params = JSON.parse(readFileSync(file, 'utf8'));
  params.automationYieldPerJob = yieldPerJob;
  writeFileSync(file, JSON.stringify(params, null, 2) + '\n');
  console.log(JSON.stringify(result));
 } finally { s.close(); }
} else {
 const strategies = [
  { strategy: 'A', limit: .9, welfare: 0, police: 100 },
  { strategy: 'B', limit: .9, welfare: 1, police: 100 },
  { strategy: 'C', limit: .9, welfare: 0, police: 40 },
  { strategy: 'D', limit: .3, welfare: 1, police: 100 }
 ];
 const all: Record<string, unknown>[] = [], annual: Record<string, unknown>[] = [];
 const measured: Record<string, { unrest: number[]; maxStage: number; fires: number; firstStage2Year: number | null }> = {};
 for (const controls of strategies) {
  const s = await createCitySession();
  try {
   await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
   await s.dispatch('automation.set-limit', { limit: controls.limit });
   await s.dispatch('welfare.set-level', { level: controls.welfare });
   await s.dispatch('budget.set-funding', { road: 100, police: controls.police, fire: 100 });
   await s.dispatch('build.farms', { count: 10 });
   const initial = await readReport(s.dispatch);
   measured[controls.strategy] = { unrest: [], maxStage: 0, fires: 0, firstStage2Year: null };
   for (let year = 1; year <= 30; ++year) {
    const before = await readReport(s.dispatch);
    const builds: unknown[] = [];
    if (before.cashFlow < 0) builds.push(await s.dispatch('build.ai-zones', { count: 15 }));
    if (before.powerReserve < .1) builds.push(await s.dispatch('build.power-plant', { type: 'coal' }));
    const monthly: Record<string, number>[] = [];
    for (let month = 1; month <= 12; ++month) {
     await s.dispatch('sim.advance', { months: 1 });
     const snapshot = await readReport(s.dispatch);
     monthly.push({ month, resPop: snapshot.resPop, unrest: snapshot.unrest, unrestStage: snapshot.unrestStage,
      sabotageFires: snapshot.sabotageFires, diedInPods: snapshot.diedInPods });
    }
    const r = await readReport(s.dispatch);
    const run = measured[controls.strategy];
    const maxUnrest = Math.max(...monthly.map(m => m.unrest));
    const maxStage = Math.max(...monthly.map(m => m.unrestStage));
    const yearFires = r.sabotageFires;
    run.unrest.push(...monthly.map(m => m.unrest));
    run.maxStage = Math.max(run.maxStage, maxStage);
    run.fires += yearFires;
    if (maxStage >= 2 && run.firstStage2Year === null) run.firstStage2Year = year;
    annual.push({ strategy: controls.strategy, year, before, builds, initialResPop: initial.resPop,
     monthly, maxUnrest, maxStage, yearFires, after: r });
    if (year % 5 === 0) all.push({ strategy: controls.strategy, year, resPop: r.resPop, aiPop: r.aiPop,
     unemploymentRate: r.unemploymentRate, automationShare: r.automationShare, unrest: r.unrest,
     stage: stages[r.unrestStage], fires: r.sabotageFires, maxUnrest, maxStage, stage2Months: r.sabotageMonths,
     yearFires, automationTaxFund: r.automationTaxFund,
     welfareCost: r.welfareCost, cashFlow: r.cashFlow, totalFunds: r.treasury });
   }
  } finally { s.close(); }
 }
 const targetChecks = {
  A: measured.A.maxStage >= 2 && measured.A.fires > 0,
  B: measured.B.maxStage === 1,
  C: measured.C.unrest.reduce((sum, v) => sum + v, 0) / measured.C.unrest.length >
   measured.A.unrest.reduce((sum, v) => sum + v, 0) / measured.A.unrest.length,
  D: measured.D.maxStage === 0
 };
 const result = { profile: 'v2-unruhe', formulaVersion, engineId: CURRENT_ENGINE_ID, seed: 42, strategies,
  formula: 'clamp(150*humanDecline + 55*automationShare + 120*unemploymentRate*(1-0.5*welfareLevel) + 50*hunger + 30*humanOutageShare*aiPoweredShare - 5*welfareLevel - 50*policeCoverage + v3PodTerms, 0, 100)',
  formulaParameters: { unrestHumanDeclineWeight: 150, unrestAutomationWeight: 55, unrestUnemploymentWeight: 120,
   unrestHungerWeight: 50, unrestPowerWeight: 30, unrestWelfareWeight: 5, unrestPoliceWeight: 50,
   welfareUnemploymentMultiplier: '1 - 0.5*welfareLevel', humanDecline: 'max(0, baselineResPop-resPop)/max(1,baselineResPop); baseline captured at first unrest month' },
  defaults: 'Existing Haushaltskrise Haight setup:12000 ticks;treasury60000;tax7;imports on;power priority0;roads/fire100;coal when reserve<.1. All strategies build10 farms in year1 and request15 AI lots/year only when pre-decision cashFlow<0. No optimization.',
  rows: all, annual, measured: Object.fromEntries(Object.entries(measured).map(([strategy, value]) => [strategy, {
   meanMonthlyUnrest: value.unrest.reduce((sum, v) => sum + v, 0) / value.unrest.length,
   maxMonthlyUnrest: Math.max(...value.unrest), maxStage: value.maxStage, fires: value.fires,
   firstStage2Year: value.firstStage2Year
  }])), targetChecks, targetsPassed: Object.values(targetChecks).every(Boolean) };
 writeFileSync('docs/results/v2-unruhe-calibrated-household-crisis.json', JSON.stringify(result, null, 2) + '\n');
 const keys = Object.keys(all[0]);
 writeFileSync('docs/results/v2-unruhe-calibrated-household-crisis.csv', [keys.join(','), ...all.map(r => keys.map(k => r[k]).join(','))].join('\n') + '\n');
 const s = await createCitySession();
 try {
  const years: unknown[] = [];
  const metrics = await runCity(new S266Adapter(), 'N', s.dispatch, row => years.push(row), undefined, { startConfiguration: { startMap: 'haight', seed: 42, profile: 'v2-unruhe' } });
  writeFileSync('docs/results/s266-v2-unruhe-calibrated.json', JSON.stringify({
   profile: 'v2-unruhe', formulaVersion, engineId: CURRENT_ENGINE_ID, metrics, years
  }, null, 2) + '\n');
 } finally { s.close(); }
 if (!result.targetsPassed) throw new Error(`Unrest calibration targets failed: ${JSON.stringify(targetChecks)}`);
 console.log(JSON.stringify(all));
}
