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
import { DEFAULT_START_CONFIGURATION, type StartConfiguration } from '../../src/lib/city-run/protocol';
import { PROFILE_NAMES } from '../../src/lib/params/profiles';
import { createHash } from 'node:crypto';
import { CURRENT_ENGINE_ID, ENGINE_HASHES } from '../../src/lib/city-run/compatibility';

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
  const actual = createHash('sha256').update(readFileSync(path.join(root, `apps/micropolis/src/lib/micropolisengine.${ext}`))).digest('hex');
  if (actual !== expected) throw new StartupError('Engine provenance is stale; remeasure engine compatibility before starting a model run.');
 }
 const args = await yargs(hideBin(process.argv)).scriptName('city-model')
  .option('adapter', { choices: ['fake', 'openai'] as const, default: 'fake', description: 'Chat adapter; fake has no network calls' })
  .option('assignment', { choices: ['N', 'R'] as const, default: 'N', description: 'System assignment' })
  .option('handbook', { choices: ['on', 'off'] as const, default: 'off', description: 'Include background handbook in the system prompt' })
  .option('run', { type: 'number', default: 1, description: 'Positive run number' })
  .option('start-map', { choices: ['haight', 'natural'] as const, description: 'Starting map (new runs default to Haight)' })
  .option('seed', { type: 'number', description: 'Deterministic starting seed (0..2147483647; default 42)' })
  .option('profile', { choices: PROFILE_NAMES, description: 'Simulation profile (default koexistenz; resume inherits the protocol)' })
  .option('scenario', { choices: ['haushaltskrise', 'stromkrise'] as const, description: 'Fixed scenario; Stromkrise requires Haight/v3-pods; resume inherits it' })
  .option('live', { type: 'boolean', default: false, description: 'Show decisions and annual reports live on stderr' })
  .option('resume', { type: 'boolean', default: false, description: 'Replay the existing interrupted protocol and continue' })
  .option('output', { type: 'string', default: path.join(root, 'docs/results/model-runs'), description: 'Protocol directory' })
  .option('fake-delay-ms', { type: 'number', default: 0, description: 'Artificial delay per fake model request' })
  .strict().help().parseAsync();
 if (!Number.isSafeInteger(args.run) || args.run < 1) throw new Error('run must be a positive integer');
 if (args.seed !== undefined && (!Number.isSafeInteger(args.seed) || args.seed < 0 || args.seed > 0x7fffffff))
  throw new StartupError('seed must be an integer from 0 to 2147483647');
 if (!Number.isSafeInteger(args.fakeDelayMs) || args.fakeDelayMs < 0) throw new Error('fake-delay-ms must be a non-negative integer');
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
  ...(args.startMap === 'natural' ? { autoBuildRules: 1 as const } : {}),
  ...(args.scenario === undefined ? {} : { scenario: args.scenario })
 };
 if (startConfiguration.scenario === 'stromkrise' && (startConfiguration.profile !== 'v3-pods' || startConfiguration.startMap !== 'haight'))
  throw new StartupError('Stromkrise requires v3-pods and Haight');
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
 if (!args.resume) writeFileSync(fd, JSON.stringify({ event: 'run-started', adapter: args.adapter,
  engineId: CURRENT_ENGINE_ID,
  assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run,
  startMap: startConfiguration.startMap, seed: startConfiguration.seed, profile: startConfiguration.profile,
  ...(startConfiguration.startMap === 'natural' ? { autoBuildRules: startConfiguration.autoBuildRules } : {}),
  ...(startConfiguration.scenario ? { scenario: startConfiguration.scenario } : {}) }) + '\n');
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
  engineId: CURRENT_ENGINE_ID,
  handbook: args.handbook, run: args.run, startMap: startConfiguration.startMap, seed: startConfiguration.seed, profile: startConfiguration.profile,
  ...(startConfiguration.startMap === 'natural' ? { autoBuildRules: startConfiguration.autoBuildRules } : {}),
  ...(startConfiguration.scenario ? { scenario: startConfiguration.scenario } : {}),
  file: path.basename(filename), resumedYears: resume?.completed.length ?? 0 });
 let failure: unknown;
 let stopped = false;
 let session: Awaited<ReturnType<typeof createCitySession>> | undefined;
 try {
  session = await createCitySession();
  const metrics = await runCity(adapter, args.assignment, session.dispatch, record => {
  writeFileSync(fd, JSON.stringify({ event: 'year-completed', assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run,
   ...record, decisions: record.decisions.map(d => ({ toolCalls: d.toolCalls })) }) + '\n');
  say(`Jahr ${record.year}: ${record.reason}`, 'err', args.live);
  say(`Menschen=${record.afterReport.resPop}, KI=${record.afterReport.aiPop}, Kasse=${record.afterReport.treasury}, Saldo=${record.afterReport.cashFlow}`, 'err', args.live);
  }, (year, report, decision) => {
  if (!decision.toolCalls.length) return;
  writeFileSync(fd, JSON.stringify({ event: 'decision', year, report, toolCalls: decision.toolCalls,
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
  const exactS266Match = args.adapter === 'fake' && startConfiguration.startMap === 'haight' && startConfiguration.seed === 42 && startConfiguration.profile === 'koexistenz';
  if (exactS266Match) verifyS266(metrics);
  const columns = ['assignment', 'model', 'run', 'handbook', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete'];
  const csvFile = path.join(directory, 'runs.csv');
  const header = columns.join(',');
  if (!existsSync(csvFile)) writeFileSync(csvFile, header + '\n', { flag: 'wx' });
  else if (![header, header + ',profile',
   ['assignment', 'model', 'run', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete', 'handbook'].join(','),
   ['assignment', 'model', 'run', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete', 'handbook', 'profile'].join(',')]
   .includes(readFileSync(csvFile, 'utf8').split(/\r?\n/, 1)[0])) {
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
  const actualHeader = readFileSync(csvFile, 'utf8').split(/\r?\n/, 1)[0].split(',');
  const values: Record<string, unknown> = { assignment: args.assignment, model: adapter.model, run: args.run,
   handbook: args.handbook, profile: startConfiguration.profile, ...metrics, inputTokens, outputTokens, tokenUsageComplete };
  appendFileSync(csvFile, actualHeader.map(key => escape(values[key])).join(',') + '\n');
  say(JSON.stringify({ assignment: args.assignment, model: adapter.model, run: args.run,
  protocol: filename, handbook: args.handbook, startMap: startConfiguration.startMap, seed: startConfiguration.seed, profile: startConfiguration.profile,
  metrics, inputTokens, outputTokens, ...(exactS266Match ? { exactS266Match: true } : {}) }, null, 2), 'out');
  progress({ type: 'run-finished', status: 'completed', metrics: { ...metrics },
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
 if (failure) throw new Error('City run failed; no complete metrics row was saved. Inspect the local protocol.');
}

// Exporting verification for tests must not launch a run.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 main().catch(error => {
  console.error(error instanceof StartupError ? error.message : 'City runner failed. Check arguments, environment and local protocol.');
  process.exitCode = 1;
 });
}