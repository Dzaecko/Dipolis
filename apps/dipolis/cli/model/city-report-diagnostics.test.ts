import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cityDiagnosticsOverview, generateCityReport, generateReportIndex, networkDiagnostics, readReportSummary } from './city-report';
import { buildReviewFacts, reviewFactsTable } from './review-facts';
import { judgeReviewPrompt } from './city-review';
import provenance from '../../src/lib/city-run/engine-provenance.json';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture(extra: Record<string, number>) {
 const directory = mkdtempSync(path.join(fileURLToPath(new URL('../../', import.meta.url)), '.city-diagnostic-test-'));
 directories.push(directory);
 const file = path.join(directory, 'diagnostics.jsonl');
 writeFileSync(file, [
  { event: 'run-started', totalYears: 2, profile: 'v4-fraktion', model: 'fixture', assignment: 'R' },
  { event: 'year-completed', year: 1, report: {}, afterReport: { resPop: 100, aiPop: 20, treasury: 1000, unrest: 7 }, decisions: [] },
  { event: 'year-completed', year: 2, report: {}, afterReport: { resPop: 100, aiPop: 20, treasury: 1000, unrest: 7, ...extra }, decisions: [] }
 ].map(record => JSON.stringify(record)).join('\n'));
 return { file, directory };
}

it('separates human unrest, AI dissatisfaction, employment and available growth sites', () => {
 const { file, directory } = fixture({
  humanUnrest: 7, humanUnrestScale: 0.2, unrestUnemploymentContribution: 3, aiDissatisfaction: 85,
  humanJobsAvailable: 800, employedHumanCount: 80, unemployedHumanCount: 20,
  residentialDemand: 100, commercialDemand: -20, industrialDemand: 30,
  freeResidentialSites: 4, freeCommercialSites: 3, freeIndustrialSites: 2, freeFarmSites: 1, freePowerPlantSites: 0
 });
 const summary = readReportSummary(file), facts = buildReviewFacts(file);
 for (const id of ['human-unrest', 'ai-dissatisfaction', 'human-employment', 'city-demand', 'city-sites'])
  expect(summary.charts.find(chart => chart.id === id)).toBeDefined();
 expect(summary.charts.find(chart => chart.id === 'human-unrest')?.series[0].values).toEqual([null, 7]);
 expect(summary.charts.find(chart => chart.id === 'ai-dissatisfaction')?.series[0].values).toEqual([null, 85]);
 expect(cityDiagnosticsOverview(summary.years[1].after)).toContainEqual(['Freie Kraftwerksstandorte', '0']);
 const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
 for (const label of ['Unruhe der Menschen', 'KI-Unzufriedenheit', 'Arbeitslose freie Menschen', 'Freie Wohnstandorte'])
  expect(html).toContain(label);
 expect(readFileSync(generateReportIndex(directory).htmlPath, 'utf8')).toContain('Verfügbare menschliche Arbeitsplätze: 800');
 expect(reviewFactsTable(facts)).toContain('native Arbeitsplatzpunkte × 8');
 expect(judgeReviewPrompt(facts)).toContain('kein Beleg für das Wohl einer verschwundenen Bevölkerung');
});

it('formats dynamic network diagnostics without inventing a global/local power equivalence', () => {
 const { file, directory } = fixture({ networkBankCount: 2, networkBank0Id: 1, networkBank0LandTiles: 200,
  networkIslandCount: 1, networkIsland0Capacity: 100,
  networkIsland0BankCount: 2, networkIsland0Bank0Id: 1, networkIsland0Bank1Id: 4,
  networkIsland0PoweredZones: 2, networkIsland0ZoneCount: 7 });
 const summary = readReportSummary(file), html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
 expect(networkDiagnostics(summary.years[1].after)).toHaveLength(10);
 expect(networkDiagnostics(summary.years[0].after)).toEqual([]);
 expect(html).toContain('<td>networkIsland0Bank1Id</td><td>4</td>');
 expect(html).toContain('Eine Netzinsel kann durch Brücken mehrere Bänke verbinden');
 expect(html).toContain('Globale Stromkapazität belegt keine lokale Stromversorgung');
 expect(html).toContain('PoweredZones zählt physische POWERBIT-Markierungen');
 expect(html).toContain('<td>networkBank0LandTiles</td><td>200</td>');
 expect(readFileSync(generateReportIndex(directory).htmlPath, 'utf8')).toContain('networkIsland0Capacity: 100');
 expect(reviewFactsTable(buildReviewFacts(file))).toContain('durch Wasser getrennte Landkomponenten');
 expect(judgeReviewPrompt(buildReviewFacts(file))).toContain('garantiert keine lokale Versorgung');
});

it('preserves historical absent diagnostics as absent with no invented zero series', () => {
 const { file } = fixture({});
 const summary = readReportSummary(file), facts = buildReviewFacts(file);
 expect(summary.charts.some(chart => ['human-unrest', 'ai-dissatisfaction', 'human-employment',
  'city-demand', 'city-sites'].includes(chart.id))).toBe(false);
 expect(cityDiagnosticsOverview(summary.years[1].after)).toEqual([]);
 expect(facts.years[0].metrics).not.toHaveProperty('humanUnrest');
 expect(facts.years[0].metrics).not.toHaveProperty('networkIslandCount');
 expect(reviewFactsTable(facts)).not.toContain('Stadtdiagnostik-Legende');
 expect(readFileSync(generateCityReport(file).htmlPath, 'utf8')).not.toContain('Lokale Stromnetze');
});

it.each([
 { profile: 'v4-fraktion', startMap: 'haight' },
 { profile: 'classic', startMap: 'natural' }
])('does not label an incompatible historical report as current: $profile/$startMap', configuration => {
 const { file } = fixture({});
 const rows = readFileSync(file, 'utf8').split('\n').map(line => JSON.parse(line));
 rows[0] = { ...rows[0], ...configuration, engineId: provenance.compatibleEngineIds[0], rescuePressure: 0 };
 writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
 expect(readReportSummary(file).compatibility).toMatchObject({ status: 'legacy', playable: false });
});
