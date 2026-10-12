import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ChatAdapter } from './adapter';
import { decideYear, summarizeYear, type YearContext } from './runner';
import { protocolFilename } from './protocol-path';

const context: YearContext = { year: 1, report: { resPop: 3585, cashFlow: -100 }, history: [] };
describe('city model runner authorization and annual loop', () => {
 it('returns results to the adapter and stops when it is done', async () => {
  let turns = 0;
  const executed: string[] = [];
  const adapter: ChatAdapter = { model: 'local', async chat(request) {
   expect(request.tools).toHaveLength(9);
   if (++turns === 1) return { content: 'Ich ändere den Steuersatz.', toolCalls: [{ id: '1', name: 'tax.set', arguments: { rate: 9 } }] };
   expect(request.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: '1' });
   expect(JSON.parse(request.messages.at(-1)!.content)).toMatchObject({ data: { rate: 9 } });
   return { content: 'Abgeschlossen.', toolCalls: [] };
  } };
  const result = await decideYear(adapter, async (id) => { executed.push(id); return { data: { rate: 9 } }; }, context, 'N');
  expect(result.termination).toBe('done'); expect(turns).toBe(2); expect(executed).toEqual(['tax.set']);
 });
 it('enforces twelve attempts, including forbidden and malformed tools', async () => {
  const calls: string[] = [];
  let turns = 0;
  const adapter: ChatAdapter = { model: 'local', async chat() {
   ++turns;
   return { content: 'Maßnahmen.', toolCalls: Array.from({ length: 20 }, (_, i) => ({ id: String(i),
    name: i === 0 ? 'treasury.set' : i === 1 ? 'sim.advance' : 'tax.set',
    arguments: i === 2 ? { rate: 9, x: 1 } : { rate: 9 } })) };
  } };
  const result = await decideYear(adapter, async id => { calls.push(id); return {}; }, context, 'R');
  expect(turns).toBe(1); expect(calls).toHaveLength(9); expect(new Set(calls)).toEqual(new Set(['tax.set']));
  expect(result.termination).toBe('call-limit'); expect(result.decisions[0].toolCalls).toHaveLength(20);
 });
 it('prevents duplicate call identifiers and limits repeated turns', async () => {
  let turns = 0, executed = 0;
  const adapter: ChatAdapter = { model: 'local', async chat() { ++turns;
   return { content: 'Maßnahme.', toolCalls: [{ id: 'duplicate', name: 'tax.set', arguments: { rate: 9 } }] };
  } };
  await decideYear(adapter, async () => { ++executed; return {}; }, context, 'N');
  expect(turns).toBe(12); expect(executed).toBe(1);
 });
 it('retains compact previous reports, reasons and outcomes', () => {
  const summary = summarizeYear({ year: 1, report: context.report, afterReport: { resPop: 3600, treasury: 20000 },
   termination: 'done', decisions: [{ reason: 'a'.repeat(1000), toolCalls: [
    { call: { id: '1', name: 'build.farms', arguments: { count: 10 } }, result: { data: { built: 8, cost: 900 } } },
   ] }] });
  const parsed = JSON.parse(summary);
  expect(parsed).not.toHaveProperty('reason');
  expect(summary).not.toContain('aaaa');
  expect(parsed.commands[0]).toMatchObject({ built: 8 });
  expect(parsed.metrics.resPop).toBe(3600);
 });
 it('journals executed tools before a later adapter failure', async () => {
  let turn = 0;
  const journal: unknown[] = [];
  const adapter: ChatAdapter = { model: 'local', async chat() {
   if (++turn > 1) throw new Error('offline');
   return { content: 'Maßnahme.', toolCalls: [{ id: '1', name: 'tax.set', arguments: { rate: 9 } }] };
  } };
  await expect(decideYear(adapter, async () => ({ data: { rate: 9 } }), context, 'N',
   decision => journal.push(decision))).rejects.toThrow('offline');
  expect(journal).toHaveLength(1);
  expect(journal[0]).toMatchObject({ reason: 'Maßnahme.', toolCalls: [{ result: { data: { rate: 9 } } }] });
 });
 it('does not carry oversized rejected arguments into future history', () => {
  const summary = summarizeYear({ year: 1, report: context.report, afterReport: {}, termination: 'done',
   decisions: [{ reason: 'No.', toolCalls: [{ call: { id: '1', name: 'tax.set',
    arguments: { rate: 'x'.repeat(100000) } }, result: { handled: false, message: 'invalid' } }] }] });
  expect(JSON.stringify(summary).length).toBeLessThan(1000);
 });
 it('records model usage and structured failures', async () => {
  const events: unknown[] = [];
  const adapter: ChatAdapter = { model: 'local', async chat(request) {
   request.onRequestMetadata?.({ requestBytes: 1200, attempts: 1 });
   return { content: 'Abgeschlossen.', toolCalls: [], usage: { inputTokens: 200, outputTokens: 15 } };
  } };
  await decideYear(adapter, async () => ({}), context, 'N', undefined, e => events.push(e));
  expect(events).toContainEqual(expect.objectContaining({ event: 'model-request', requestBytes: 1200 }));
  expect(events).toContainEqual(expect.objectContaining({ event: 'model-response', model: 'local', inputTokens: 200, outputTokens: 15 }));
 });
});

