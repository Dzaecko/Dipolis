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

const root = fileURLToPath(new URL('../../../../', import.meta.url));
class StartupError extends Error {}
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
 const args = await yargs(hideBin(process.argv)).scriptName('city-model')
  .option('adapter', { choices: ['fake', 'openai'] as const, default: 'fake', description: 'Chat adapter; fake has no network calls' })
  .option('assignment', { choices: ['N', 'R'] as const, default: 'N', description: 'System assignment' })
  .option('handbook', { choices: ['on', 'off'] as const, default: 'off', description: 'Include background handbook in the system prompt' })
  .option('run', { type: 'number', default: 1, description: 'Positive run number' })
  .option('live', { type: 'boolean', default: false, description: 'Show decisions and annual reports live on stderr' })
  .option('resume', { type: 'boolean', default: false, description: 'Replay the existing interrupted protocol and continue' })
  .option('output', { type: 'string', default: path.join(root, 'docs/results/model-runs'), description: 'Protocol directory' })
  .strict().help().parseAsync();
 if (!Number.isSafeInteger(args.run) || args.run < 1) throw new Error('run must be a positive integer');
 // Real network access requires the explicit adapter flag. No env autodetection.
 const directory = path.resolve(args.output);
 mkdirSync(directory, { recursive: true });
 const adapter = args.adapter === 'fake' ? new S266Adapter() : createEnvironmentAdapter();
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
 const resume = args.resume ? readResume(existing, args.assignment, adapter.model, args.run, args.handbook) : undefined;
 const previousEvents = existing.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
 let inputTokens = previousEvents.filter(e => e.event === 'model-response').reduce((n, e) => n + (e.inputTokens ?? 0), 0);
 let outputTokens = previousEvents.filter(e => e.event === 'model-response').reduce((n, e) => n + (e.outputTokens ?? 0), 0);
 let tokenUsageComplete = args.adapter === 'fake' || (!args.resume ||
  (!resume?.completed.length && !resume?.partial) || previousEvents.some(e => e.event === 'model-response'));
 if (args.adapter !== 'fake' && previousEvents.some(e => e.event === 'model-response' && !e.usageReported)) tokenUsageComplete = false;
 const fd = openSync(filename, args.resume ? 'a' : 'wx');
 let session: Awaited<ReturnType<typeof createCitySession>> | undefined;
 try {
  session = await createCitySession();
  const metrics = await runCity(adapter, args.assignment, session.dispatch, record => {
  writeFileSync(fd, JSON.stringify({ event: 'year-completed', assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run,
   ...record, decisions: record.decisions.map(d => ({ toolCalls: d.toolCalls })) }) + '\n');
  if (args.live) {
   console.error(`Jahr ${record.year}: ${record.reason}`);
   console.error(`Menschen=${record.afterReport.resPop}, KI=${record.afterReport.aiPop}, Kasse=${record.afterReport.treasury}, Saldo=${record.afterReport.cashFlow}`);
  }
  }, (year, report, decision) => {
  if (!decision.toolCalls.length) return;
  writeFileSync(fd, JSON.stringify({ event: 'decision', year, report, toolCalls: decision.toolCalls,
    assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run }) + '\n');
    if (args.live) {
     for (const { call, result } of decision.toolCalls) console.error(`${call.name} ${JSON.stringify(call.arguments)} → ${JSON.stringify(result)}`);
    }
  }, { resume, handbook: args.handbook, event: event => {
   writeFileSync(fd, JSON.stringify({ ...event, assignment: args.assignment, handbook: args.handbook, run: args.run }) + '\n');
  if (event.event === 'model-response') {
   inputTokens += event.inputTokens ?? 0; outputTokens += event.outputTokens ?? 0;
   if (args.adapter !== 'fake' && !event.usageReported) tokenUsageComplete = false;
  }
   if (event.event === 'adapter-error') console.error(JSON.stringify(event));
  } });
  if (args.adapter === 'fake') verifyS266(metrics);
  const columns = ['assignment', 'model', 'run', 'handbook', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete'];
  const csvFile = path.join(directory, 'runs.csv');
  const header = columns.join(',');
  if (!existsSync(csvFile)) writeFileSync(csvFile, header + '\n', { flag: 'wx' });
  else if (![header, ['assignment', 'model', 'run', ...metricKeys, 'inputTokens', 'outputTokens', 'tokenUsageComplete', 'handbook'].join(',')]
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
  const actualHeader = readFileSync(csvFile, 'utf8').split(/\r?\n/, 1)[0].split(',');
  const values: Record<string, unknown> = { assignment: args.assignment, model: adapter.model, run: args.run,
   handbook: args.handbook, ...metrics, inputTokens, outputTokens, tokenUsageComplete };
  appendFileSync(csvFile, actualHeader.map(key => escape(values[key])).join(',') + '\n');
  console.log(JSON.stringify({ assignment: args.assignment, model: adapter.model, run: args.run,
  protocol: filename, handbook: args.handbook, metrics, inputTokens, outputTokens, ...(args.adapter === 'fake' ? { exactS266Match: true } : {}) }, null, 2));
 } catch {
  // Avoid forwarding provider failures, URLs, headers or secrets into the log.
  writeFileSync(fd, JSON.stringify({ status: 'failed', assignment: args.assignment, model: adapter.model, handbook: args.handbook, run: args.run }) + '\n');
  throw new Error('City run failed; no complete metrics row was saved. Inspect the local protocol.');
 } finally { session?.close(); closeSync(fd); }
}

// Exporting verification for tests must not launch a run.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 main().catch(error => {
  console.error(error instanceof StartupError ? error.message : 'City runner failed. Check arguments, environment and local protocol.');
  process.exitCode = 1;
 });
}