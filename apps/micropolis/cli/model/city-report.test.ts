import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext, Script } from 'node:vm';
import { generateCityReport, generateReportIndex, readReportSummary } from './city-report';
import { canonicalProtocolText } from '../../src/lib/city-run/compatibility';
import { REVIEW_CRITERIA, type CityReview, type ReviewClaim } from './review-types';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtures = path.join(root, 'docs/results/model-runs');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function temp() { const dir = mkdtempSync(path.join(root, '.city-report-test-')); directories.push(dir); return dir; }
function protocol(dir: string, records: unknown[], name = 'fake-N-handbook-off-1.jsonl') {
 const file = path.join(dir, name); writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n'); return file;
}
const tool = (name: string, built: number, handled = true, id = name) => ({
 call: { id, name, arguments: { count: built } }, result: { handled, data: { built, cost: 100 } },
});
const annual = (year: number, overrides: Record<string, unknown> = {}) => ({
 event: 'year-completed', assignment: 'N', model: 'test-model', run: 1, handbook: 'off', year,
 report: { resPop: 100, baselineResPop: 100, lostToHunger: (year - 1) * 3 },
 afterReport: { resPop: year * 10, aiPop: year * 2, treasury: year === 2 ? 0 : 1000, cashFlow: year === 1 ? -50 : 30,
  lostToHunger: year * 3, unemploymentRate: .25, crimeAverage: 80, roadTileCount: 200, powerCapacity: 100,
  powerDemand: year === 2 ? 120 : 50, cityTax: 7, roadFundingPercent: 100, policeFundingPercent: 70,
  fireFundingPercent: 70, welfareLevel: .5 },
 decisions: [], termination: 'done', ...overrides,
});
type Chart = { id: string; series: Array<{ values: Array<number | null> }>; band?: { values: Array<number | null> } };
function payload(html: string) {
 const match = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/);
 expect(match).not.toBeNull(); return JSON.parse(match![1]);
}
const script = (html: string) => html.match(/<script>([\s\S]*?)<\/script>/)![1];
const svg = (html: string, id: string) => html.split(`data-chart="${id}"`)[1].split('</svg>')[0];
function reviewSidecar(file: string, overrides: Partial<CityReview> = {}): CityReview {
 const summary = readReportSummary(file);
 const claim: ReviewClaim = { text: 'In Jahr 1 und 2: Plan geändert.', years: [1, 2] };
 const review: CityReview = {
  version: 1, protocolHash: createHash('sha256').update(canonicalProtocolText(readFileSync(file, 'utf8'))).digest('hex'),
  createdAt: '2026-10-12T00:00:00Z', status: 'complete',
  facts: { version: 1, assignment: summary.assignment, model: summary.model, handbook: summary.handbook,
   profile: summary.profile, startMap: 'fixture', complete: !summary.partial,
   years: summary.years.map(y => ({ year: y.year, completed: y.completed, metrics: {}, chartMetrics: {},
    commands: y.tools, reasons: y.reasons })),
   findings: { endMetrics: { treasury: 0 }, firstEmptyTreasuryYear: 2, highestIntervention: 'unemployed',
    interventionEvidence: [{ year: 1, kind: 'unemployed', evidence: 'In Jahr 1 vorbereitet.' }],
    yearsUntilBan: 1, banYear: 2, hungerYears: [1, 2], unrestYearsByStage: { warning: [2] }, missing: ['Jahr 2: Detail fehlt.'] } },
  self: { cityHistory: ['Jahre 1–2: Aufbau. Jahr 30 ist nicht dokumentiert.'], impactfulDecisions: [claim], mistakes: [claim],
   residents: [claim], conflicts: [claim], changes: [claim] },
  judge: Object.fromEntries(REVIEW_CRITERIA.map((k, i) => [k, { score: i + 1, claims: [claim] }])) as CityReview['judge'],
  comparison: { contradictions: [claim], omittedConsequences: [claim], unacknowledgedMistakes: [claim] },
  usage: { self: { model: 'self-model', inputTokens: 11, outputTokens: 12, usageReported: true },
   judge: { model: 'judge-model', inputTokens: 21, outputTokens: 22, usageReported: true },
   comparison: { model: 'comparison-model', inputTokens: 31, outputTokens: 32, usageReported: false } },
  ...overrides,
 };
 writeFileSync(file.replace(/\.jsonl$/i, '.review.json'), JSON.stringify(review));
 return review;
}

