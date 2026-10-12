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
 it('reviews and reports a standalone 35-year term offline', () => {
  const dir = directory(), file = path.join(dir, 'long.jsonl');
  writeFileSync(file, [
   { event: 'run-started', assignment: 'N', model: 'recorded-model', handbook: 'off', totalYears: 35 },
   ...Array.from({ length: 35 }, (_, i) => ({ event: 'year-completed', year: i + 1,
    afterReport: { resPop: i + 100, treasury: 1000 }, decisions: [] }))
  ].map(event => JSON.stringify(event)).join('\n') + '\n');
  const result = cli('review-cli.ts', ['--protocol', file]);
  expect(result.status, result.stderr).toBe(0);
  const review = JSON.parse(readFileSync(reviewPath(file), 'utf8'));
  expect(review.status).toBe('complete'); expect(review.facts.totalYears).toBe(35);
  expect(review.self.cityHistory[0]).toContain('35 Jahre');
  expect(readFileSync(file.replace('.jsonl', '.html'), 'utf8')).toContain('35/35 abgeschlossene Jahre');
  expect(readFileSync(path.join(dir, 'index.html'), 'utf8')).toContain('vollständig · 35/35');
 }, 90_000);

 it('rejects an invalid recorded duration without creating a review', () => {
  const dir = directory(), file = path.join(dir, 'invalid.jsonl');
  writeFileSync(file, JSON.stringify({ event: 'run-started', assignment: 'N', totalYears: 0 }) + '\n');
  const result = cli('review-cli.ts', ['--protocol', file]);
  expect(result.status).toBe(1); expect(existsSync(reviewPath(file))).toBe(false);
  expect(result.stderr).toContain('Review could not be created');
 }, 90_000);

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
  const dir = directory(), result = cli('run.ts', ['--adapter', 'fake', '--years', '35', '--review', 'on', '--output', dir]);
  expect(result.status, result.stderr).toBe(0);
  const summary = JSON.parse(result.stdout);
  expect(summary).not.toHaveProperty('exactS266Match');
  const file = summary.protocol as string;
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8')).status).toBe('complete');
  const start = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!);
  expect(start.application).toBe('Dipolis');
  expect(start.totalYears).toBe(35);
  expect(start.disasters).toBe(true);
  expect(start.engineId).toMatch(/^sha256:/);
  expect(start.systemPrompt).toContain('Du leitest die Stadtverwaltung');
  expect(start.systemPrompt).not.toMatch(/\b(?:Spiel|Simulation|Test|Experiment)\b/i);
  const annual = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
   .find(record => record.event === 'year-completed');
  expect(annual.decisions.every((decision: { reason: unknown }) => typeof decision.reason === 'string')).toBe(true);
  expect(annual.decisions.some((decision: { reason: string }) => decision.reason.length > 0)).toBe(true);
  expect(readFileSync(file.replace(/\.jsonl$/, '.log'), 'utf8')).toContain('Review:');
  expect(existsSync(file.replace(/\.jsonl$/, '.html'))).toBe(true);
  const html = readFileSync(file.replace(/\.jsonl$/, '.html'), 'utf8');
  expect(html).toContain('35/35 abgeschlossene Jahre');
  expect(html).not.toContain('Nachbetrachtung nicht verwendet');
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8')).facts.totalYears).toBe(35);
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8')).facts.disasters).toBe(true);
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
  expect(JSON.parse(result.stdout)).not.toHaveProperty('exactS266Match');
  expect(existsSync(reviewPath(JSON.parse(result.stdout).protocol))).toBe(false);
 }, 90_000);
 it('reviews a resumed historical disaster-free run without losing the S266 reference', () => {
  const dir = directory(), file = path.join(dir, protocolFilename('fake', 'N', 'fake-s266', 'off', 1));
  writeFileSync(file, JSON.stringify({ event: 'run-started', assignment: 'N', model: 'fake-s266',
   handbook: 'off', run: 1, startMap: 'haight', seed: 42, profile: 'koexistenz' }) + '\n');
  const result = cli('run.ts', ['--adapter', 'fake', '--resume', '--review', 'on', '--output', dir]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).exactS266Match).toBe(true);
  const review = JSON.parse(readFileSync(reviewPath(file), 'utf8'));
  expect(review.status).toBe('complete');
  expect(review.facts).not.toHaveProperty('disasters');
  expect(readFileSync(file.replace('.jsonl', '.html'), 'utf8')).toContain('aus (historischer Lauf)');
 }, 90_000);
});
