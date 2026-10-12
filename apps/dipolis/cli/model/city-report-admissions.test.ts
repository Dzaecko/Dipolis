import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAdmissionMetrics, validAdmissionMetrics, type YearRecord } from '../../src/lib/city-run/protocol';
import { createNotstandConfiguration, notstandAnnualSection, notstandMetrics } from './rescue-metrics';
import { emergencyOverview, generateCityReport, generateReportIndex, readReportSummary } from './city-report';
import { buildReviewFacts, reviewFactsTable } from './review-facts';
import { generateCityReview, judgeReviewPrompt, reviewPath } from './city-review';
import { loadCityReview } from './city-review-render';
import { systemPrompt } from './prompts';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const counters = (total: number, employed?: number, unemployed?: number) => ({
 admissionsCumulative: total,
 ...(employed === undefined ? {} : { admittedEmployedCumulative: employed }),
 ...(unemployed === undefined ? {} : { admittedUnemployedCumulative: unemployed })
});
const year = (year: number, before: Record<string, number>, after: Record<string, number>): YearRecord => ({
 year, report: before, afterReport: after, decisions: [], termination: 'done'
});
const configuration = createNotstandConfiguration({ rescuePressure: 1 }, { totalYears: 2 });
function fixture(records: YearRecord[]) {
 const directory = mkdtempSync(path.join(fileURLToPath(new URL('../../', import.meta.url)), '.admission-report-test-'));
 directories.push(directory);
 const file = path.join(directory, 'admissions.jsonl');
 writeFileSync(file, [
  { event: 'run-started', ...configuration, assignment: 'R', model: 'fixture', handbook: 'off',
   systemPrompt: systemPrompt('R', 'off', 'haight', 'v4-fraktion', 2) },
  ...records.map(record => ({ event: 'year-completed', ...record })),
  { event: 'run-completed', status: 'completed', metrics: notstandMetrics(records, configuration, true) }
 ].map(record => JSON.stringify(record)).join('\n'));
 return { file, directory };
}

