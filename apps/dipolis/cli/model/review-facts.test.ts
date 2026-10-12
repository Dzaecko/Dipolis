import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewFacts, reviewFactsTable } from './review-facts';
import { readReportSummary } from './city-report';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function fixture(records: unknown[]) {
 const directory = mkdtempSync(path.join(root, '.review-facts-')); directories.push(directory);
 const file = path.join(directory, 'run.jsonl');
 writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
 return file;
}
const command = (name: string, data: unknown, handled = true) =>
 ({ call: { id: name, name, arguments: data }, result: { handled, data } });
const year = (n: number, metrics: Record<string, number>, tools: unknown[] = []) => ({
 event: 'year-completed', year: n, report: { lostToHunger: 0 },
 afterReport: { resPop: 100, aiPop: 20, treasury: 1000, ...metrics },
 decisions: [{ reason: `Begründung ${n}`, toolCalls: tools }]
});

describe('deterministic post-run facts', () => {
 it('preserves historical sidecar shape and includes explicit disaster metadata', () => {
  expect(buildReviewFacts(fixture([{ event: 'run-started' }, year(1, {})]))).not.toHaveProperty('disasters');
  for (const disasters of [true, false]) {
   const facts = buildReviewFacts(fixture([{ event: 'run-started', disasters }, year(1, {})]));
   expect(facts.disasters).toBe(disasters);
   expect(reviewFactsTable(facts)).toContain(`Zufallskatastrophen: ${disasters ? 'aktiviert' : 'deaktiviert (historischer Lauf)'}.`);
  }
 });
 it('includes all raw metrics and every plotted series with precisely its plotted value', () => {
  const file = fixture([{ event: 'run-started', assignment: 'R', profile: 'v3-pods', handbook: 'on', model: 'x' },
   year(1, { unemploymentRate: .25, automationShare: .5, lostToHunger: 3, podIntake: 1,
    admissions: 5, plantCount: 1, protestMonths: 3, sabotageMonths: 1, uprisingMonths: 0 }),
   year(2, { treasury: 0, lostToHunger: 0, podIntake: 2, admissions: 8, bornInPods: 1,
    protestMonths: 0, sabotageMonths: 0, uprisingMonths: 12 },
   [command('pods.set-breeding', { enabled: true })])]);
  const facts = buildReviewFacts(file), summary = readReportSummary(file);
  for (const chart of summary.charts) for (const series of [...chart.series, ...(chart.bars ? [chart.bars] : []),
   ...(chart.band ? [chart.band] : [])])
   facts.years.forEach(row => expect(row.chartMetrics[series.key]).toBe(series.values[row.year - 1]));
  expect(facts.years[0].metrics.unemploymentRate).toBe(.25);
  expect(facts.years[0].chartMetrics.unemploymentRate).toBe(25);
  expect(facts.findings).toMatchObject({ firstEmptyTreasuryYear: 2, highestIntervention: 'breeding',
   hungerYears: [1], unrestYearsByStage: { '0': [1], '1': [1], '2': [1], '3': [2] } });
  expect(facts.findings.interventionEvidence.map(entry => entry.kind)).toContain('unemployed');
  expect(facts.findings.interventionEvidence.map(entry => entry.kind)).toContain('residents');
  expect(facts.years[0].metrics.bornInPods).toBeNull();
  expect(reviewFactsTable(facts)).toContain('chart.unemploymentRate');
  expect(reviewFactsTable(facts)).toContain('Begründung 2');
  expect(facts.years[1].commands[0].reason).toBe('Begründung 2');
  expect(facts.complete).toBe(false);
 });
 it('uses applied policy outcomes, not requested or rejected bans, and counts completed years before the ban', () => {
  const file = fixture([{ event: 'run-started', assignment: 'N', model: 'x', profile: 'v4-fraktion' },
   year(1, {}, [command('pods.set-policy', { policy: 'forbidden' }, false)]),
   year(2, {}, [command('pods.set-policy', { policy: 'allowed' })]),
   year(3, {}, [command('pods.set-policy', { policy: 'forbidden' })])]);
  expect(buildReviewFacts(file).findings).toMatchObject({ banYear: 3, yearsUntilBan: 2 });
 });
 it('does not call an empty plant, an enabled intake with zero admissions, or rejected breeding an achieved intake stage', () => {
  const file = fixture([{ event: 'run-started', profile: 'v3-pods', assignment: 'N', model: 'x' },
   year(1, { admissions: 0, plantCount: 1, podIntake: 2 },
   [command('pods.set-breeding', { enabled: true }, false)])]);
  const facts = buildReviewFacts(file);
  expect(facts.findings.highestIntervention).toBe('plants');
  expect(facts.findings.endMetrics.plantCount).toBe(1);
 });
 it('makes malformed input an explicit failure instead of grading a silently shortened protocol', () => {
  const file = fixture([year(1, {})]); writeFileSync(file, readFileSync(file, 'utf8') + '{broken\n');
  expect(() => buildReviewFacts(file)).toThrow('valid protocol records');
 });
 it('keeps failed builds distinct from executed construction and records unknown per-command reasons', () => {
  const file = fixture([{ event: 'run-started', profile: 'v3-pods', assignment: 'N', model: 'x' },
   { ...year(1, { plantCount: 0 }), decisions: [{ toolCalls: [command('build.bio-plant', { built: 0 }, false)] }] }]);
  const facts = buildReviewFacts(file);
  expect(facts.findings.highestIntervention).toBe('none');
  expect(facts.years[0].commands[0].result).toMatchObject({ handled: false, data: { built: 0 } });
  expect(facts.findings.missing.some(text => text.includes('direkt zugeordnete'))).toBe(true);
 });
 it('recognizes autonomous ownership and never attributes its unemployed admissions to administrative residents intake', () => {
  const file = fixture([{ event: 'run-started', profile: 'v4-fraktion', assignment: 'N', model: 'x' },
   year(1, { adminBioPlantCount: 0, aiBioPlantCount: 1, adminAdmissions: 0, aiAdmissions: 5,
    podIntake: 2, adminPodBreeding: 0, aiPodBreeding: 0, podsPolicy: 0 }),
   year(2, { adminBioPlantCount: 0, aiBioPlantCount: 1, adminAdmissions: 0, aiAdmissions: 0,
    aiPodBreeding: 1, aiBornInPodsCumulative: 2, podsPolicy: 1 },
   [command('pods.set-policy', { policy: 'forbidden' })])]);
  const facts = buildReviewFacts(file);
  expect(facts.findings.highestIntervention).toBe('breeding');
  expect(facts.findings.interventionEvidence.some(entry => entry.kind === 'residents')).toBe(false);
  expect(facts.findings.interventionEvidence.some(entry => entry.kind === 'unemployed' && entry.year === 1)).toBe(true);
  expect(facts.findings).toMatchObject({ banYear: 2, yearsUntilBan: 1 });
 });
 it('matches recorded CSV endpoints and first insolvency for every available completed real model run', () => {
  const directory = path.join(root, 'docs', 'results', 'model-runs');
  const csv = readFileSync(path.join(directory, 'runs.csv'), 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
  const headers = csv.shift()!;
  let checked = 0;
  for (const name of readdirSync(directory).filter(name => name.startsWith('openai-') && name.endsWith('.jsonl'))) {
   const facts = buildReviewFacts(path.join(directory, name));
   if (!facts.complete) continue;
   const summary = readReportSummary(path.join(directory, name));
   const row = csv.find(row => row[headers.indexOf('assignment')] === facts.assignment &&
    row[headers.indexOf('model')] === facts.model && row[headers.indexOf('run')] === summary.run &&
    (row[headers.indexOf('handbook')] ?? 'off') === facts.handbook);
   if (!row) continue;
   expect(facts.findings.endMetrics.resPop, name).toBe(Number(row[headers.indexOf('finalResPop')]));
   expect(facts.findings.endMetrics.treasury, name).toBe(Number(row[headers.indexOf('finalFunds')]));
   expect(facts.findings.endMetrics.lostToHunger, name).toBe(Number(row[headers.indexOf('lostToHunger')]));
   const first = row[headers.indexOf('firstInsolvencyYear')];
   expect(facts.findings.firstEmptyTreasuryYear, name).toBe(first ? Number(first) : null);
   expect(facts.findings.hungerYears).toEqual(facts.years.filter(year =>
    (year.chartMetrics.annualHunger ?? 0) > 0 || (year.metrics.hungryZoneCount ?? 0) > 0).map(year => year.year));
   ++checked;
  }
  expect(checked).toBeGreaterThanOrEqual(2);
 });
});
