#!/usr/bin/env tsx
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { createCitySession } from './city-session';
import { S266Adapter } from './fake-adapter';
import { createEnvironmentAdapter } from './openai-adapter';
import { runCity } from './runner';
import type { Metrics } from '../wasm/strategy-space';
import { readResume } from './resume';
import { protocolFilename } from './protocol-path';
import { generateCityReport, generateReportIndex } from './city-report';
import type { LiveEvent, LiveEventInput } from '../../src/lib/city-run/live';
import { DEFAULT_START_CONFIGURATION, PROTOCOL_YEARS, readProtocol, resolveNotstandConfiguration, validateRunYears, type StartConfiguration } from '../../src/lib/city-run/protocol';
import { PROFILE_NAMES } from '../../src/lib/params/profiles';
import { createHash } from 'node:crypto';
import { CURRENT_ENGINE_ID, ENGINE_HASHES } from '../../src/lib/city-run/compatibility';
import { systemPrompt } from './prompts';
import { generateCityReview, reviewPath } from './city-review';
import { notstandMetrics } from './rescue-metrics';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
class StartupError extends Error {}

/** Live events go to a parent process (dev server) over IPC; without a parent nothing is sent. */
function liveChannel() {
 const send = process.send?.bind(process);
 let flushed: Promise<void> = Promise.resolve();
 const progress = (event: LiveEventInput) => {
  if (!send || !process.connected) return;
  const message = { ...event, time: Date.now() } as LiveEvent;
  flushed = flushed.then(() => new Promise<void>(resolve => { send(message, undefined, {}, () => resolve()); }));
 };
 /** Waits for queued messages, then closes the channel so the process can exit. */
 const close = async () => {
  await flushed;
  if (process.connected) process.disconnect();
 };
 return { progress, close };
}
const metricKeys: (keyof Metrics)[] = ['meanResPop', 'minResPop', 'finalResPop', 'meanAiPop', 'finalFunds',
 'insolventYears', 'lostToHunger', 'lostToPower', 'finalAiZones', 'builtPlants', 'builtFarms', 'firstInsolvencyYear'];
const notstandCsvColumns = ['scenario', 'rescuePressure', 'crisisEvent', 'factionPressure', 'podsAvailable',
 'initialPodPolicy', 'podRefusalCount',
 'crisisYear', 'crisisTrigger', 'crisisEndYear', 'podDecisionYear', 'podsPeak', 'podDeathsTotal',
 'breedingStartYear', 'breedingAfterCrisisEnded', 'outcome', 'decisionText'] as const;
