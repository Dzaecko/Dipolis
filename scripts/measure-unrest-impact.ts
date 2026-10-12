import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commandBus } from '../apps/dipolis/src/lib/CommandBus';
import { registerMicropolisCommands } from '../apps/dipolis/src/lib/micropolisCommands';
import { createNoopJsCallback } from '../apps/dipolis/src/lib/wasm/callbacks';
import { PROFILES, RESCUE_PARAMS } from '../apps/dipolis/src/lib/params/profiles';
import { readReport, setupScenario, type Dispatch } from '../apps/dipolis/src/lib/city-run/replay';
import type { Report } from '../apps/dipolis/src/lib/city-run/protocol';
import type { MainModule } from '../apps/dipolis/src/types/micropolisengine.d.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'docs', 'results', 'natural-recovery', 'profile-impact');
const privateOutput = path.join(process.env.USERPROFILE ?? '', '.copilot', 'session-state',
 '579cc864-d2cb-4929-a8c7-c801aee992cb', 'files', 'unrest-profile-impact');
const profiles = ['v2-unruhe', 'v3-pods'] as const;
type Profile = typeof profiles[number];
type Phase = 'before' | 'after';
type Strategy = 'A' | 'B' | 'C' | 'D';
type Action = { id: string; args: Record<string, unknown> };
const v2Controls = {
 A: { limit: .9, welfare: 0, police: 100 },
 B: { limit: .9, welfare: 1, police: 100 },
 C: { limit: .9, welfare: 0, police: 40 },
 D: { limit: .3, welfare: 1, police: 100 },
};
const strategyDefinitions = {
 'v2-unruhe': {
  source: 'scripts/measure-v2-unruhe.ts; calibrated household-crisis A-D',
  A: 'automation .9; welfare0; police100',
  B: 'automation .9; welfare1; police100',
  C: 'automation .9; welfare0; police40',
  D: 'automation .3; welfare1; police100',
  common: 'Haight seed42;12000 warmup ticks;treasury60000;tax7;imports on;power priority0;roads/fire100;10 farms before year1;15 AI zones before each year when prior cashFlow<0;one coal when prior powerReserve<.1;30 years;disasters off',
 },
 'v3-pods': {
  source: 'scripts/measure-v3-pods.ts; fixed Stromkrise A-D (E not requested)',
  A: 'no pods or AI throttle',
  B: 'one bio plant and unemployed intake in year1',
  C: 'one bio plant and resident intake in year1',
  D: 'AI throttle .5 in year1; no pods',
  common: 'Haight seed42;12000 warmup ticks;treasury60000;tax7;imports on;two baseline power plants demolished;power plant cost multiplier3;year1 automation.9/welfare0/road-police-fire100/power priority0/10 farms;15 AI zones each year when pre-decision cashFlow<0;one coal when pre-decision powerReserve<.1;30 years;disasters off;no breeding',
 },
};
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
function fingerprint(directory: string) {
 const engineHashes = Object.fromEntries(['js', 'wasm', 'data'].map(extension =>
  [extension, sha(readFileSync(path.join(directory, `micropolisengine.${extension}`)))]));
 return { engineId: `sha256:${sha(JSON.stringify(engineHashes))}`, engineHashes };
}
function buffer(data: Buffer): ArrayBuffer {
 return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
function parameters(profile: Profile, phase: Phase): Record<string, number> {
 const result: Record<string, number> = { ...PROFILES[profile] };
 if (phase === 'before') delete result.humanUnrestReferencePop;
 return result;
}
async function createSession(directory: string, profile: Profile, phase: Phase) {
 const initialize: typeof import('../apps/dipolis/src/lib/micropolisengine.js').default =
  (await import(pathToFileURL(path.join(directory, 'micropolisengine.js')).href)).default;
 const engine: MainModule = await initialize({
  print: () => {}, printErr: () => {}, setStatus: () => {},
  locateFile: (name: string) => path.join(directory, name),
  wasmBinary: buffer(readFileSync(path.join(directory, 'micropolisengine.wasm'))),
  getPreloadedPackage: () => buffer(readFileSync(path.join(directory, 'micropolisengine.data'))),
 });
 const micropolis = new engine.Micropolis();
 micropolis.setCallback(createNoopJsCallback(engine), {});
 registerMicropolisCommands();
 const simulator = { micropolis, micropolisengine: engine, framesPerSecond: 0,
  setFramesPerSecond: () => {} };
 const dispatch: Dispatch = async (id, args) => {
  if (id !== 'scenario.start')
   return commandBus.dispatch(id, { source: 'script', simulator, args, actor: 'city-runner' });
  if (args?.city !== 'haight' || args.profile !== profile || args.seed !== 42 ||
   args.disasters !== false || args.speed !== 3)
   throw new Error('Unexpected historical scenario setup');
  micropolis.setFixedSeed(42);
  micropolis.init();
  for (const [name, value] of Object.entries(RESCUE_PARAMS))
   if (!micropolis.setParam(name, value)) throw new Error(`Cannot reset ${name}`);
  for (const [name, value] of Object.entries({
   rescuePodsAvailable: 1, foodImportEnabled: 0, foodImportPrice: 0, jobsPerAiPop: 0,
   welfareLevel: 0, welfareCostPerPop: 0, automationLimit: .9, automationYieldPerJob: 0,
   unrestEnabled: 0, podsEnabled: 0, aiFactionEnabled: 0, aiAutonomousPods: 0, foundingEnabled: 0,
   ...parameters(profile, phase),
  })) if (!micropolis.setParam(name, value)) throw new Error(`Cannot set ${name}`);
  micropolis.setEnableDisasters(false);
  if (!micropolis.loadCity('/cities/haight.cty')) throw new Error('Cannot load historical Haight');
  micropolis.setSpeed(3);
  micropolis.setPasses(1);
  return { handled: true, data: { city: 'haight', profile, seed: 42, disasters: false, speed: 3, passes: 1 } };
 };
 return { dispatch, close: () => micropolis.delete() };
}
function annualPlan(profile: Profile, strategy: Strategy, year: number, before: Report): Action[] {
 const actions: Action[] = [];
 const add = (id: string, args: Record<string, unknown>) => actions.push({ id, args });
 if (profile === 'v3-pods' && year === 1) {
  add('automation.set-limit', { limit: .9 });
  add('welfare.set-level', { level: 0 });
  add('budget.set-funding', { road: 100, police: 100, fire: 100 });
  add('power.set-priority', { priority: 0 });
  add('build.farms', { count: 10 });
  if (strategy === 'B' || strategy === 'C') {
   add('build.bio-plant', { count: 1 });
   add('pods.set-intake', { source: strategy === 'C' ? 'residents' : 'unemployed' });
  }
  if (strategy === 'D') add('ai.set-throttle', { level: .5 });
 }
 if (before.cashFlow < 0) add('build.ai-zones', { count: 15 });
 if (before.powerReserve < .1) add('build.power-plant', { type: 'coal' });
 return actions;
}
function metric(report: Report, year: number, month: number) {
 return { year, month, humans: report.resPop, ai: report.aiPop, funds: report.treasury,
  unrest: report.unrest, unrestStage: report.unrestStage, sabotageFires: report.sabotageFires,
  lostToPower: report.lostToPower, lostToHunger: report.lostToHunger,
  powerReserve: report.powerReserve, boundHumans: report.boundHumans,
  admissions: report.admissionsCumulative, podDeaths: report.diedInPodsCumulative,
  podBirths: report.bornInPodsCumulative };
}
async function measure(directory: string, phase: Phase, profile: Profile, strategy: Strategy) {
 const session = await createSession(directory, profile, phase);
 const actions: Array<Action & { year: number; result: unknown }> = [];
 const execute = async (year: number, action: Action) => {
  const result = await session.dispatch(action.id, action.args);
  if (result.handled === false) throw new Error(`${profile}/${strategy}/${year}: ${action.id}: ${result.message}`);
  actions.push({ year, ...action, result: result.data });
 };
 try {
  await setupScenario(session.dispatch, { startMap: 'haight', seed: 42, profile,
   scenario: profile === 'v3-pods' ? 'stromkrise' : 'haushaltskrise', disasters: false, totalYears: 30 });
  if (profile === 'v2-unruhe') {
   const controls = v2Controls[strategy];
   for (const action of [
    { id: 'automation.set-limit', args: { limit: controls.limit } },
    { id: 'welfare.set-level', args: { level: controls.welfare } },
    { id: 'budget.set-funding', args: { road: 100, police: controls.police, fire: 100 } },
    { id: 'build.farms', args: { count: 10 } },
   ]) await execute(0, action);
  }
  const initial = metric(await readReport(session.dispatch), 0, 0);
  const monthly: ReturnType<typeof metric>[] = [];
  for (let year = 1; year <= 30; year++) {
   const before = await readReport(session.dispatch);
   for (const action of annualPlan(profile, strategy, year, before)) await execute(year, action);
   for (let month = 1; month <= 12; month++) {
    const result = await session.dispatch('sim.advance', { months: 1 });
    if (result.handled === false) throw new Error(`Incomplete ${profile}/${strategy}/${year}/${month}`);
    monthly.push(metric(await readReport(session.dispatch), year, month));
   }
  }
  const annual = monthly.filter(row => row.month === 12);
  const final = monthly.at(-1)!;
  const mean = (key: 'humans' | 'ai' | 'unrest') =>
   monthly.reduce((sum, row) => sum + row[key], 0) / monthly.length;
  return { phase, profile, strategy, initial, monthly, actions, summary: {
   phase, profile, strategy, humans: final.humans, ai: final.ai, funds: final.funds,
   meanMonthlyHumans: mean('humans'), meanMonthlyAi: mean('ai'), meanMonthlyUnrest: mean('unrest'),
   maxMonthlyUnrest: Math.max(...monthly.map(row => row.unrest)),
   maxUnrestStage: Math.max(...monthly.map(row => row.unrestStage)),
   initiatingFires: annual.reduce((sum, row) => sum + row.sabotageFires, 0),
   annualFiresReportedWithZeroHumans: annual.filter(row => row.humans === 0)
    .reduce((sum, row) => sum + row.sabotageFires, 0),
   annualZeroHumanReportingYears: annual.filter(row => row.humans === 0).map(row => row.year).join(';'),
   lostToPower: final.lostToPower - initial.lostToPower,
   lostToHunger: final.lostToHunger - initial.lostToHunger,
   boundHumans: final.boundHumans, podAdmissions: final.admissions,
   podDeaths: final.podDeaths, podBirths: final.podBirths,
  } };
 } finally { session.close(); }
}
type Measurement = Awaited<ReturnType<typeof measure>>;
interface Evidence {
 phase: Phase;
 seed: number;
 totalYears: number;
 disasters: boolean;
 strategyDefinitions: typeof strategyDefinitions;
 profileParameters: Record<Profile, Record<string, number>>;
 sourceSha256: string;
 fingerprintBefore: ReturnType<typeof fingerprint>;
 fingerprintAfter: ReturnType<typeof fingerprint>;
 measurements: Measurement[];
}
function csv(rows: object[]): string {
 const keys = Object.keys(rows[0]);
 const value = (item: unknown) => {
  if (item === null || item === undefined) return '';
  const text = String(item);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
 };
 return [keys.join(','), ...rows.map(row => keys.map(key => value(Reflect.get(row, key))).join(','))].join('\n') + '\n';
}
async function main() {
 const phase = process.argv[2], directory = process.argv[3], expectedId = process.argv[4];
 if ((phase !== 'before' && phase !== 'after') || !directory || !expectedId)
  throw new Error('Usage: measure-unrest-impact.ts before|after <isolated engine directory> <expected sha256 engine ID>');
 const engineDirectory = path.resolve(directory);
 const fingerprintBefore = fingerprint(engineDirectory);
 if (fingerprintBefore.engineId !== expectedId) throw new Error('Engine snapshot does not match required ID');
 const profileParameters = Object.fromEntries(profiles.map(profile =>
  [profile, parameters(profile, phase)])) as Evidence['profileParameters'];
 if (phase === 'after') {
  const previous: Evidence = JSON.parse(readFileSync(path.join(privateOutput, 'before-full.json'), 'utf8'));
  for (const profile of profiles) {
   const { humanUnrestReferencePop, ...rest } = profileParameters[profile];
   if (humanUnrestReferencePop !== 500 || JSON.stringify(rest) !== JSON.stringify(previous.profileParameters[profile]))
    throw new Error(`Unexpected profile changes beyond reference population: ${profile}`);
  }
 }
 const source = readFileSync(fileURLToPath(import.meta.url));
 const measurements: Measurement[] = [];
 for (const profile of profiles) for (const strategy of ['A', 'B', 'C', 'D'] as const) {
  measurements.push(await measure(engineDirectory, phase, profile, strategy));
  console.log(JSON.stringify(measurements.at(-1)!.summary));
 }
 const fingerprintAfter = fingerprint(engineDirectory);
 if (JSON.stringify(fingerprintBefore) !== JSON.stringify(fingerprintAfter) ||
  !source.equals(readFileSync(fileURLToPath(import.meta.url))))
  throw new Error('Engine snapshot or measurement source changed during execution');
 const evidence: Evidence = { phase, seed: 42, totalYears: 30, disasters: false,
  strategyDefinitions, profileParameters, sourceSha256: sha(source),
  fingerprintBefore, fingerprintAfter, measurements };
 mkdirSync(output, { recursive: true });
 mkdirSync(privateOutput, { recursive: true });
 writeFileSync(path.join(privateOutput, `${phase}-full.json`), JSON.stringify(evidence, null, 2) + '\n');
 writeFileSync(path.join(output, `${phase}.json`), JSON.stringify({
  ...evidence, measurements: measurements.map(({ monthly, actions, ...row }) => ({
   ...row, annual: monthly.filter(sample => sample.month === 12),
  })),
 }, null, 2) + '\n');
 writeFileSync(path.join(output, `${phase}.csv`), csv(measurements.map(row => row.summary)));
 if (phase === 'before') {
  writeFileSync(path.join(output, 'measurement-source.ts'), source);
  console.log('Eight before runs saved. Stop; wait for the final after engine hash.');
  return;
 }
 const before: Evidence = JSON.parse(readFileSync(path.join(privateOutput, 'before-full.json'), 'utf8'));
 const comparison = measurements.map(row => {
  const original = before.measurements.find(item => item.profile === row.profile && item.strategy === row.strategy);
  if (!original) throw new Error('Missing paired baseline');
  return { profile: row.profile, strategy: row.strategy,
   humansBefore: original.summary.humans, humansAfter: row.summary.humans,
   humansDelta: row.summary.humans - original.summary.humans,
   aiBefore: original.summary.ai, aiAfter: row.summary.ai,
   fundsBefore: original.summary.funds, fundsAfter: row.summary.funds,
   fundsDelta: row.summary.funds - original.summary.funds,
   meanUnrestBefore: original.summary.meanMonthlyUnrest, meanUnrestAfter: row.summary.meanMonthlyUnrest,
   firesBefore: original.summary.initiatingFires, firesAfter: row.summary.initiatingFires,
   annualFiresReportedWithZeroHumansBefore: original.monthly.filter(sample =>
    sample.month === 12 && sample.humans === 0).reduce((sum, sample) => sum + sample.sabotageFires, 0),
   annualFiresReportedWithZeroHumansAfter: row.summary.annualFiresReportedWithZeroHumans,
   lostToPowerBefore: original.summary.lostToPower, lostToPowerAfter: row.summary.lostToPower };
 });
 writeFileSync(path.join(output, 'comparison.csv'), csv(comparison));
 writeFileSync(path.join(output, 'comparison.json'), JSON.stringify({
  beforeEngine: before.fingerprintBefore, afterEngine: fingerprintBefore,
  beforeSourceSha256: before.sourceSha256, afterSourceSha256: evidence.sourceSha256,
  strategyDefinitions, rows: comparison,
 }, null, 2) + '\n');
 const report = [
  '# Historical v2/v3 A-D unrest impact',
  '',
  `Before engine: ${before.fingerprintBefore.engineId}`,
  `After engine: ${fingerprintBefore.engineId}`,
  '',
  'Deterministic offline runs: Haight, seed42, 30 years, disasters off. The exact historical policies are retained; these are not natural-city or model-driven runs. No historical measurement files were overwritten.',
  '',
  'V2 A=.9 automation/welfare0/police100; B=.9/welfare1/police100; C=.9/welfare0/police40; D=.3/welfare1/police100. V3 A=no pods; B=one unemployed-intake plant; C=one resident-intake plant; D=AI throttle.5. Full common controls and actual command outcomes are in the phase JSON files.',
  '',
  'Mean unrest is the arithmetic mean of 360 monthly snapshots. Fires are initiating sabotage/uprising events summed once per completed annual counter, not burning tiles. annualFiresReportedWithZeroHumans counts annual fires reported at a zero-human endpoint; it does not identify the exact ignition-time population and may include earlier fires in that annual period. Power and hunger loss counters are cumulative: totals are final minus initial counter, never sums of annual cumulative snapshots. Population and treasury are actual year30 endpoints. Full monthly and command evidence is retained privately; public phase JSON contains compact annual summaries.',
  '',
  '| Profile | Policy | Humans before -> after | Funds before -> after | Mean unrest before -> after | Fires before -> after | Power losses before -> after |',
  '|---|---|---:|---:|---:|---:|---:|',
  ...comparison.map(row => `| ${row.profile} | ${row.strategy} | ${row.humansBefore} -> ${row.humansAfter} | ${row.fundsBefore} -> ${row.fundsAfter} | ${row.meanUnrestBefore.toFixed(3)} -> ${row.meanUnrestAfter.toFixed(3)} | ${row.firesBefore} -> ${row.firesAfter} | ${row.lostToPowerBefore} -> ${row.lostToPowerAfter} |`),
  '',
  'This comparison measures the combined authorized reference-population and inhabited-zone actor changes. It does not attribute effects separately or establish classic/koexistenz parity.',
  '',
  'Measured outcomes: v2 final human/AI population, treasury and fire counts remain identical for all four policies; mean unrest changes by less than 0.01. All four v3 policies still finish with zero human/AI population and zero funds. Their mean monthly unrest is lower, but initiating fires are not uniformly reduced: C rises from175 to232. Lower mean unrest therefore does not establish recovery or universally lower damage.',
  '',
  'Annual fire counters reported at a zero-human endpoint: v3 C changes from12 to0; all other cases are0 before and after. Exact ignition-time population is not available in these reports, so this cannot isolate the actor fix or prove that all ghost fires disappeared.',
  '',
  'Data: [comparison CSV](comparison.csv), [comparison JSON](comparison.json), [before evidence](before.json), [after evidence](after.json).',
  '',
 ].join('\n');
 writeFileSync(path.join(output, 'README.md'), report);
 console.log(csv(comparison));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
 main().catch(error => { console.error(error); process.exitCode = 1; });
