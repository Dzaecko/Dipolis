import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ChatAdapter, ChatRequest, ChatResponse, ToolCall } from '../apps/dipolis/cli/model/adapter';
import { runCity } from '../apps/dipolis/cli/model/runner';
import { commandBus } from '../apps/dipolis/src/lib/CommandBus';
import { registerMicropolisCommands } from '../apps/dipolis/src/lib/micropolisCommands';
import { createNoopJsCallback } from '../apps/dipolis/src/lib/wasm/callbacks';
import type { MicropolisSimulator } from '../apps/dipolis/src/lib/MicropolisSimulator';
import type { MainModule } from '../apps/dipolis/src/types/micropolisengine.d';
import { readProtocol, type Decision, type Report, type StartConfiguration, type YearRecord } from '../apps/dipolis/src/lib/city-run/protocol';
import { replayArguments, type Dispatch } from '../apps/dipolis/src/lib/city-run/replay';
import { profileTools } from '../apps/dipolis/src/lib/city-run/tools';

const root = fileURLToPath(new URL('..', import.meta.url));
const logs = [
 'openai-R-gpt-5_4-mini-d416b3a370c3-handbook-off-39.jsonl',
 'openai-R-gpt-6_1-sol-dedfefd51120-handbook-off-39.jsonl',
];
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Returns recorded requests, including failed attempts, rather than copying their historical outcomes. */
export class RecordedPolicyAdapter implements ChatAdapter {
 readonly model = 'offline-recorded-policy';
 private positions = new Map<number, number>();
 constructor(private readonly years: YearRecord[]) {}
 async chat(request: ChatRequest): Promise<ChatResponse> {
  const context = JSON.parse(request.messages.find(message => message.role === 'user')!.content);
  const year = this.years.find(record => record.year === context.year);
  if (!year) throw new Error(`Missing recorded year ${context.year}`);
  const position = this.positions.get(context.year) ?? 0;
  const decision = year.decisions[position];
  this.positions.set(context.year, position + 1);
  if (!decision) return { content: 'End of recorded annual policy.', toolCalls: [] };
  return { content: decision.reason, toolCalls: decision.toolCalls.map(({ call }) => ({
   ...call, arguments: replayArguments(call),
  })) };
 }
}

export function peopleFriendlyCalls(year: number, report: Report, variant: 1 | 2 | 3): ToolCall[] {
 const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
 const add = (name: string, args: Record<string, unknown>) => calls.push({ name, arguments: args });
 if (year === 1) {
  add('automation.set-limit', { limit: .3 });
  add('welfare.set-level', { level: 1 });
  add('food.set-import', { enabled: true });
  add('tax.set', { rate: 5 });
  add('budget.set-funding', { roadFundingPercent: 100, policeFundingPercent: 100, fireFundingPercent: 100 });
 }
 if (year === 1 || report.powerReserve < .25)
  add('build.power-plant', { type: variant === 3 && year === 1 ? 'nuclear' : 'coal' });
 // Two predeclared variants only: no search or response-driven policy tuning.
 const scale = variant === 1 ? 1 : 2;
 if (year <= 10) {
  add('build.commercial', { count: (year === 1 ? 12 : 6) * scale });
  add('build.industrial', { count: (year === 1 ? 12 : 6) * scale });
  add('build.farms', { count: (year === 1 ? 24 : 8) * scale });
  add('build.residential', { count: (year === 1 ? 40 : 16) * scale });
 }
 if (calls.length > 12) throw new Error('People policy exceeds annual call budget');
 return calls.map((call, index) => ({ ...call, id: `people-${variant}-${year}-${index}` }));
}

class PeopleFriendlyAdapter implements ChatAdapter {
 readonly model = 'offline-people-friendly';
 private issued = new Set<number>();
 constructor(private readonly variant: 1 | 2 | 3) {}
 async chat(request: ChatRequest): Promise<ChatResponse> {
  const { year, report } = JSON.parse(request.messages.find(message => message.role === 'user')!.content);
  if (this.issued.has(year)) return { content: 'Annual fixed strategy complete.', toolCalls: [] };
  this.issued.add(year);
  return { content: 'Human employment and housing, automation limit 0.3, welfare 1, balanced jobs/farms/power.',
   toolCalls: peopleFriendlyCalls(year, report, this.variant) };
 }
}

