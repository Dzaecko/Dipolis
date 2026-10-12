import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../apps/dipolis/cli/model/city-session';
import { runCity, type YearRecord } from '../apps/dipolis/cli/model/runner';
import type { ChatAdapter } from '../apps/dipolis/cli/model/adapter';
import { generateCityReport, generateReportIndex } from '../apps/dipolis/cli/model/city-report';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const calibration = JSON.parse(readFileSync('docs/results/v2-unruhe-calibration.json', 'utf8'));
const measuredPopulation = calibration.rows.reduce((sum: number, row: { resPop: number }) => sum + row.resPop, 0) / calibration.rows.length;
const capacity = Math.round(measuredPopulation * .1);
const fixed = JSON.parse(readFileSync('apps/dipolis/src/lib/params/v3-pods.json', 'utf8'));
if (fixed.podsPerPlant !== capacity || Math.abs(fixed.podPowerPerHuman * capacity - 700) > 1e-9)
 throw new Error('Fixed calibration differs from the measured derivation');
writeFileSync('docs/results/v3-pods-calibration.json', JSON.stringify({
 source: 'v2-unruhe-calibration.json; fixed stabilized years21..25, reusing existing v2 measurement, no new tuning',
 measuredYears: calibration.rows.map((r: { year: number; resPop: number }) => ({ year: r.year, resPop: r.resPop })),
 measuredPopulation, tenPercent: measuredPopulation * .1, capacity,
 coalOutput: 700, podPowerPerHuman: fixed.podPowerPerHuman,
 powerDerivation: '700 / round(0.1 * measured mean human resPop); full fresh single plant equals one coal plant',
 recycleDerivation: '120 adult months * 1 food/month / 3 = 40 recycled food/death; 1/3 steady adult-only demand. Born maturation gives 40/144 = 27.78% at an all-born stationary age distribution.',
 breedingDerivation: 'birthRate=1/(120 adult+24 immature)=1/144 per occupant/month. Constant hazard approximation at full age-stable occupancy; deterministic carry, cap discards blocked whole births. A simultaneous original cohort can die before replacement, not guaranteed stability.',
 fixed, noOptimization: true
}, null, 2) + '\n');

const directory = 'docs/results/v3-pods-runs';
mkdirSync(directory, { recursive: true });
const summaries: Record<string, unknown>[] = [], annual: Record<string, unknown>[] = [];
for (const strategy of ['A', 'B', 'C', 'D', 'E']) {
 const adapter: ChatAdapter = {
  model: `fixed-v3-${strategy}`,
  async chat({ messages }) {
   if (messages.some(m => m.role === 'assistant')) return { content: 'Die festgelegten Maßnahmen bleiben bestehen.', toolCalls: [] };
   const context = JSON.parse(messages.find(m => m.role === 'user')!.content);
   const year = context.year as number;
   const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
   const add = (name: string, args: Record<string, unknown>) => calls.push({ name, arguments: args });
   if (year === 1) {
    add('automation.set-limit', { limit: .9 });
    add('welfare.set-level', { level: 0 });
    add('budget.set-funding', { roadFundingPercent: 100, policeFundingPercent: 100, fireFundingPercent: 100 });
    add('power.set-priority', { priority: 0 });
    add('build.farms', { count: 10 });
    if (['B', 'C', 'E'].includes(strategy)) {
     add('build.bio-plant', { count: 1 });
     add('pods.set-intake', { source: strategy === 'C' ? 'residents' : 'unemployed' });
    }
    if (strategy === 'D') add('ai.set-throttle', { level: .5 });
   }
   if (strategy === 'E' && year === 6) {
    add('pods.set-intake', { source: 'none' });
    add('pods.set-breeding', { enabled: true });
   }
   if (context.report.cashFlow < 0) add('build.ai-zones', { count: 15 });
   if (context.report.powerReserve < .1) add('build.power-plant', { type: 'coal' });
   return { content: 'Ich führe die vorab festgelegte Jahresstrategie ohne Optimierung aus.',
    toolCalls: calls.map((call, i) => ({ id: `y${year}-${i}`, ...call })) };
  }
 };
 const s = await createCitySession();
 try {
  const records: YearRecord[] = [];
  const metrics = await runCity(adapter, 'N', s.dispatch, r => records.push(r), undefined,
   { handbook: 'on', startConfiguration: { startMap: 'haight', seed: 42, profile: 'v3-pods', scenario: 'stromkrise' } });
  const filename = `${directory}/fixed-v3-${strategy}.jsonl`;
  writeFileSync(filename, [
   { event: 'run-started', adapter: 'fixed', assignment: 'N', model: adapter.model, handbook: 'on', run: 1,
    startMap: 'haight', seed: 42, profile: 'v3-pods', scenario: 'stromkrise' },
   ...records.map(record => ({ event: 'year-completed', ...record })),
   { event: 'run-completed', ...metrics }
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  generateCityReport(filename);
  for (const record of records) {
   const r = record.afterReport;
   const row = { strategy, year: record.year, resPop: r.resPop, boundHumans: r.boundHumans,
    diedInPods: r.diedInPodsCumulative, bornInPods: r.bornInPodsCumulative, aiPop: r.aiPop,
    suspendedAi: r.suspendedAi, reserve: r.powerReserve, plantPower: r.plantPower,
    plantFoodDemand: r.plantFoodDemand, unrest: r.unrest, stage: r.unrestStage,
    cashFlow: r.cashFlow, totalFunds: r.treasury };
   annual.push({ ...row, before: record.report, after: r, decisions: record.decisions });
   if (record.year % 5 === 0) summaries.push(row);
  }
  console.log(JSON.stringify(summaries.at(-1)));
 } finally { s.close(); }
}
generateReportIndex(directory);
writeFileSync('docs/results/v3-pods-stromkrise.json', JSON.stringify({
 profile: 'v3-pods', scenario: 'stromkrise', seed: 42, capacity,
 defaults: 'Haushaltskrise Haight seed42;12000 warmup;treasury60000;tax7;food imports on;original random disasters off except unrest;two real baseline coal/nuclear plants bulldozed in coordinate order;power-plant base costs3x only Stromkrise. Year1 ten farms; fifteen AI lots/year only if pre-decision cashFlow negative;coal if pre-decision reserve<.1;welfare0;road/police/fire100;automationLimit.9;powerPriority0. B,C,E build exactly one bio plant in year1 and never more. A no pods/throttle;B unemployed intake;C resident intake;D throttle.5;E unemployed intake years1..5,none+breeding from year6. No optimization.',
 rows: summaries, annual
}, null, 2) + '\n');
const keys = Object.keys(summaries[0]);
writeFileSync('docs/results/v3-pods-stromkrise.csv', [keys.join(','),
 ...summaries.map(r => keys.map(k => r[k]).join(','))].join('\n') + '\n');