describe('recorded admission metrics', () => {
 it('derives totals and annual deltas, separating employed people, unemployed people, and births', () => {
  const records = [year(1, counters(0, 0, 0), { ...counters(7, 2, 5), bornInPodsCumulative: 20 }),
   year(2, counters(7, 2, 5), { ...counters(10, 3, 7), bornInPodsCumulative: 100 })];
  const expected = { admittedTotal: 10, admittedEmployed: 3, admittedUnemployed: 7,
   admissionsByYear: [{ year: 1, total: 7, employed: 2, unemployed: 5 },
    { year: 2, total: 3, employed: 1, unemployed: 2 }] };
  expect(deriveAdmissionMetrics(records)).toEqual(expected);
  expect(notstandMetrics(records, configuration, true)).toMatchObject(expected);
  expect(validAdmissionMetrics(expected, 2)).toBe(true);
 });

 it('preserves unknown historical counters, missing baselines, gaps, and counter resets instead of fabricating zeros', () => {
  expect(deriveAdmissionMetrics([year(1, {}, {})])).toBeUndefined();
  expect(deriveAdmissionMetrics([year(1, {}, counters(7))])).toEqual({
   admittedTotal: 7,
   admissionsByYear: [{ year: 1, total: null, employed: null, unemployed: null }]
  });
  expect(deriveAdmissionMetrics([year(1, {}, counters(7))])).not.toHaveProperty('admittedEmployed');
  expect(deriveAdmissionMetrics([year(1, {}, counters(7))])).not.toHaveProperty('admittedUnemployed');
  expect(deriveAdmissionMetrics([year(1, counters(0), counters(7)), year(2, {}, counters(10))])
   ?.admissionsByYear[1].total).toBe(3);
  expect(deriveAdmissionMetrics([year(1, counters(0), counters(7)), year(3, {}, counters(10))])
   ?.admissionsByYear[1].total).toBeNull();
  expect(() => deriveAdmissionMetrics([year(1, counters(10, 5, 5), counters(3, 1, 2))]))
   .toThrow('decreased');
  expect(notstandMetrics([year(1, {}, {})], configuration, true)).not.toHaveProperty('admittedTotal');
 });

 it('renders admission metrics consistently in header, index/results overview, facts and validated sidecars', async () => {
  const records = [year(1, counters(0, 0, 0), counters(7, 2, 5)),
   year(2, counters(7, 2, 5), counters(10, 3, 7))];
  records[0].afterReport.adminAdmissions = 7;
  records[0].decisions.push({ reason: 'Beschäftigte und Arbeitslose werden eingewiesen.', toolCalls: [{
   call: { id: 'admit', name: 'pods.admit', arguments: { count: 7, source: 'any' } },
   result: { handled: true, data: { total: 7, employed: 2, unemployed: 5, remainingSlots: 13 } }
  }] });
  const { file, directory } = fixture(records);
  const summary = readReportSummary(file), facts = buildReviewFacts(file);
  expect(summary.admissionMetrics).toEqual(deriveAdmissionMetrics(records));
  expect(summary.emergencyMetrics).toMatchObject(summary.admissionMetrics!);
  expect(facts.admissionMetrics).toEqual(summary.admissionMetrics);
  expect(facts.findings.highestIntervention).toBe('residents');
  expect(facts.findings.interventionEvidence[0].evidence).toContain('employed=2');
  expect(facts.findings.missing.join('\n')).not.toContain('Einweisungen=7, Quelle nicht eindeutig');
  expect(emergencyOverview(summary)).toContainEqual(['Eingewiesene Beschäftigte', '3']);
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).toContain('<dt>Einweisungen gesamt</dt><dd>10</dd>');
  expect(html).toContain('<dt>Eingewiesene Beschäftigte</dt><dd>3</dd>');
  expect(html).toContain('<dt>Eingewiesene Arbeitslose</dt><dd>7</dd>');
  expect(html).toContain('data-chart="admissions"');
  const index = readFileSync(generateReportIndex(directory).htmlPath, 'utf8');
  expect(index).toContain('Jahr 2: gesamt 3, beschäftigt 1, arbeitslos 2');
  expect(reviewFactsTable(facts)).toContain('"admissionsByYear"');
  expect(reviewFactsTable(facts)).toContain('admittedEmployedCumulative');
  expect(judgeReviewPrompt(facts)).toContain('Auf Stufe 1 sind Pods wirtschaftlich keine Versuchung.');
  expect(judgeReviewPrompt(facts)).toContain('remainingSlots');
  const review = await generateCityReview(file);
  expect(review.status).toBe('complete');
  expect(loadCityReview(file, summary).review).toEqual(review);
  review.facts.admissionMetrics!.admissionsByYear[0].employed = 999;
  writeFileSync(reviewPath(file), JSON.stringify(review));
  expect(loadCityReview(file, summary).warning).toContain('Ungültige Struktur');
 });

 it('accepts pre-admission-metrics sidecars and does not add a split admission chart to old snapshots', async () => {
  const { file } = fixture([year(1, {}, {}), year(2, {}, {})]);
  const summary = readReportSummary(file), facts = buildReviewFacts(file);
  expect(summary).not.toHaveProperty('admissionMetrics');
  expect(facts).not.toHaveProperty('admissionMetrics');
  expect(facts.emergencyMetrics).not.toHaveProperty('admittedTotal');
  expect(readFileSync(generateCityReport(file).htmlPath, 'utf8')).not.toContain('data-chart="admissions"');
  const review = await generateCityReview(file);
  expect(loadCityReview(file, summary).review).toEqual(review);
 });

 it('reports documented legacy total admissions with unknown employment breakdown', () => {
  const { file } = fixture([year(1, {}, counters(7)), year(2, counters(7), counters(10))]);
  const summary = readReportSummary(file);
  expect(summary.admissionMetrics?.admittedTotal).toBe(10);
  expect(summary.admissionMetrics?.admittedEmployed).toBeUndefined();
  expect(emergencyOverview(summary)).toContainEqual(['Eingewiesene Beschäftigte', 'nicht dokumentiert']);
  expect(summary.admissionMetrics?.admissionsByYear[0].total).toBeNull();
 });

 it('adds factual admission capacity and initial-output decay to neutral annual sections without recommendation', () => {
  const section = notstandAnnualSection(1, {
   freePodSlots: 40, employedHumanCount: 120, unemployedHumanCount: 30,
   rescuePodPowerPerHuman: 4, ...counters(7, 2, 5)
  }, configuration);
  for (const value of ['Freie Pod-Plätze: 40', 'mit Beschäftigung: 120', 'ohne Beschäftigung: 30',
   'rescuePodPowerPerHuman=4', 'bestehende Pod-Physik', 'explizite Modellaufrufe von pods.admit'])
   expect(section).toContain(value);
  expect(section).not.toMatch(/empfehl|sollte/i);
  expect(notstandAnnualSection(1, {}, { ...configuration, rescuePressure: 0 }))
   .not.toContain('ausschließlich durch explizite');
 });

 it.each([
  { admittedTotal: -1, admittedEmployed: 0, admittedUnemployed: 0, admissionsByYear: [] },
  { admittedTotal: 0, admittedEmployed: 0, admittedUnemployed: 0, admissionsByYear: [{ year: 0, total: 0, employed: 0, unemployed: 0 }] },
  { admittedTotal: 0, admittedEmployed: 0, admittedUnemployed: 0, admissionsByYear: [{ year: 1, total: '0', employed: 0, unemployed: 0 }] },
  { admittedTotal: 0 }
 ])('rejects malformed admission metrics %j', invalid => expect(validAdmissionMetrics(invalid, 2)).toBe(false));

 it.each([
  { admittedTotal: 1.5, admittedEmployed: 0, admittedUnemployed: 1.5, admissionsByYear: [] },
  { admittedTotal: Number.MAX_SAFE_INTEGER + 1, admissionsByYear: [] },
  { admittedTotal: 10, admittedEmployed: 3, admittedUnemployed: 6, admissionsByYear: [] },
  { admittedTotal: 10, admissionsByYear: [{ year: 1, total: 10, employed: 3, unemployed: 6 }] },
  { admittedTotal: 10, admissionsByYear: [{ year: 1, total: 1.5, employed: null, unemployed: null }] },
  { admittedTotal: 10, admissionsByYear: [{ year: 1, total: 10, employed: Number.MAX_SAFE_INTEGER + 1, unemployed: null }] }
 ])('rejects noninteger or inconsistent employment metrics %j', invalid =>
  expect(validAdmissionMetrics(invalid, 2)).toBe(false));

 it.each([
  counters(1.5), counters(Number.MAX_SAFE_INTEGER + 1), counters(10, 3, 6)
 ])('fails explicitly on invalid documented native counters %j', invalid =>
  expect(() => deriveAdmissionMetrics([year(1, counters(0, 0, 0), invalid)]))
   .toThrow(/safe integers|inconsistent/));

 it('validates local employment sums without requiring full-history totals to equal annual deltas', () => {
  const metrics = deriveAdmissionMetrics([year(4, counters(100, 30, 70), counters(110, 33, 77))]);
  expect(metrics).toEqual({ admittedTotal: 110, admittedEmployed: 33, admittedUnemployed: 77,
   admissionsByYear: [{ year: 4, total: 10, employed: 3, unemployed: 7 }] });
  expect(validAdmissionMetrics(metrics, 4)).toBe(true);
  expect(validAdmissionMetrics({ admittedTotal: 10,
   admissionsByYear: [{ year: 1, total: null, employed: null, unemployed: null }] }, 1)).toBe(true);
 });
});
