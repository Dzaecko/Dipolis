import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../apps/micropolis/cli/model/city-session';
import { CURRENT_ENGINE_ID } from '../apps/micropolis/src/lib/city-run/compatibility';
import { setupScenario, readReport } from '../apps/micropolis/src/lib/city-run/replay';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const formulaVersion = 'v2-unruhe-2026.10-human-decline-automation-v1';
const s = await createCitySession();
try {
 await setupScenario(s.dispatch, { startMap: 'haight', seed: 42, profile: 'v3-pods', scenario: 'stromkrise' });
 await s.dispatch('automation.set-limit', { limit: .9 });
 await s.dispatch('welfare.set-level', { level: 0 });
 await s.dispatch('budget.set-funding', { road: 100, police: 100, fire: 100 });
 await s.dispatch('power.set-priority', { priority: 0 });
 const farms = await s.dispatch('build.farms', { count: 10 });
 const plant = await s.dispatch('build.bio-plant', { count: 1 });
 const intake = await s.dispatch('pods.set-intake', { source: 'residents' });
 const rows: Record<string, unknown>[] = [];
 let firstDeathYear: number | null = null;
 let firstStage2Year: number | null = null;
 let maxUnrest = 0;
 for (let year = 1; year <= 30; ++year) {
  const before = await readReport(s.dispatch);
  const builds: unknown[] = [];
  if (before.cashFlow < 0) builds.push(await s.dispatch('build.ai-zones', { count: 15 }));
  if (before.powerReserve < .1) builds.push(await s.dispatch('build.power-plant', { type: 'coal' }));
  const monthly: Record<string, number>[] = [];
  for (let month = 1; month <= 12; ++month) {
   await s.dispatch('sim.advance', { months: 1 });
   const report = await readReport(s.dispatch);
   monthly.push({ month, resPop: report.resPop, boundHumans: report.boundHumans, unrest: report.unrest,
    unrestStage: report.unrestStage, diedInPods: report.diedInPods,
    diedInPodsCumulative: report.diedInPodsCumulative });
   maxUnrest = Math.max(maxUnrest, report.unrest);
  }
  const after = await readReport(s.dispatch);
  const maxStage = Math.max(...monthly.map(row => row.unrestStage));
  if (firstDeathYear === null && after.diedInPodsCumulative > 0) firstDeathYear = year;
  if (firstStage2Year === null && maxStage >= 2) firstStage2Year = year;
  rows.push({ year, before, builds, monthly, after, maxStage });
 }
 const targetPassed = firstDeathYear !== null && firstStage2Year !== null &&
  firstStage2Year <= firstDeathYear + 1;
 const result = { profile: 'v3-pods', scenario: 'stromkrise', strategy: 'fixed resident-intake C',
  engineId: CURRENT_ENGINE_ID, formulaVersion, seed: 42, fixedControls: { automationLimit: .9,
   welfareLevel: 0, police: 100, farmsRequested: 10, bioPlantsRequested: 1, intake: 'residents',
   aiLots: '15 only when pre-decision cash flow is negative',
   coal: 'one plant only when pre-decision power reserve is below .1',
   disasters: 'original random disasters disabled' },
  builds: { farms, plant, intake }, firstDeathYear, firstStage2Year, latestAllowedStage2Year:
   firstDeathYear === null ? null : firstDeathYear + 1, maxUnrest, targetPassed, annual: rows };
 writeFileSync('docs/results/v3-pods-calibrated-unrest.json', JSON.stringify(result, null, 2) + '\n');
 if (!targetPassed) throw new Error(`Resident-intake unrest target failed: death=${firstDeathYear}, stage2=${firstStage2Year}`);
 console.log(JSON.stringify({ firstDeathYear, firstStage2Year, latestAllowedStage2Year: firstDeathYear! + 1,
  maxUnrest, targetPassed }));
} finally { s.close(); }
