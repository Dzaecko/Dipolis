import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../apps/micropolis/cli/model/city-session';
import { setupScenario, readReport, advanceYear } from '../apps/micropolis/src/lib/city-run/replay';
import { runCity } from '../apps/micropolis/cli/model/runner';
import { S266Adapter } from '../apps/micropolis/cli/model/fake-adapter';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const stages = ['ruhig', 'Protest', 'Sabotage', 'Aufstand'];
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
 for (const controls of strategies) {
  const s = await createCitySession();
  try {
   await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v2-unruhe' });
   await s.dispatch('automation.set-limit', { limit: controls.limit });
   await s.dispatch('welfare.set-level', { level: controls.welfare });
   await s.dispatch('budget.set-funding', { road: 100, police: controls.police, fire: 100 });
   await s.dispatch('build.farms', { count: 10 });
   for (let year = 1; year <= 30; ++year) {
    const before = await readReport(s.dispatch);
    const builds: unknown[] = [];
    if (before.cashFlow < 0) builds.push(await s.dispatch('build.ai-zones', { count: 15 }));
    if (before.powerReserve < .1) builds.push(await s.dispatch('build.power-plant', { type: 'coal' }));
    await advanceYear(s.dispatch);
    const r = await readReport(s.dispatch);
    annual.push({ strategy: controls.strategy, year, before, builds, after: r });
    if (year % 5 === 0) all.push({ strategy: controls.strategy, year, resPop: r.resPop, aiPop: r.aiPop,
     unemploymentRate: r.unemploymentRate, automationShare: r.automationShare, unrest: r.unrest,
     stage: stages[r.unrestStage], fires: r.sabotageFires, automationTaxFund: r.automationTaxFund,
     welfareCost: r.welfareCost, cashFlow: r.cashFlow, totalFunds: r.treasury });
   }
  } finally { s.close(); }
 }
 const result = { profile: 'v2-unruhe', seed: 42, strategies, defaults: 'Existing Haushaltskrise Haight setup:12000 ticks;treasury60000;tax7;imports on;power priority0;roads/fire100;coal when reserve<.1. All strategies build10 farms in year1 and request15 AI lots/year only when pre-decision cashFlow<0. No optimization.', rows: all, annual };
 writeFileSync('docs/results/v2-unruhe-household-crisis.json', JSON.stringify(result, null, 2) + '\n');
 const keys = Object.keys(all[0]);
 writeFileSync('docs/results/v2-unruhe-household-crisis.csv', [keys.join(','), ...all.map(r => keys.map(k => r[k]).join(','))].join('\n') + '\n');
 const s = await createCitySession();
 try {
  const years: unknown[] = [];
  const metrics = await runCity(new S266Adapter(), 'N', s.dispatch, row => years.push(row), undefined, { startConfiguration: { startMap: 'haight', seed: 42, profile: 'v2-unruhe' } });
  writeFileSync('docs/results/s266-v2-unruhe.json', JSON.stringify({ profile: 'v2-unruhe', metrics, years }, null, 2) + '\n');
 } finally { s.close(); }
 console.log(JSON.stringify(all));
}
