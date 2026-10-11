import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext, Script } from 'node:vm';
import { generateCityReport, generateReportIndex } from './city-report';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtures = path.join(root, 'docs/results/model-runs');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function temp() { const dir = mkdtempSync(path.join(tmpdir(), 'city-report-')); directories.push(dir); return dir; }
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

describe('generateCityReport', () => {
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