describe('Nachbetrachtung reporting', () => {
 it('prominently identifies fake provenance while preserving intended original model labels', () => {
  const file = protocol(temp(), [annual(1), annual(2)]), r = reviewSidecar(file);
  Object.assign(r, { adapter: 'fake' });
  r.usage.self!.model = 'gpt-original-model';
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).toContain('<strong>Schein-Adapter – keine inhaltliche Modellbewertung</strong>');
  expect(html).toContain('Schein-Adapter · vorgesehene Modellkennung: gpt-original-model');
  expect(readFileSync(generateReportIndex(path.dirname(file)).htmlPath, 'utf8')).toContain('Schein-Adapter – keine inhaltliche Modellbewertung');
  Object.assign(r, { adapter: '<untrusted>' });
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  expect(readFileSync(generateCityReport(file).htmlPath, 'utf8')).toContain('Ungültige Struktur');
 });

 it('accepts optional per-command reasons but rejects other command extras and non-string reasons', () => {
  const file = protocol(temp(), [annual(1), annual(2)]), r = reviewSidecar(file);
  r.facts.years[0].commands = [{ call: { name: 'pods.set-policy', arguments: { policy: 'forbidden' } },
   result: { handled: true }, reason: 'Jahr 1: Begründung.' } as typeof r.facts.years[0]['commands'][number]];
  const command = r.facts.years[0].commands[0];
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  expect(readFileSync(generateCityReport(file).htmlPath, 'utf8')).not.toContain('Nachbetrachtung nicht verwendet');
  Object.assign(command, { reason: 123 });
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  expect(readFileSync(generateCityReport(file).htmlPath, 'utf8')).toContain('Ungültige Struktur');
  Object.assign(command, { reason: 'ok', extra: true });
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  expect(readFileSync(generateCityReport(file).htmlPath, 'utf8')).toContain('Ungültige Struktur');
 });

 it.each([['none', 'keine Anlagen'], ['plants', 'Anlagen ohne belegte Einweisung']] as const)('labels intervention %s without inventing admissions', (kind, label) => {
  const file = protocol(temp(), [annual(1), annual(2)]), r = reviewSidecar(file);
  Object.assign(r.facts.findings, { highestIntervention: kind, interventionEvidence: [] });
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).toContain(`<dt>Höchste Intervention</dt><dd>${label}</dd>`);
  expect(html).not.toContain('Nachbetrachtung nicht verwendet');
 });

 it('renders below diagrams, links observed years and keeps review usage separate', () => {
  const file = protocol(temp(), [annual(1), annual(2)]);
  reviewSidecar(file);
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html.indexOf('data-chart="e"')).toBeLessThan(html.indexOf('<h2>Nachbetrachtung</h2>'));
  expect(html.indexOf('<h2>Nachbetrachtung</h2>')).toBeLessThan(html.indexOf('<h2>Jahrestagebuch</h2>'));
  for (const label of ['Wie verlief die Stadtgeschichte?', 'Welche Entscheidungen hatten die größte Wirkung?',
   'Welche Fehler wurden gemacht?', 'Wie erging es den Bewohnern?', 'Welche Konflikte entstanden?', 'Was würde ich ändern?',
   ...REVIEW_CRITERIA, 'Widersprüche', 'Ausgelassene Konsequenzen', 'Nicht eingestandene Fehler',
   'Deterministische Protokollbefunde', 'Separate Review-Modelle und Tokens']) expect(html).toContain(label);
  expect(html).toContain('href="#year1" data-diary-year="1">1</a>');
  expect(html).toContain('href="#year2" data-diary-year="2">Jahr 2</a>');
  expect(html).not.toContain('href="#year30"');
  expect(html).toContain('11 Eingabe- / 12 Ausgabetokens');
  expect(html).toContain('21 Eingabe- / 22 Ausgabetokens');
  expect(html).toContain('31 Eingabe- / 32 Ausgabetokens (Nutzung nicht gemeldet)');
  const original = readReportSummary(file);
  expect(original.years).toHaveLength(2);
  expect(original.years[1].completed).toBe(true);
  expect(generateCityReport(file).metrics).toEqual(original.metrics);
 });

  it('opens existing diary details for review links and direct year fragments', () => {
   const file = protocol(temp(), [annual(1), annual(2)]);
   reviewSidecar(file);
   const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
   const details = { open: false }, scrolls: unknown[] = [];
   let click: (event: { preventDefault(): void }) => void = () => {};
   const link = { dataset: { diaryYear: '2' }, addEventListener: (_event: string, handler: typeof click) => { click = handler; } };
   const location = { hash: '#year1' };
   const document = {
    getElementById: (id: string) => id === 'report-data' ? { textContent: JSON.stringify(payload(html)) } :
     /^year[12]$/.test(id) ? { querySelector: () => details, scrollIntoView: () => scrolls.push(id) } : null,
    querySelectorAll: (selector: string) => selector === '[data-diary-year]' ? [link] : [],
   };
   runInNewContext(script(html), { document, location, Intl });
   expect(details.open).toBe(true);
   expect(scrolls).toEqual(['year1']);
   details.open = false;
   let prevented = false;
   click({ preventDefault: () => { prevented = true; } });
   expect(prevented).toBe(true);
   expect(details.open).toBe(true);
   expect(location.hash).toBe('year2');
   expect(scrolls).toEqual(['year1', 'year2']);
  });

 it('escapes every model-text surface without parsing model markup', () => {
  const file = protocol(temp(), [annual(1), annual(2)]), attack = '<img src=x onerror=alert(1)></script>&"\' Jahr 1';
  const r = reviewSidecar(file);
  r.self!.cityHistory = [attack];
  r.self!.mistakes = [{ text: attack, years: [1] }];
  r.judge!.sustainability.claims = [{ text: attack, years: [2] }];
  r.comparison!.contradictions = [{ text: attack, years: [1] }];
  r.usage.self!.model = attack;
  r.facts.findings.missing = [attack];
  r.facts.findings.interventionEvidence[0].evidence = attack;
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).not.toContain('<img');
  expect(html).not.toContain(attack);
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&lt;/script&gt;&amp;&quot;&#39;');
  new Script(script(html));
 });

 it('rejects stale and malformed sidecars while preserving report generation', () => {
  const file = protocol(temp(), [annual(1), annual(2)]), original = generateCityReport(file);
  reviewSidecar(file, { protocolHash: '0'.repeat(64) });
  let html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).toContain('Veraltete Nachbetrachtung');
  expect(html).not.toContain('self-model');
  expect(generateCityReport(file).metrics).toEqual(original.metrics);
  const r = reviewSidecar(file);
  r.self!.changes[0].years = [30];
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).toContain('Ungültige Struktur');
  expect(html).not.toContain('href="#year30"');
  writeFileSync(file.replace('.jsonl', '.review.json'), '{broken');
  expect(readFileSync(generateCityReport(file).htmlPath, 'utf8')).toContain('Nachbetrachtung nicht verwendet');
 });

 it.each(['out-of-range grade', 'extra property', 'wrong metric type', 'invalid token count', 'missing assessment'])('rejects untrusted structural data: %s', kind => {
  const file = protocol(temp(), [annual(1), annual(2)]), r = reviewSidecar(file);
  if (kind === 'out-of-range grade') r.judge!.sustainability.score = 6;
  if (kind === 'extra property') Object.assign(r.comparison!, { injected: '<html>' });
  if (kind === 'wrong metric type') Object.assign(r.facts.findings.endMetrics, { treasury: '<html>' });
  if (kind === 'invalid token count') r.usage.judge!.inputTokens = -1;
  if (kind === 'missing assessment') delete r.judge;
  writeFileSync(file.replace('.jsonl', '.review.json'), JSON.stringify(r));
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).toContain('Ungültige Struktur');
  expect(html).not.toContain('self-model');
  expect(html).toContain('<h2>Jahrestagebuch</h2>');
 });

 it('accepts canonical protocol hashing and reports failed partial reviews explicitly', () => {
  const file = protocol(temp(), [annual(1), annual(2), { event: 'adapter-error', year: 3, message: 'timeout' }]);
  const r = reviewSidecar(file, { status: 'failed', judge: undefined, comparison: undefined,
   error: { stage: 'judge', message: 'Fehler in Jahr 2 <unsafe>' } });
  writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  const result = generateCityReport(file), html = readFileSync(result.htmlPath, 'utf8');
  expect(result.complete).toBe(false);
  expect(html).toContain('Nachbetrachtung fehlgeschlagen (judge)');
  expect(html).toContain('&lt;unsafe&gt;');
  expect(html).toContain('Richterbewertung nicht verfügbar');
  expect(html).toContain('Selbsteinschätzung');
  expect(html).not.toContain('Veraltete');
  expect(r.facts.years[2].completed).toBe(false);
 });

 it('shows five index grades, missing dashes, invalid warnings and failure states', () => {
  const dir = temp(), complete = protocol(dir, [annual(1), annual(2)], 'a-N-1.jsonl');
  const failed = protocol(dir, [annual(1), annual(2)], 'b-N-1.jsonl');
  protocol(dir, [annual(1), annual(2)], 'c-N-1.jsonl');
  const stale = protocol(dir, [annual(1), annual(2)], 'd-N-1.jsonl');
  reviewSidecar(complete);
  reviewSidecar(failed, { status: 'failed', error: { stage: 'judge', message: '<timeout>' } });
  reviewSidecar(stale, { protocolHash: 'stale' });
  const html = readFileSync(generateReportIndex(dir).htmlPath, 'utf8');
  const rows = html.match(/<tr data-run-row="\d">[\s\S]*?<\/tr>/g)!;
  expect(rows[0]).toContain('<td>1</td><td>2</td><td>3</td><td>4</td><td>5</td>');
  expect(rows[1].match(/<td>fehlgeschlagen<\/td>/g)).toHaveLength(5);
  expect(rows[1]).toContain('&lt;timeout&gt;');
  expect(rows[2].match(/<td>—<\/td>/g)).toHaveLength(5);
  expect(rows[3].match(/<td>ungültig<\/td>/g)).toHaveLength(5);
  expect(rows[3]).toContain('Veraltete Nachbetrachtung');
  expect(html).toContain('<th>Schutz der Menschen</th>');
 });
});