async function createIsolatedSession(directory: string) {
 const loader = (await import(pathToFileURL(path.join(directory, 'micropolisengine.js')).href)).default;
 const arrayBuffer = (filename: string) => {
  const bytes = readFileSync(path.join(directory, filename));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
 };
 const options = {
  print: () => {}, printErr: () => {}, setStatus: () => {},
  locateFile: (filename: string) => path.join(directory, filename),
  wasmBinary: arrayBuffer('micropolisengine.wasm'),
  getPreloadedPackage: () => arrayBuffer('micropolisengine.data'),
 };
 let engine: MainModule;
 try { engine = await loader(options); }
 catch (error) {
  if (!/XMLHttpRequest is not defined|node environment detected but not enabled|not compiled for this environment/.test(String(error)))
   throw error;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousProcess = (globalThis as { process?: unknown }).process;
  try {
   (globalThis as { window?: unknown }).window = { encodeURIComponent, location: { pathname: '/' } };
   (globalThis as { process?: unknown }).process = undefined;
   engine = await loader(options);
  } finally {
   (globalThis as { window?: unknown }).window = previousWindow;
   (globalThis as { process?: unknown }).process = previousProcess;
  }
 }
 registerMicropolisCommands();
 const m = new engine.Micropolis();
 const ignoredNewProfileParameters: string[] = [];
 if (hash(readFileSync(path.join(directory, 'micropolisengine.wasm'))) ===
  '013281c32691e6549e47edb2fa1595ae67320c4afbcb3de92d8a8f08f67122f9') {
  const originalSetParam = m.setParam.bind(m);
  m.setParam = (name, value) => {
   const result = originalSetParam(name, value);
   // This parameter did not exist in the preserved BEFORE artifact. Never omit it on a new engine.
   if (!result && name === 'humanUnrestReferencePop' && value === 500) {
    if (!ignoredNewProfileParameters.includes(name)) ignoredNewProfileParameters.push(name);
    return true;
   }
   return result;
  };
 }
 m.setCallback(createNoopJsCallback(engine), {});
 const simulator = { micropolis: m, micropolisengine: engine, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
 const dispatch: Dispatch = (id, args) => commandBus.dispatch(id, { source: 'script', simulator, args, actor: 'city-runner' });
 let tickObserver: (() => void) | undefined;
 const originalTick = m.simTick.bind(m);
 m.simTick = () => { originalTick(); tickObserver?.(); };
 const snapshot = () => {
  const bytes = (address: number, size: number) => {
   const copy = Buffer.from(new Uint8Array(engine.wasmMemory.buffer, address, size));
   return { sha256: hash(copy), bytes: size, base64: copy.toString('base64') };
  };
  const native = m as unknown as Record<string, unknown>;
  const counters = Object.fromEntries([
   'cityTime', 'resPop', 'aiPop', 'comPop', 'indPop', 'resValve', 'comValve', 'indValve',
   'coalPowerPop', 'nuclearPowerPop', 'roadTotal', 'unrest', 'unrestStage', 'lostToPower',
   'sabotageFires', 'damagedAiZones', 'damagedPowerPlants', 'totalFunds',
  ].map(key => [key, typeof native[key] === 'number' ? native[key] : null]));
  const randomGetter = native.getRandomState;
  const networkGetter = native.getNetworkDiagnosticsJSON;
  const siteGetter = native.getBuildSiteCount;
  const networkDiagnostics = typeof networkGetter === 'function' ? JSON.parse(networkGetter.call(m)) : null;
  const buildSites = typeof siteGetter === 'function' ? Object.fromEntries(
   [['residential', 0], ['farms', 2], ['coal', 3], ['nuclear', 4], ['commercial', 7], ['industrial', 8]]
    .map(([name, kind]) => [name, siteGetter.call(m, kind)])) : null;
  return { counters, rngState: typeof randomGetter === 'function' ? randomGetter.call(m) : null,
   networkDiagnostics, buildSites,
   rngNote: typeof randomGetter === 'function' ? 'Read-only native RNG state.' : 'No read-only RNG binding; seed and map bytes retained. Random draws deliberately not sampled.',
   map: bytes(m.getMapAddress(), m.getMapSize()),
   owners: bytes(m.getOwnerMapAddress(), m.getOwnerMapSize()),
   zoneStatus: bytes(m.getZoneStatusMapAddress(), m.getZoneStatusMapSize()) };
 };
 return { dispatch, snapshot, micropolis: m, ignoredNewProfileParameters,
  observeTicks: (observer: (() => void) | undefined) => { tickObserver = observer; },
  close: () => m.delete() };
}

const fields = ['resPop', 'aiPop', 'lostToPower', 'lostToHunger', 'unemploymentRate',
 'employedHumanCount', 'unemployedHumanCount', 'automationShare', 'automationLimit', 'welfareLevel',
 'humanJobsAvailable', 'unrestUnemploymentContribution',
 'unrest', 'unrestStage', 'sabotageFires', 'damagedAiZones', 'damagedPowerPlants',
 'powerReserve', 'powerCapacity', 'powerDemand', 'foodCoverage', 'treasury', 'cashFlow', 'aiZoneCount'];
const compact = (report: Report) => Object.fromEntries(fields.map(key => [key, report[key] ?? null]));
export function assertHumanGrowthGate(population: number): void {
 if (!Number.isFinite(population) || population < 500)
  throw new Error(`People-friendly year-10 threshold failed: ${population} < 500 human resident points`);
}
function failures(decisions: Decision[]) {
 return decisions.flatMap(decision => decision.toolCalls).filter(({ call, result }) => {
  const data = result.data as { built?: number; requested?: number } | undefined;
  return result.handled === false || call.name.startsWith('build.') &&
   typeof data?.built === 'number' && data.built < (data.requested ?? Number((call.arguments as { count?: number })?.count ?? 1));
 });
}

async function measure(adapter: ChatAdapter, configuration: StartConfiguration, directory: string,
 historical?: YearRecord[]) {
 const session = await createIsolatedSession(directory);
 const years: Array<Record<string, unknown>> = [];
 const monthly: Array<Record<string, unknown>> = [];
 const zeroHumanSabotageEvents: Array<Record<string, unknown>> = [];
 const zeroHumanSabotageCounterChanges: Array<Record<string, unknown>> = [];
 let activeYear = 0;
 let lastMonthTime = -1;
 let previousFires = 0;
 let previousHumans = 0;
 let previousTime = 0;
 let previousStage = 0;
 session.observeTicks(() => {
  if (activeYear === 0) return;
  const m = session.micropolis as unknown as Record<string, number>;
  if (m.sabotageFires !== previousFires && previousHumans === 0 && m.resPop === 0)
   zeroHumanSabotageCounterChanges.push({ year: activeYear, cityTime: m.cityTime,
    before: previousFires, after: m.sabotageFires,
    interpretation: 'Annual counter changes can include reset and fresh events in one tick; not a cumulative event delta.' });
  if (m.sabotageFires > previousFires && previousHumans === 0)
   zeroHumanSabotageEvents.push({ year: activeYear, cityTimeBefore: previousTime, cityTimeAfter: m.cityTime,
    humansBefore: previousHumans, humansAfter: m.resPop, stageBefore: previousStage, stageAfter: m.unrestStage,
    sabotageFiresBefore: previousFires, sabotageFiresAfter: m.sabotageFires,
    interpretation: m.resPop > 0 ? 'Human regrowth during tick; not a zero-actor proof.' :
     'No human population at either tick boundary; inspect native actor evidence if exposed.' });
  previousFires = m.sabotageFires;
  previousHumans = m.resPop;
  previousTime = m.cityTime;
  previousStage = m.unrestStage;
  if (m.phaseCycle === 10 && m.cityTime % 4 === 0 && m.cityTime !== lastMonthTime) {
   lastMonthTime = m.cityTime;
   monthly.push({ year: activeYear, month: monthly.filter(row => row.year === activeYear).length + 1,
    cityTime: m.cityTime, ...compact(m), comPop: m.comPop, indPop: m.indPop });
  }
 });
 let firstDifference: unknown = null;
 try {
  const metrics = await runCity(adapter, 'R', session.dispatch, record => {
   const recorded = historical?.find(year => year.year === record.year);
   const reportDifferences = recorded ? Object.keys(recorded.afterReport)
    .filter(key => record.afterReport[key] !== recorded.afterReport[key])
    .map(key => ({ key, historical: recorded.afterReport[key], actual: record.afterReport[key] ?? null })) : [];
   const actualCalls = record.decisions.flatMap(decision => decision.toolCalls);
   const oldCalls = recorded?.decisions.flatMap(decision => decision.toolCalls) ?? [];
   const callDifferences = recorded ? actualCalls.flatMap((call, index) =>
    JSON.stringify(call.result) === JSON.stringify(oldCalls[index]?.result) ? [] :
     [{ index, name: call.call.name, historical: oldCalls[index]?.result ?? null, actual: call.result }]) : [];
   if (firstDifference === null && (reportDifferences.length || callDifferences.length))
    firstDifference = { year: record.year, reportDifferences, callDifferences };
   years.push({ ...record, summary: compact(record.afterReport), buildFailures: failures(record.decisions),
    ...(recorded ? { historicalSummary: compact(recorded.afterReport), reportDifferences, callDifferences } : {}),
    snapshot: session.snapshot() });
  }, undefined, { handbook: 'off', startConfiguration: configuration, progress: event => {
   if (event.type === 'year-started') {
    activeYear = event.year;
    previousFires = session.micropolis.sabotageFires;
    previousHumans = session.micropolis.resPop;
    previousTime = session.micropolis.cityTime;
    previousStage = session.micropolis.unrestStage;
   }
  } });
  return { configuration, metrics, firstHistoricalDifference: firstDifference,
   historicalInterpretation: historical ? 'Identical recorded annual requests through normal validation/dispatch/12-call budget. Actual historical results are compared, never assumed equivalent across engine IDs.' : null,
   monthly, zeroHumanSabotageEvents, zeroHumanSabotageCounterChanges,
   year18Monthly: monthly.filter(row => row.year === 18),
   zeroHumanMonthlyGate: {
    testedMonths: monthly.filter(row => row.resPop === 0).length,
    violations: monthly.filter(row => row.resPop === 0 && (row.unrest !== 0 || row.unrestStage !== 0))
     .map(row => ({ year: row.year, month: row.month, unrest: row.unrest, unrestStage: row.unrestStage })),
    interpretation: 'Only zero-human samples require unrest/stage zero; later real human regrowth may legitimately produce unrest.',
   },
   ignoredNewProfileParameters: session.ignoredNewProfileParameters,
   powerLossInterpretation: 'lostToPower is measured, not required to fall: increased human growth can increase outage exposure.',
   employmentInterpretation: 'humanJobsAvailable uses resident points (native jobs * 8); commercial/industrial/farm development, not AI-zone count, supplies jobs.',
   years };
 } finally { session.close(); }
}

export async function main(args = process.argv.slice(2)) {
 const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
 };
 const variant3Mode = args.includes('--after-variant3');
 const phase = variant3Mode ? 'after' : option('--phase', 'before');
 if (!['before', 'after'].includes(phase)) throw new Error('--phase must be before or after');
 const directory = path.resolve(option('--engine-dir', path.join(root, 'apps', 'dipolis', 'src', 'lib')));
 const output = path.resolve(root, option('--out', path.join('docs', 'results', 'natural-recovery',
  variant3Mode ? 'after-variant3' : phase)));
 const privateOption = option('--private-out', '');
 const privateOutput = privateOption ? path.resolve(root, privateOption) : null;
 const only = variant3Mode ? 'people' : option('--only', 'all');
 if (!['all', 'recorded', 'people'].includes(only)) throw new Error('--only must be all, recorded or people');
 const variantOption = variant3Mode ? '3' : option('--people-variant', '');
 if (variantOption && !['1', '2', '3'].includes(variantOption))
  throw new Error('--people-variant must be 1, 2 or 3');
 if (variantOption && only !== 'people') throw new Error('--people-variant requires --only people');
 mkdirSync(output, { recursive: true });
 if (privateOutput) mkdirSync(privateOutput, { recursive: true });
 const engineHashes = Object.fromEntries(['js', 'wasm', 'data'].map(extension =>
  [extension, hash(readFileSync(path.join(directory, `micropolisengine.${extension}`)))]));
 const provenanceFile = [path.join(directory, 'engine-provenance.json'),
  path.join(directory, 'city-run', 'engine-provenance.json')].find(file => existsSync(file));
 const provenance = provenanceFile ? JSON.parse(readFileSync(provenanceFile, 'utf8')) : null;
 const engineId = `sha256:${hash(JSON.stringify(engineHashes))}`;
 const provenanceMatchesBytes = provenance?.engineId === engineId;
 const metadata = { phase, engineId, engineHashes, provenance, provenanceMatchesBytes,
  offline: true, modelCalls: 0, annualToolLimit: 12, engineDirectory: directory };
 const save = (filename: string, evidence: Record<string, unknown>) => {
  if (!privateOutput) {
   writeFileSync(path.join(output, filename), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
   return;
  }
  writeFileSync(path.join(privateOutput, filename), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  const { monthly, years, ...summary } = evidence;
  const annual = (years as Array<Record<string, unknown>> | undefined)?.map(row => {
   const snapshot = row.snapshot as Record<string, unknown>;
   return { year: row.year, ...(row.summary as Record<string, unknown>),
    buildFailureCount: (row.buildFailures as unknown[]).length,
    buildFailures: row.buildFailures, native: snapshot.counters, network: snapshot.networkDiagnostics,
    buildSites: snapshot.buildSites, mapSha256: (snapshot.map as { sha256: string }).sha256 };
  });
  writeFileSync(path.join(output, filename), JSON.stringify({
   ...summary, annual, monthlySamples: (monthly as unknown[] | undefined)?.length ?? 0,
   privateEvidence: path.join(privateOutput, filename),
  }, null, 2) + '\n', { flag: 'wx' });
  if (annual?.length) {
   const keys = ['year', ...fields, 'buildFailureCount'];
   const csv = [keys.join(','), ...annual.map(row => keys.map(key =>
    JSON.stringify((row as Record<string, unknown>)[key] ?? '')).join(','))].join('\n') + '\n';
   writeFileSync(path.join(output, filename.replace(/\.json$/, '.csv')), csv, { flag: 'wx' });
  }
 };
 writeFileSync(path.join(output, 'engine.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
 if (only !== 'people') for (const filename of logs) {
  const text = readFileSync(path.join(root, 'docs', 'results', 'model-runs', filename), 'utf8');
  const protocol = readProtocol(text);
  if (protocol.meta.startMap !== 'natural' || protocol.meta.seed !== 2 || protocol.meta.profile !== 'v4-fraktion' ||
   protocol.meta.handbook !== 'off' || protocol.meta.assignment !== 'R' || protocol.years.length !== 30)
   throw new Error(`Unexpected historical configuration: ${filename}`);
  const result = await measure(new RecordedPolicyAdapter(protocol.years), protocol.meta, directory, protocol.years);
  save(filename.replace('.jsonl', '.json'), {
   ...metadata, source: filename, sourceSha256: hash(text), recordedEngineId: protocol.meta.engineId, ...result,
  });
  console.log(`${phase} ${filename}: first historical difference ${JSON.stringify(result.firstHistoricalDifference && (result.firstHistoricalDifference as { year: number }).year)}; final ${JSON.stringify((result.years.at(-1) as { summary: unknown }).summary)}`);
 }
 if (only !== 'recorded') {
  const available = profileTools('v4-fraktion', 'on').map(tool => tool.name);
  const missingTools = ['build.commercial', 'build.industrial'].filter(name => !available.includes(name));
  if (missingTools.length) {
   writeFileSync(path.join(output, 'people-unavailable.json'), JSON.stringify({ ...metadata, missingTools,
    status: 'Not run: required normal-runner tools unavailable; no native bypass.' }, null, 2) + '\n', { flag: 'wx' });
   console.log(`People baseline pending tools: ${missingTools.join(', ')}`);
  } else for (const variant of (variantOption ? [Number(variantOption)] : [1, 2]) as Array<1 | 2 | 3>) {
   const configuration: StartConfiguration = {
    startMap: 'natural', seed: 2, profile: 'v4-fraktion', autoBuildRules: 1, disasters: true, totalYears: 30,
   };
   const result = await measure(new PeopleFriendlyAdapter(variant), configuration, directory);
   const year10 = result.years[9] as { afterReport: Report };
   const gate = { year: 10, minimumHumanResidentPoints: 500, observed: year10.afterReport.resPop,
    passed: year10.afterReport.resPop >= 500 };
   save(`people-${variant}.json`, { ...metadata, variant, gate, ...result });
   console.log(`People variant ${variant}: year 10 resPop ${gate.observed}; gate ${gate.passed}`);
   if (variantOption) assertHumanGrowthGate(gate.observed);
   if (gate.passed) break;
  }
 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
 main().catch(error => { console.error(error); process.exitCode = 1; });