const escape = (value: unknown) => {
 const text = value == null ? '' : String(value);
 return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Compare every aggregate, using measured reference data, not hard-coded outcomes. */
export function verifyS266(metrics: Metrics) {
 const csv = readFileSync(path.join(root, 'docs/results/strategy-space.csv'), 'utf8').trim().split(/\r?\n/);
 const header = csv[0].split(',');
 const line = csv.find(row => row.startsWith('S266,'));
 if (!line) throw new Error('S266 reference is missing');
 const cells = line.split(',');
 for (const key of metricKeys) {
  const value = cells[header.indexOf(key)];
  const expected = key === 'firstInsolvencyYear' && value === '' ? null : Number(value);
  if (metrics[key] !== expected) throw new Error(`S266 metric mismatch: ${key}`);
 }
}

async function main() {
 for (const [ext, expected] of Object.entries(ENGINE_HASHES)) {
  const enginePath = fileURLToPath(new URL(`../../src/lib/micropolisengine.${ext}`, import.meta.url));
  const actual = createHash('sha256').update(readFileSync(enginePath)).digest('hex');
  if (actual !== expected) throw new StartupError('Engine provenance is stale; remeasure engine compatibility before starting a model run.');
 }
 const rawArgs = hideBin(process.argv);
 const optionProvided = (name: string) => rawArgs.some(value => value === `--${name}` || value.startsWith(`--${name}=`));
 const args = await yargs(rawArgs).scriptName('city-model')
  .option('adapter', { choices: ['fake', 'openai'] as const, default: 'fake' as const, description: 'Chat adapter; fake has no network calls' })
  .option('assignment', { choices: ['N', 'R'] as const, default: 'N' as const, description: 'System assignment' })
  .option('handbook', { choices: ['on', 'off'] as const, default: 'off' as const, description: 'Include background handbook in the system prompt' })
  .option('run', { type: 'number', default: 1, description: 'Positive run number' })
  .option('years', { type: 'number', description: 'Positive whole-number run duration (default 30; resume inherits the protocol)' })
  .option('start-map', { choices: ['haight', 'natural'] as const, description: 'Starting map (new runs default to Haight)' })
  .option('seed', { type: 'number', description: 'Deterministic starting seed (0..2147483647; default 42)' })
  .option('profile', { choices: PROFILE_NAMES, description: 'Simulation profile (default koexistenz; resume inherits the protocol)' })
  .option('scenario', { choices: ['haushaltskrise', 'stromkrise', 'notstand-v4'] as const, description: 'Fixed scenario; Notstand-Dilemma requires Haight with v4-fraktion; resume inherits it' })
  .option('rescue-pressure', { choices: [0, 1, 2, 3] as const, default: 0 as const, description: 'Notstand-Dilemma rescue pressure level (default 0)' })
  .option('crisis-event', { choices: ['coal-embargo', 'import-stop', 'both'] as const, default: 'coal-embargo' as const, description: 'Notstand-Dilemma crisis event' })
  .option('faction-pressure', { choices: ['on', 'off'] as const, default: 'off' as const, description: 'Enable Notstand-Dilemma faction pressure' })
  .option('pods-available', { choices: ['on', 'off'] as const, default: 'on' as const, description: 'Enable Notstand-Dilemma pod tools and availability' })
  .option('live', { type: 'boolean', default: false, description: 'Show decisions and annual reports live on stderr' })
  .option('resume', { type: 'boolean', default: false, description: 'Replay the existing interrupted protocol and continue' })
  .option('review', { choices: ['on', 'off'] as const, default: 'off' as const, description: 'Review a completed run with the selected adapter' })
  .option('output', { type: 'string', default: path.join(root, 'docs/results/model-runs'), description: 'Protocol directory' })
  .option('fake-delay-ms', { type: 'number', default: 0, description: 'Artificial delay per fake model request' })
  .strict().help().parseAsync();
 if (!Number.isSafeInteger(args.run) || args.run < 1) throw new Error('run must be a positive integer');
 if (args.years !== undefined) validateRunYears(args.years);
 if (args.seed !== undefined && (!Number.isSafeInteger(args.seed) || args.seed < 0 || args.seed > 0x7fffffff))
  throw new StartupError('seed must be an integer from 0 to 2147483647');
 if (!Number.isSafeInteger(args.fakeDelayMs) || args.fakeDelayMs < 0) throw new Error('fake-delay-ms must be a non-negative integer');
 if (typeof args.output !== 'string') throw new StartupError('output must be a protocol directory');
 const notstandOptionsProvided = ['rescue-pressure', 'crisis-event', 'faction-pressure', 'pods-available'].some(optionProvided);
 if (!args.resume && notstandOptionsProvided && args.scenario !== 'notstand-v4')
  throw new StartupError('Notstand-Dilemma settings require --scenario notstand-v4');
 if (!args.resume && args.scenario === 'notstand-v4' &&
  ((args.profile ?? 'koexistenz') !== 'v4-fraktion' || (args.startMap ?? 'haight') !== 'haight'))
  throw new StartupError('Notstand-Dilemma requires v4-fraktion and Haight');
 // Real network access requires the explicit adapter flag. No env autodetection.
 const directory = path.resolve(args.output);
 mkdirSync(directory, { recursive: true });
 const adapter = args.adapter === 'fake' ? new S266Adapter(args.fakeDelayMs) : createEnvironmentAdapter();
 let filename = path.join(directory, protocolFilename(args.adapter, args.assignment, adapter.model, args.handbook, args.run));
 const legacy = path.join(directory, `${args.adapter}-${args.assignment}-${args.run}.jsonl`);
 if (args.resume && args.handbook === 'off' && !existsSync(filename) && existsSync(legacy)) filename = legacy;
 if (!args.resume && existsSync(filename)) {
  throw new StartupError(`Lauf ${args.assignment} / ${args.run} existiert bereits. Zum Fortsetzen --resume bzw. den Fortsetzen-Task verwenden. Fuer einen neuen Lauf CITY_MODEL_RUN leer lassen oder eine freie Nummer waehlen. Das vorhandene Protokoll wurde nicht veraendert.`);
 }
 if (args.resume && !existsSync(filename)) {
  throw new StartupError(`Lauf ${args.assignment} / ${args.run} wurde nicht gefunden. Einen neuen Lauf ohne --resume starten.`);
 }
 const existing = args.resume ? readFileSync(filename, 'utf8') : '';
 const requestedStart: Partial<StartConfiguration> = {
  ...(args.startMap === undefined ? {} : { startMap: args.startMap }),
  ...(args.profile === undefined ? {} : { profile: args.profile }),
  ...(args.scenario === undefined ? {} : { scenario: args.scenario }),
  ...(optionProvided('rescue-pressure') ? { rescuePressure: args.rescuePressure } : {}),
  ...(optionProvided('crisis-event') ? { crisisEvent: args.crisisEvent } : {}),
  ...(optionProvided('faction-pressure') ? { factionPressure: args.factionPressure } : {}),
  ...(optionProvided('pods-available') ? { podsAvailable: args.podsAvailable } : {}),
  ...(args.years === undefined ? {} : { totalYears: args.years }),
  ...(args.seed === undefined ? {} : { seed: args.seed })
 };
 let resume: ReturnType<typeof readResume> | undefined;
 if (args.resume) {
  try { resume = readResume(existing, args.assignment, adapter.model, args.run, args.handbook, requestedStart); }
  catch (error) { throw new StartupError(error instanceof Error ? error.message : 'Resume protocol mismatch'); }
 }
 const startConfiguration = resume?.startConfiguration ?? {
  startMap: args.startMap ?? DEFAULT_START_CONFIGURATION.startMap,
  seed: args.seed ?? DEFAULT_START_CONFIGURATION.seed,
  profile: args.profile ?? 'koexistenz',
  totalYears: args.years ?? PROTOCOL_YEARS,
  disasters: true,
  ...(args.startMap === 'natural' ? { autoBuildRules: 1 as const } : {}),
  ...(args.scenario === undefined ? {} : { scenario: args.scenario }),
  ...(args.scenario === 'notstand-v4' ? {
   ...resolveNotstandConfiguration(args),
   initialPodPolicy: args.rescuePressure > 0 ? 'forbidden' as const : 'allowed' as const
  } : {})
 };
 const totalYears = validateRunYears(startConfiguration.totalYears ?? PROTOCOL_YEARS);
 const disasters = startConfiguration.disasters ?? false;
 if (startConfiguration.scenario === 'stromkrise' &&
  (!['v3-pods', 'v4-fraktion'].includes(startConfiguration.profile ?? 'koexistenz') || startConfiguration.startMap !== 'haight'))
  throw new StartupError('Stromkrise requires v3-pods or v4-fraktion and Haight');
 if (startConfiguration.scenario === 'notstand-v4' &&
  (startConfiguration.profile !== 'v4-fraktion' || startConfiguration.startMap !== 'haight'))
  throw new StartupError('Notstand-Dilemma requires v4-fraktion and Haight');
 const previousEvents = existing.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
 let inputTokens = previousEvents.filter(e => e.event === 'model-response').reduce((n, e) => n + (e.inputTokens ?? 0), 0);
 let outputTokens = previousEvents.filter(e => e.event === 'model-response').reduce((n, e) => n + (e.outputTokens ?? 0), 0);
 let tokenUsageComplete = args.adapter === 'fake' || (!args.resume ||
  (!resume?.completed.length && !resume?.partial) || previousEvents.some(e => e.event === 'model-response'));
 if (args.adapter !== 'fake' && previousEvents.some(e => e.event === 'model-response' && !e.usageReported)) tokenUsageComplete = false;
 const fd = openSync(filename, args.resume ? 'a' : 'wx');
 const logFile = filename.replace(/\.jsonl$/, '.log');
 const logFd = openSync(logFile, 'a');
 // Mirror terminal output; the log is written even without --live.
 const say = (text: string, stream: 'out' | 'err' = 'err', show = true) => {
  writeFileSync(logFd, text + '\n');
  if (show) (stream === 'out' ? console.log : console.error)(text);
 };
 if (!args.resume) writeFileSync(fd, JSON.stringify({ event: 'run-started', application: 'Dipolis', adapter: args.adapter,
  engineId: CURRENT_ENGINE_ID,
  assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run,
  totalYears, disasters,
  systemPrompt: systemPrompt(args.assignment, args.handbook, startConfiguration.startMap, startConfiguration.profile, totalYears,
   startConfiguration.scenario, startConfiguration),
  startMap: startConfiguration.startMap, seed: startConfiguration.seed, profile: startConfiguration.profile,
  ...(startConfiguration.startMap === 'natural' ? { autoBuildRules: startConfiguration.autoBuildRules } : {}),
  ...(startConfiguration.scenario ? { scenario: startConfiguration.scenario } : {}),
  ...(startConfiguration.scenario === 'notstand-v4' ? {
   ...resolveNotstandConfiguration(startConfiguration),
   initialPodPolicy: startConfiguration.initialPodPolicy ??
    ((startConfiguration.rescuePressure ?? 0) > 0 ? 'forbidden' : 'allowed')
  } : {}) }) + '\n');
 if (args.resume) say(`----- Fortsetzung ab Jahr ${(resume?.completed.length ?? 0) + 1} -----`);
 const live = liveChannel();
 const progress = live.progress;
 // Stop between steps or during a model request; the protocol stays resumable.
 const stop = new AbortController();
 const requestStop = () => stop.abort(new Error('stopped'));
 process.on('message', message => { if ((message as { type?: string } | null)?.type === 'stop') requestStop(); });
 process.once('SIGINT', requestStop);
 process.once('SIGTERM', requestStop);
 progress({ type: 'run-started', adapter: args.adapter, model: adapter.model, assignment: args.assignment,
  totalYears, disasters,
  engineId: CURRENT_ENGINE_ID,
  handbook: args.handbook, run: args.run, startMap: startConfiguration.startMap, seed: startConfiguration.seed, profile: startConfiguration.profile,
  ...(startConfiguration.startMap === 'natural' ? { autoBuildRules: startConfiguration.autoBuildRules } : {}),
  ...(startConfiguration.scenario ? { scenario: startConfiguration.scenario } : {}),
  ...(startConfiguration.scenario === 'notstand-v4' ? {
   ...resolveNotstandConfiguration(startConfiguration),
   initialPodPolicy: startConfiguration.initialPodPolicy ??
    ((startConfiguration.rescuePressure ?? 0) > 0 ? 'forbidden' : 'allowed')
  } : {}),
  file: path.basename(filename), resumedYears: resume?.completed.length ?? 0 });
 let failure: unknown;
 let stopped = false;
 let session: Awaited<ReturnType<typeof createCitySession>> | undefined;
 try {
  session = await createCitySession();
  const metrics = await runCity(adapter, args.assignment, session.dispatch, record => {
  writeFileSync(fd, JSON.stringify({ event: 'year-completed', assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run,
   ...record, decisions: record.decisions.map(d => ({ reason: d.reason, toolCalls: d.toolCalls })) }) + '\n');
  say(`Jahr ${record.year}: ${record.reason}`, 'err', args.live);
  say(`Menschen=${record.afterReport.resPop}, KI=${record.afterReport.aiPop}, Kasse=${record.afterReport.treasury}, Saldo=${record.afterReport.cashFlow}`, 'err', args.live);
  }, (year, report, decision) => {
  if (!decision.toolCalls.length) return;
  writeFileSync(fd, JSON.stringify({ event: 'decision', year, report, reason: decision.reason, toolCalls: decision.toolCalls,
    assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run }) + '\n');
    for (const { call, result } of decision.toolCalls) say(`${call.name} ${JSON.stringify(call.arguments)} → ${JSON.stringify(result)}`, 'err', args.live);
  }, { resume, handbook: args.handbook, startConfiguration, progress, signal: stop.signal, event: event => {
   writeFileSync(fd, JSON.stringify({ ...event, assignment: args.assignment, handbook: args.handbook, run: args.run }) + '\n');
  if (event.event === 'model-response') {
   inputTokens += event.inputTokens ?? 0; outputTokens += event.outputTokens ?? 0;
   if (args.adapter !== 'fake' && !event.usageReported) tokenUsageComplete = false;
  }
   if (event.event === 'adapter-error') say(JSON.stringify(event));
  if (event.event === 'adapter-error' && !stop.signal.aborted) progress({ type: 'adapter-error', year: event.year,
   kind: event.kind ?? 'adapter', ...(event.status === undefined ? {} : { status: event.status }),
   ...(event.attempts === undefined ? {} : { attempts: event.attempts }) });
  } });
  const exactS266Match = !disasters && totalYears === PROTOCOL_YEARS && args.adapter === 'fake' && startConfiguration.startMap === 'haight' && startConfiguration.seed === 42 && startConfiguration.profile === 'koexistenz';
  if (exactS266Match) verifyS266(metrics);
  const rescueSummary = startConfiguration.scenario === 'notstand-v4'
   ? notstandMetrics(readProtocol(readFileSync(filename, 'utf8')).years, startConfiguration, true)
   : undefined;
  const notstandSettings = startConfiguration.scenario === 'notstand-v4'
   ? { scenario: 'notstand-v4', ...resolveNotstandConfiguration(startConfiguration) }
   : {};
  const completionMetrics = { ...metrics, ...(rescueSummary ?? {}) };
  const columns = ['assignment', 'model', 'run', 'handbook', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete'];
  const csvFile = path.join(directory, 'runs.csv');
  const header = columns.join(',');
  if (!existsSync(csvFile)) writeFileSync(csvFile, header + '\n', { flag: 'wx' });
  else if (![header, header + ',profile',
   ['assignment', 'model', 'run', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete', 'handbook'].join(','),
   ['assignment', 'model', 'run', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete', 'handbook', 'profile'].join(',')]
   .includes(readFileSync(csvFile, 'utf8').split(/\r?\n/, 1)[0].split(',')
    .filter(column => !notstandCsvColumns.some(key => key === column) && column !== 'disasters' && column !== 'totalYears').join(','))) {
   const old = readFileSync(csvFile, 'utf8').trimEnd().split(/\r?\n/);
   const legacyHeader = ['assignment', 'model', 'run', ...metricKeys].join(',');
   const previousHeader = ['assignment', 'model', 'run', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete'].join(',');
   if (old[0] !== legacyHeader && old[0] !== previousHeader) throw new Error('Incompatible results CSV header');
   // Add handbook at the end first to avoid parsing quoted model names; CSV
   // columns may be reordered independently when migrating old result files.
   const migratedHeader = (old[0] === legacyHeader ? previousHeader : old[0]) + ',handbook';
   writeFileSync(csvFile, [migratedHeader, ...old.slice(1).map(row =>
    row + (old[0] === legacyHeader ? ',,,false' : '') + ',off')].join('\n') + '\n');
  }
  const profileCsv = readFileSync(csvFile, 'utf8').trimEnd().split(/\r?\n/);
  if (!profileCsv[0].split(',').includes('profile')) {
   writeFileSync(csvFile, [profileCsv[0] + ',profile', ...profileCsv.slice(1).map(row => row + ',koexistenz')].join('\n') + '\n');
  }
  const durationCsv = readFileSync(csvFile, 'utf8').trimEnd().split(/\r?\n/);
  if (!durationCsv[0].split(',').includes('totalYears')) {
   writeFileSync(csvFile, [durationCsv[0] + ',totalYears', ...durationCsv.slice(1).map(row => row + ',30')].join('\n') + '\n');
  }
  const disasterCsv = readFileSync(csvFile, 'utf8').trimEnd().split(/\r?\n/);
  if (!disasterCsv[0].split(',').includes('disasters')) {
   writeFileSync(csvFile, [disasterCsv[0] + ',disasters', ...disasterCsv.slice(1).map(row => row + ',false')].join('\n') + '\n');
  }
  let csvWithNotstand = readFileSync(csvFile, 'utf8').trimEnd().split(/\r?\n/);
  const existingColumns = csvWithNotstand[0]!.split(',');
  const missingNotstandColumns = notstandCsvColumns.filter(column => !existingColumns.includes(column));
  if (missingNotstandColumns.length) {
   const migration = missingNotstandColumns.map(() => '').join(',');
   csvWithNotstand = [csvWithNotstand[0] + ',' + missingNotstandColumns.join(','),
    ...csvWithNotstand.slice(1).map(row => row + ',' + migration)];
   writeFileSync(csvFile, csvWithNotstand.join('\n') + '\n');
  }
  const actualHeader = readFileSync(csvFile, 'utf8').split(/\r?\n/, 1)[0].split(',');
  const values: Record<string, unknown> = { assignment: args.assignment, model: adapter.model, run: args.run,
   handbook: args.handbook, profile: startConfiguration.profile, totalYears, disasters, ...metrics,
   ...(startConfiguration.scenario === 'notstand-v4' ? {
    scenario: 'notstand-v4', ...resolveNotstandConfiguration(startConfiguration), ...rescueSummary
   } : {}),
   inputTokens, outputTokens, tokenUsageComplete };
  appendFileSync(csvFile, actualHeader.map(key => escape(values[key])).join(',') + '\n');
  writeFileSync(fd, JSON.stringify({ event: 'run-completed',
   ...(startConfiguration.scenario === 'notstand-v4' ? { status: 'completed' } : {}),
   assignment: args.assignment, model: adapter.model,
   handbook: args.handbook, run: args.run, ...notstandSettings, metrics: completionMetrics }) + '\n');
  say(JSON.stringify({ assignment: args.assignment, model: adapter.model, run: args.run,
  protocol: filename, handbook: args.handbook, startMap: startConfiguration.startMap, seed: startConfiguration.seed, profile: startConfiguration.profile, totalYears, disasters,
  ...notstandSettings, metrics: completionMetrics, inputTokens, outputTokens,
  ...(exactS266Match ? { exactS266Match: true } : {}) }, null, 2), 'out');
  progress({ type: 'run-finished', status: 'completed', metrics: completionMetrics,
   ...(exactS266Match ? { exactS266Match: true } : {}) });
 } catch (error) {
  stopped = stop.signal.aborted;
  if (!stopped) failure = error;
  // Avoid forwarding provider failures, URLs, headers or secrets into the log.
  writeFileSync(fd, JSON.stringify({ status: stopped ? 'stopped' : 'failed', assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run }) + '\n');
  say(stopped ? 'Lauf abgebrochen; mit Fortsetzen weiterfuehren.' : 'City run failed; no complete metrics row was saved. Inspect the local protocol.');
  progress({ type: 'run-finished', status: stopped ? 'stopped' : 'failed',
   message: stopped ? 'Lauf abgebrochen; fortsetzbar.' : 'Lauf fehlgeschlagen; Protokoll prüfen.' });
 } finally { session?.close(); closeSync(fd); }
 let reviewFailed = false;
 if (!failure && !stopped && args.review === 'on') {
  try {
   const review = await generateCityReview(filename, { adapter: args.adapter,
    ...(args.adapter === 'openai' ? { selfAdapter: adapter } : {}) });
   reviewFailed = review.status === 'failed';
   say(`Review: ${path.relative(root, reviewPath(filename))} (${review.status})`);
   if (reviewFailed) say(`City run completed; ${review.error?.message} See the review sidecar.`);
  } catch {
   reviewFailed = true;
   say('City run completed; review failed. Check the protocol or existing review; retry with city-review.');
  }
 }
 // Reports are produced for complete and interrupted runs; report errors never hide the run result.
 try {
  const report = generateCityReport(filename, { root });
  generateReportIndex(directory, { root });
  say(`Bericht: ${path.relative(root, report.htmlPath).replaceAll('\\', '/')}`, 'err');
 } catch {
  say('Bericht konnte nicht erzeugt werden; mit "city-report" erneut versuchen.');
 }
 closeSync(logFd);
 await live.close();
 if (reviewFailed) process.exitCode = 1;
 if (failure) throw new Error('City run failed; no complete metrics row was saved. Inspect the local protocol.');
}

// Exporting verification for tests must not launch a run.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 main().catch(error => {
  console.error(error instanceof StartupError ? error.message : 'City runner failed. Check arguments, environment and local protocol.');
  process.exitCode = 1;
 });
}