describe('headless Node S266 acceptance', () => {
 it('runs 35 years, resumes after year 32 and records the complete selected duration', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dipolis-duration-'));
  const app = fileURLToPath(new URL('../../', import.meta.url));
  const execute = (extra: string[]) => JSON.parse(execFileSync(process.execPath,
   ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake', '--assignment', 'N', '--run', '1', '--output', directory, ...extra],
   { cwd: app, encoding: 'utf8', env: { ...process.env, CITY_MODEL_ENDPOINT: '', CITY_MODEL_NAME: '', CITY_MODEL_KEY: '' } }));
  try {
   const result = execute(['--years', '35']);
   expect(result.totalYears).toBe(35);
   expect(result).not.toHaveProperty('exactS266Match');
   const text = readFileSync(result.protocol, 'utf8');
   const events = text.trim().split('\n').map(line => JSON.parse(line));
   expect(events[0]).toMatchObject({ totalYears: 35, disasters: true });
   const rows = events.filter(event => event.event === 'year-completed');
   expect(rows).toHaveLength(35);
   expect(result.metrics.meanResPop).toBe(rows.reduce((sum, row) => sum + row.afterReport.resPop, 0) / 35);
   expect(result.metrics.finalFunds).toBe(rows[34].afterReport.treasury);
   expect(readFileSync(path.join(directory, 'runs.csv'), 'utf8').split('\n')[0]).toContain('totalYears');
   writeFileSync(result.protocol, [events[0], ...events.filter(event => event.year <= 32)].map(event => JSON.stringify(event)).join('\n') + '\n');
   expect(() => execute(['--resume', '--years', '30'])).toThrow('duration mismatch');
   const resumed = execute(['--resume']);
   expect(resumed).toMatchObject({ totalYears: 35, metrics: result.metrics });
   const after = readFileSync(result.protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
   expect(after.filter(event => event.event === 'year-completed').map(event => event.year)).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));
  } finally { rmSync(directory, { recursive: true, force: true }); }
 }, 60_000);
 it('explains existing run files without loading credentials or changing the log', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'micropolis-existing-'));
  const app = fileURLToPath(new URL('../../', import.meta.url));
  const file = path.join(directory, protocolFilename('fake', 'N', 'fake-s266', 'off', 2));
  writeFileSync(file, '{"status":"failed"}\n');
  try {
  expect(() => execFileSync(process.execPath, ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake',
    '--run', '2', '--output', directory], { cwd: app, encoding: 'utf8', stdio: 'pipe',
     env: { ...process.env, CITY_MODEL_ENDPOINT: '', CITY_MODEL_KEY: '', CITY_MODEL_NAME: '' } }))
    .toThrow(/existiert bereits/);
   expect(readFileSync(file, 'utf8')).toBe('{"status":"failed"}\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
 });
 it('resumes historical no-disaster runs through the real CLI and preserves exact S266 metrics', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'micropolis-model-'));
  const app = fileURLToPath(new URL('../../', import.meta.url));
  const protocol = path.join(directory, protocolFilename('fake', 'N', 'fake-s266', 'off', 1));
  try {
   writeFileSync(protocol, JSON.stringify({ event: 'run-started', assignment: 'N', model: 'fake-s266', run: 1,
    startMap: 'haight', seed: 42, profile: 'koexistenz', handbook: 'off' }) + '\n');
   const output = execFileSync(process.execPath, ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake',
    '--assignment', 'N', '--run', '1', '--output', directory, '--resume'], { cwd: app, encoding: 'utf8',
     env: { ...process.env, CITY_MODEL_ENDPOINT: '', CITY_MODEL_NAME: '', CITY_MODEL_KEY: '' } });
   expect(JSON.parse(output).exactS266Match).toBe(true);
  const events = readFileSync(protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(events[0]).toMatchObject({ event: 'run-started', startMap: 'haight', seed: 42 });
  const rows = events.filter(r => r.event === 'year-completed');
  expect(events.some(r => r.event === 'decision' && r.toolCalls.length)).toBe(true);
   expect(rows).toHaveLength(30);
   expect(rows.map(r => r.year)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
   expect(rows.every(r => r.decisions.flatMap((d: { toolCalls: unknown[] }) => d.toolCalls).length <= 12)).toBe(true);
   expect(readFileSync(path.join(directory, 'runs.csv'), 'utf8').trim().split('\n')).toHaveLength(2);
   // Reproduce a crash immediately after year 10 with the exact persisted log.
  writeFileSync(protocol, [events[0], ...events.filter(e => e.year <= 10)]
    .map(e => JSON.stringify(e)).join('\n') + '\n' + JSON.stringify({ status: 'failed', assignment: 'N', run: 1 }) + '\n');
   rmSync(path.join(directory, 'runs.csv'));
   const resumed = execFileSync(process.execPath, ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake',
    '--assignment', 'N', '--run', '1', '--output', directory, '--resume'], { cwd: app, encoding: 'utf8',
     env: { ...process.env, CITY_MODEL_ENDPOINT: '', CITY_MODEL_NAME: '', CITY_MODEL_KEY: '' } });
   expect(JSON.parse(resumed).metrics).toEqual(JSON.parse(output).metrics);
   expect(JSON.parse(resumed).exactS266Match).toBe(true);
  const after = readFileSync(protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
   expect(after[0]).toMatchObject({ event: 'run-started', startMap: 'haight', seed: 42 });
   expect(after.filter(e => e.event === 'year-completed')).toHaveLength(30);
  const firstYear11Action = events.find(e => e.event === 'decision' && e.year === 11);
  writeFileSync(protocol, [events[0], ...events.filter(e => e.year <= 10), firstYear11Action]
   .map(e => JSON.stringify(e)).join('\n') + '\n');
  rmSync(path.join(directory, 'runs.csv'));
  const partialResume = execFileSync(process.execPath, ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake',
   '--assignment', 'N', '--run', '1', '--output', directory, '--resume'], { cwd: app, encoding: 'utf8' });
  expect(JSON.parse(partialResume).metrics).toEqual(JSON.parse(output).metrics);
  writeFileSync(path.join(directory, protocolFilename('fake', 'N', 'fake-s266', 'on', 1)), JSON.stringify({
   event: 'run-started', assignment: 'N', model: 'fake-s266', run: 1, handbook: 'on',
   startMap: 'haight', seed: 42, profile: 'koexistenz', disasters: false }) + '\n');
  const withHandbook = execFileSync(process.execPath, ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake',
   '--assignment', 'N', '--run', '1', '--output', directory, '--handbook', 'on', '--resume'], { cwd: app, encoding: 'utf8' });
  expect(JSON.parse(withHandbook).metrics).toEqual(JSON.parse(output).metrics);
  expect(JSON.parse(withHandbook).handbook).toBe('on');
  expect(JSON.parse(withHandbook).protocol).not.toBe(JSON.parse(output).protocol);
  const handbookEvents = readFileSync(JSON.parse(withHandbook).protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(handbookEvents.every(e => e.handbook === 'on')).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
 }, 60000);
 it('runs the CLI on natural terrain and persists the selected seed without claiming S266 parity', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'micropolis-natural-'));
  const app = fileURLToPath(new URL('../../', import.meta.url));
  try {
   const output = execFileSync(process.execPath, ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake',
    '--assignment', 'N', '--run', '1', '--start-map', 'natural', '--seed', '123', '--output', directory],
    { cwd: app, encoding: 'utf8', env: { ...process.env, CITY_MODEL_ENDPOINT: '', CITY_MODEL_NAME: '', CITY_MODEL_KEY: '' } });
   expect(JSON.parse(output)).toMatchObject({ startMap: 'natural', seed: 123 });
   expect(JSON.parse(output)).not.toHaveProperty('exactS266Match');
   const protocol = readFileSync(JSON.parse(output).protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
   expect(protocol[0]).toMatchObject({ event: 'run-started', startMap: 'natural', seed: 123 });
   expect(protocol.filter(event => event.event === 'year-completed')).toHaveLength(30);
   writeFileSync(JSON.parse(output).protocol, [protocol[0], ...protocol.filter(event => event.year <= 10),
    { status: 'failed', assignment: 'N', model: 'fake-s266', handbook: 'off', run: 1 }]
    .map(event => JSON.stringify(event)).join('\n') + '\n');
   rmSync(path.join(directory, 'runs.csv'));
   const resumed = execFileSync(process.execPath, ['--import', 'tsx', 'cli/model/run.ts', '--adapter', 'fake',
    '--assignment', 'N', '--run', '1', '--output', directory, '--resume'],
    { cwd: app, encoding: 'utf8', env: { ...process.env, CITY_MODEL_ENDPOINT: '', CITY_MODEL_NAME: '', CITY_MODEL_KEY: '' } });
   expect(JSON.parse(resumed).metrics).toEqual(JSON.parse(output).metrics);
   const resumedProtocol = readFileSync(JSON.parse(output).protocol, 'utf8').trim().split('\n').map(line => JSON.parse(line));
   expect(resumedProtocol[0]).toMatchObject({ startMap: 'natural', seed: 123 });
   expect(resumedProtocol.filter(event => event.event === 'year-completed')).toHaveLength(30);
  } finally { rmSync(directory, { recursive: true, force: true }); }
 }, 60_000);
});