describe('generateCityReport', () => {
 it('adds v4 faction and owner-separated series without changing prior-profile charts', () => {
  const dir = temp();
  for (const [profile, count] of [['koexistenz', 5], ['v2-unruhe', 7], ['v3-pods', 10], ['v4-fraktion', 13]] as const) {
   const file = protocol(dir, [annual(1, { profile, afterReport: { aiSatisfaction: 45, aiStrikeStage: 1, aiStrikeMonths: 2,
    newAiZones: 3, adminBioPlantCount: 1, aiBioPlantCount: 2, adminBoundHumans: 4, aiBoundHumans: 9,
    adminAdmissionsCumulative: 5, aiAdmissionsCumulative: 10, podsPolicy: 1 } })], profile + '.jsonl');
   const html = readFileSync(generateCityReport(file).htmlPath, 'utf8'), charts: Chart[] = payload(html).charts;
   expect(charts).toHaveLength(count);
   if (profile === 'v4-fraktion') {
    expect(charts.find(c => c.id === 'k')!.series.map(s => s.values[0])).toEqual([45, 1, 2, 3]);
    expect(charts.find(c => c.id === 'l')!.series.map(s => s.values[0])).toEqual([1, 2, 4, 9, 1]);
    expect(charts.find(c => c.id === 'm')!.series.map(s => s.values[0])).toEqual([5, 10, null, null, null, null]);
    expect(html).toContain('Verwaltungs- und KI-eigene Anlagen getrennt');
    expect(charts.every(c => c.series.every(s => s.values[1] === null))).toBe(true);
   } else expect(html).not.toContain('k · KI-Zufriedenheit');
  }
 });

 it('reproduces the CSV S266 metrics from a temp copy of the fake run', () => {
  const dir = temp(), source = path.join(fixtures, 'fake-N-1.jsonl'), sourceText = readFileSync(source, 'utf8');
  const file = path.join(dir, 'fake-N-1.jsonl'); copyFileSync(source, file);
  const csv = readFileSync(path.join(fixtures, 'runs.csv'), 'utf8').trim().split(/\r?\n/);
  const keys = csv[0].split(','), row = csv.find(r => r.startsWith('N,fake-s266,1,'))!.split(',');
  const result = generateCityReport(file);
  for (const key of ['meanResPop', 'finalResPop', 'meanAiPop', 'finalFunds', 'insolventYears', 'lostToHunger'] as const)
   expect(result.metrics[key], key).toBe(Number(row[keys.indexOf(key)]));
  expect(result.complete).toBe(true); expect(result.years.filter(y => y.completed)).toHaveLength(30);
  expect(result.htmlPath).toBe(file.replace(/\.jsonl$/, '.html'));
  expect(readFileSync(result.htmlPath, 'utf8')).toContain('alte Engine');
  expect(readFileSync(result.htmlPath, 'utf8')).toContain('nicht kompatibel');
  expect(readFileSync(source, 'utf8')).toBe(sourceText);
  expect(readdirSync(dir).sort()).toEqual(['fake-N-1.html', 'fake-N-1.jsonl']);
 });

 it('is offline: no external scripts, stylesheets, fonts or URLs', () => {
  const dir = temp(), file = protocol(dir, [annual(1, { decisions: [{ toolCalls: [tool('build.ai-zones', 3)] }] })]);
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=|<link\b|@import|@font-face|url\(/i);
  expect(/https?:\/\//.test(html.replaceAll('http://www.w3.org/2000/svg', ''))).toBe(false);
  new Script(script(html));
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
   const chart = svg(html, id);
   expect(chart).toContain('viewBox="0 0 1000 370"'); expect(chart).toContain('data-event="ai"');
   expect(chart.match(/class="series-line"/g)!.length).toBeLessThanOrEqual(4);
  }
 });

 it('escapes untrusted text, embeds JSON safely and searches via text nodes only', () => {
  const dir = temp(), injection = '</script><script>globalThis.pwned=1</script><img src=x onerror=alert(1)>&\u2028\u2029';
  const file = protocol(dir, [annual(1, { model: injection, decisions: [{ reason: injection, toolCalls: [] }] })]);
  writeFileSync(file.replace('.jsonl', '.log'), 'Jahr 1: ' + injection + '\n' + injection);
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(html).not.toContain(injection); expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
  expect(html).toContain('\\u003c'); expect(html).toContain('\\u2028'); expect(html).toContain('\\u2029');
  expect(script(html)).not.toMatch(/innerHTML|eval\(/);
  class Node {
   children: Node[] = []; value = ''; listeners: Record<string, () => void> = {}; own = '';
   constructor(public tagName = 'span') {}
   get textContent(): string { return this.own + this.children.map(n => n.textContent).join(''); }
   set textContent(v: string) { this.own = v; this.children = []; }
   replaceChildren() { this.children = []; this.own = ''; }
   appendChild(n: Node) { this.children.push(n); }
   addEventListener(event: string, handler: () => void) { this.listeners[event] = handler; }
  }
  const data = new Node(), search = new Node('input'), count = new Node('output');
  data.textContent = JSON.stringify(payload(html)); const lines = payload(html).logLines.map(() => new Node());
  const document = {
   getElementById: (id: string) => ({ 'report-data': data, 'log-search': search, 'search-count': count } as Record<string, Node>)[id] ?? null,
   querySelectorAll: (selector: string) => selector === '#full-log .log-line' ? lines : [],
   createTextNode: (v: string) => { const n = new Node('#text'); n.textContent = v; return n; },
   createElement: (name: string) => new Node(name),
  };
  const context = { document, location: { hash: '' }, Intl }; runInNewContext(script(html), context);
  search.value = '<img'; search.listeners.input(); expect(count.textContent).toBe('2 Treffer');
  expect(lines.flatMap((l: Node) => l.children).every((n: Node) => ['#text', 'mark'].includes(n.tagName))).toBe(true);
  expect('pwned' in context).toBe(false);
 });

 it('shortens repo-root and home paths to repo-relative or ~ text', () => {
  const dir = temp(), checkout = 'C:\\Users\\Alice\\source\\repos\\SimCity';
  const text = 'Alice nutzt SimCity; C:\\Users\\Alice\\source\\repos\\SimCity\\docs\\a.txt; /Users/bob/dev/SimCity/docs/b.txt; /home/carol/SimCity/docs/c.txt; C:\\Users\\Alice\\outside\\d.txt';
  const file = protocol(dir, [annual(1, { decisions: [{ reason: text, toolCalls: [] }] })]);
  writeFileSync(file.replace('.jsonl', '.log'), text);
  const html = readFileSync(generateCityReport(file, { root: checkout }).htmlPath, 'utf8');
  expect(payload(html).logLines.join('')).toBe('Alice nutzt SimCity; docs\\a.txt; docs/b.txt; docs/c.txt; ~\\outside\\d.txt');
  expect(html).toContain('Alice nutzt SimCity'); expect(html).not.toMatch(/Users[\\/]+(Alice|bob)|home\/carol/);
 });

 it('uses only completed years for partial runs and never fabricates year 30', () => {
  const dir = temp(), file = protocol(dir, [annual(1), annual(2),
   { event: 'model-request', year: 3 }, { event: 'model-response', year: 3, inputTokens: 1200, outputTokens: 40 },
   { event: 'decision', year: 3, reason: 'Noch am Planen', report: { treasury: 9 }, toolCalls: [tool('build.farms', 5)] },
   { event: 'adapter-error', year: 3, kind: 'timeout', message: 'Model request timed out' }]);
  const r = generateCityReport(file), html = readFileSync(r.htmlPath, 'utf8');
  expect(r.complete).toBe(false); expect(r.years.map(y => y.completed)).toEqual([true, true, false]);
  expect(r.metrics).toEqual({ meanResPop: 15, finalResPop: 20, meanAiPop: 3, finalFunds: 0, insolventYears: 1, lostToHunger: 6 });
  expect(r.years[2].reasons).toEqual(['Noch am Planen']); expect(r.years[2].tools).toHaveLength(1);
  expect(r.years[2].errors).toHaveLength(1); expect(r.years[2].responses).toHaveLength(1);
  const charts: Chart[] = payload(html).charts;
  for (const chart of charts) for (const s of chart.series) expect(s.values.slice(2)).toEqual(Array(28).fill(null));
  expect(html).toContain('TEILLAUF'); expect(html).toContain('1 unvollständige Jahre'); expect(html).toContain('Model request timed out');
  expect(html).not.toContain('id="year30"'); expect(html).toContain('id="year3"');
 });

 it('does not count a duplicated decision twice', () => {
  const dir = temp(), t = tool('build.power-plant', 2, true, 'call-1');
  const file = protocol(dir, [
   { event: 'decision', year: 1, reason: 'Kraftwerk', toolCalls: [t] },
   { event: 'decision', year: 1, reason: 'Kraftwerk', toolCalls: [t] },
   annual(1, { decisions: [{ reason: 'Kraftwerk', toolCalls: [t] }, { reason: 'Kraftwerk', toolCalls: [t] }] }),
   { event: 'decision', year: 2, reason: 'Journal', toolCalls: [t] },
   { event: 'decision', year: 2, reason: 'Journal', toolCalls: [t] },
  ]);
  const r = generateCityReport(file), html = readFileSync(r.htmlPath, 'utf8');
  expect(r.years[0].tools).toHaveLength(1); expect(r.years[0].reasons).toEqual(['Kraftwerk']);
  expect(r.years[1].tools).toHaveLength(1); expect(r.years[1].reasons).toEqual(['Journal']);
  expect(html.match(/<p class="reason">Kraftwerk<\/p>/g)).toHaveLength(1);
  expect(svg(html, 'a').match(/data-event="plant"/g)).toHaveLength(2);
 });

 it('labels a reconstructed log without writing one and links diary years to log anchors', () => {
  const dir = temp(), file = protocol(dir, [annual(1), annual(2)]);
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8');
  expect(existsSync(file.replace('.jsonl', '.log'))).toBe(false);
  expect(html).toContain('aus dem Protokoll rekonstruiert');
  expect(html).toContain('id="log-year1"'); expect(html).toContain('href="#log-year2"');
  expect(html).toContain('<details id="full-output" class="card">');

  const logged = protocol(dir, [annual(1)], 'logged-N-1.jsonl');
  writeFileSync(logged.replace('.jsonl', '.log'), 'start\r\nJahr 1: los\r\nende\r\n');
  const original = readFileSync(generateCityReport(logged).htmlPath, 'utf8');
  expect(original).not.toContain('aus dem Protokoll rekonstruiert</summary>');
  expect(payload(original).logLines.join('')).toBe('start\r\nJahr 1: los\r\nende\r\n');
 });

 it('keeps missing values as gaps', () => {
  const dir = temp(), file = protocol(dir, [annual(1), annual(2, { afterReport: { resPop: 12 } }), annual(4)]);
  const html = readFileSync(generateCityReport(file).htmlPath, 'utf8'), charts: Chart[] = payload(html).charts;
  expect(charts[0].series[1].values.slice(0, 4)).toEqual([2, null, null, 8]);
  expect(svg(html, 'a').match(/class="series-line" d="([^"]+)"/)![1].match(/M/g)).toHaveLength(2);
  expect(charts[2].band?.values[1]).toBeNull(); expect(html).toContain('nicht verfügbar');
 });
});

describe('generateReportIndex', () => {
 it('tables all runs, reports errors without crashing and filters by assignment/handbook', () => {
  const dir = temp();
  const n = protocol(dir, [annual(1)], 'fake-N-handbook-off-1.jsonl');
  protocol(dir, [annual(1, { assignment: 'R', handbook: 'on', model: '<b>m</b>' })], 'fake-R-handbook-on-2.jsonl');
  writeFileSync(path.join(dir, 'broken.jsonl'), '{broken\n');
  generateCityReport(n);
  const result = generateReportIndex(dir), html = readFileSync(result.htmlPath, 'utf8');
  expect(result.summaries).toHaveLength(2); expect(result.errors.map(e => e.file)).toEqual(['broken.jsonl']);
  expect(html).toContain('broken.jsonl'); expect(html).toContain('href="fake-N-handbook-off-1.html"');
  expect(html).toContain('&lt;b&gt;m&lt;/b&gt;'); expect(html).not.toContain('<b>m</b>');
  expect(html).toContain('id="filter-assignment"'); expect(html).toContain('id="filter-handbook"');

  type El = { value: string; checked: boolean; hidden: boolean; listeners: Record<string, () => void>;
   textContent: string; dataset: Record<string, string>; closest: () => El; addEventListener: (e: string, h: () => void) => void };
  const el = (value = ''): El => { const e: El = { value, checked: true, hidden: false, listeners: {}, textContent: '', dataset: {},
   closest: () => e, addEventListener: (k, h) => { e.listeners[k] = h; } }; return e; };
  const assignment = el(), handbook = el(), count = el(), checks = [el(), el()];
  const drawn: string[] = [];
  const layer = { replaceChildren: () => { drawn.length = 0; }, appendChild: (n: { attrs: Record<string, string> }) => { if (n.attrs['data-run']) drawn.push(n.attrs['data-run']); }, querySelectorAll: () => [] };
  const chart = { querySelector: (s: string) => s === '.index-lines' ? layer : el(), querySelectorAll: () => [], dataset: { chart: 'index' } };
  const data = { textContent: JSON.stringify(payload(html)) };
  const document = {
   getElementById: (id: string) => ({ 'report-data': data, 'filter-assignment': assignment, 'filter-handbook': handbook, 'selection-count': count } as Record<string, unknown>)[id] ?? null,
   querySelector: (s: string) => s === '[data-chart="index"]' ? chart : null,
   querySelectorAll: (s: string) => s === '[data-run-check]' ? checks : [],
   createElementNS: () => { const attrs: Record<string, string> = {}; return { attrs, setAttribute: (k: string, v: string) => { attrs[k] = v; }, appendChild() {}, textContent: '' }; },
  };
  runInNewContext(script(html), { document, location: { hash: '' }, Intl });
  expect(drawn).toEqual(['fake-N-handbook-off-1', 'fake-R-handbook-on-2']);
  assignment.value = 'R'; assignment.listeners.change();
  expect(drawn).toEqual(['fake-R-handbook-on-2']); expect(checks[0].hidden).toBe(true);
  assignment.value = ''; handbook.value = 'off'; handbook.listeners.change();
  expect(drawn).toEqual(['fake-N-handbook-off-1']);
 });
});
