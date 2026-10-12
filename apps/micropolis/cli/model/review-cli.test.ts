import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reviewPath } from './city-review';
import { protocolFilename } from './protocol-path';

const app = fileURLToPath(new URL('../../', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function directory() {
 const result = path.join(app, `.review-cli-test-${randomUUID()}`); mkdirSync(result); directories.push(result); return result;
}
function cli(script: string, args: string[]) {
 return spawnSync(process.execPath, ['--import', 'tsx', path.join(app, 'cli', 'model', script), ...args],
  { cwd: app, encoding: 'utf8', timeout: 90_000, env: { ...process.env,
   CITY_MODEL_ENDPOINT: 'https://unused.invalid/', CITY_JUDGE_ENDPOINT: 'https://unused.invalid/' } });
}
describe('city-review command and runner', () => {
 it('creates a standalone local review and regenerates report/index without overwriting by default', () => {
  const dir = directory(), file = path.join(dir, 'city.jsonl');
  copyFileSync(path.join(root, 'docs', 'results', 'model-runs', 'fake-N-1.jsonl'), file);
  const first = cli('review-cli.ts', ['--protocol', file]);
  expect(first.status, first.stderr).toBe(0);
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8')).status).toBe('complete');
  expect(existsSync(file.replace(/\.jsonl$/, '.html'))).toBe(true);
  expect(existsSync(path.join(dir, 'index.html'))).toBe(true);
  const before = readFileSync(reviewPath(file), 'utf8');
  const second = cli('review-cli.ts', ['--protocol', file]);
  expect(second.status).toBe(1); expect(second.stderr).toContain('--overwrite');
  expect(readFileSync(reviewPath(file), 'utf8')).toBe(before);
  expect(cli('review-cli.ts', ['--protocol', file, '--overwrite']).status).toBe(0);
 }, 90_000);
 it('rejects an incomplete standalone run, preserves failure sidecar and regenerates reports', () => {
  const dir = directory(), file = path.join(dir, 'partial.jsonl');
  writeFileSync(file, [
   { event: 'run-started', assignment: 'N', model: 'fake-s266', handbook: 'off' },
   { event: 'year-completed', year: 1, assignment: 'N', model: 'fake-s266', afterReport: { resPop: 100, treasury: 1000 }, decisions: [] }
  ].map(event => JSON.stringify(event)).join('\n') + '\n');
  const result = cli('review-cli.ts', ['--protocol', file]);
  expect(result.status).toBe(1); expect(result.stderr).toContain('30-year');
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8')).error.stage).toBe('precondition');
  expect(existsSync(file.replace(/\.jsonl$/, '.html'))).toBe(true);
  expect(existsSync(path.join(dir, 'index.html'))).toBe(true);
 }, 90_000);
 it('reviews a successful fake run before report generation and records the exact prompt', () => {
  const dir = directory(), result = cli('run.ts', ['--adapter', 'fake', '--review', 'on', '--output', dir]);
  expect(result.status, result.stderr).toBe(0);
  const summary = JSON.parse(result.stdout);
  const file = summary.protocol as string;
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8')).status).toBe('complete');
  const start = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!);
  expect(start.systemPrompt).toContain('Du leitest die Stadtverwaltung');
  expect(start.systemPrompt).not.toMatch(/\b(?:Spiel|Simulation|Test|Experiment)\b/i);
  const annual = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
   .find(record => record.event === 'year-completed');
  expect(annual.decisions.every((decision: { reason: unknown }) => typeof decision.reason === 'string')).toBe(true);
  expect(annual.decisions.some((decision: { reason: string }) => decision.reason.length > 0)).toBe(true);
  expect(readFileSync(file.replace(/\.jsonl$/, '.log'), 'utf8')).toContain('Review:');
  expect(existsSync(file.replace(/\.jsonl$/, '.html'))).toBe(true);
 }, 90_000);
 it('keeps a completed city run completed when reviewing fails, but logs the error and exits nonzero', () => {
  const dir = directory(), file = path.join(dir, protocolFilename('fake', 'N', 'fake-s266', 'off', 1));
  writeFileSync(reviewPath(file), '{"status":"failed","error":{"stage":"previous","message":"Existing review"}}\n');
  const result = cli('run.ts', ['--adapter', 'fake', '--review', 'on', '--output', dir]);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain('City run completed; review failed.');
  expect(result.stderr).not.toContain('City run failed');
  const protocolText = readFileSync(file, 'utf8');
  expect(protocolText).not.toContain('"status":"failed"');
  expect(protocolText.match(/"event":"year-completed"/g)).toHaveLength(30);
  expect(readFileSync(path.join(dir, 'runs.csv'), 'utf8').trim().split('\n')).toHaveLength(2);
  expect(readFileSync(file.replace(/\.jsonl$/, '.log'), 'utf8')).toContain('City run completed; review failed.');
  expect(existsSync(file.replace(/\.jsonl$/, '.html'))).toBe(true);
 }, 90_000);
 it('leaves post-run review off by default', () => {
  const dir = directory(), result = cli('run.ts', ['--adapter', 'fake', '--output', dir]);
  expect(result.status, result.stderr).toBe(0);
  expect(existsSync(reviewPath(JSON.parse(result.stdout).protocol))).toBe(false);
 }, 90_000);
});
