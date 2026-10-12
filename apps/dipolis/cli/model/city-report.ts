import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProtocolRecords } from '../../src/lib/city-run/protocol';
import { createHash } from 'node:crypto';
import { canonicalProtocolText, engineCompatibility, type EngineCompatibility } from '../../src/lib/city-run/compatibility';
import { loadCityReview, renderCityReview, reviewGradeLabels } from './city-review-render';
import { REVIEW_CRITERIA } from './review-types';

/** Pure Node reporting: importing this module never loads the engine or a model. */
export interface CityReportOptions {
 /** Checkout root whose absolute paths are shown repo-relative; defaults to this repository. */
 root?: string;
}
export interface ReportMetrics {
 meanResPop: number | null; finalResPop: number | null; meanAiPop: number | null;
 finalFunds: number | null; insolventYears: number | null; lostToHunger: number | null;
}
type JsonObject = Record<string, unknown>;
export interface ReportTool { call: JsonObject; result: unknown; }
export interface ReportYear {
 year: number; completed: boolean; before: JsonObject; after: JsonObject | null;
 reasons: string[]; tools: ReportTool[]; termination: string | null;
 responses: JsonObject[]; errors: JsonObject[];
}
export interface ReportSeries {
 key: string; label: string; unit: string; color: string; dash: string;
 values: Array<number | null>; min: number; max: number; step?: boolean;
}
export interface ReportChart {
 id: string; title: string; note: string; normalized: boolean;
 series: ReportSeries[]; bars?: ReportSeries; band?: ReportSeries; shortage?: boolean[];
}
export interface ReportEvent { year: number; kind: string; label: string; lane: number; color: string; dash: string; }
export interface ReportSummary {
 id: string; model: string; assignment: string; handbook: string; run: string; profile: string;
 date: string; dateSource: 'timestamp' | 'file-mtime'; partial: boolean;
 observedYears: number; partialYears: number; years: ReportYear[]; warnings: string[];
 metrics: ReportMetrics; metricSamples: Record<string, number>; firstInsolvencyYear: number | null;
 charts: ReportChart[]; events: ReportEvent[]; logSource: 'original' | 'reconstructed';
 compatibility: EngineCompatibility;
}
export interface CityReportResult { htmlPath: string; metrics: ReportMetrics; years: ReportYear[]; complete: boolean; }
export interface ReportIndexResult { htmlPath: string; summaries: ReportSummary[]; errors: Array<{ file: string; message: string }>; }

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const YEARS = 30;
const COLORS = ['#ffbf4a', '#36e7ff', '#60f0b1', '#ff6ad5', '#b8a0ff', '#ff8566'];
const DASHES = ['', '8 4', '2 4', '10 3 2 3'];
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const fmt = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? nf.format(value) : 'nicht verfügbar';
const obj = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Inert script payloads must not allow HTML parsing to recognize a closing tag. */
const safeJson = (value: unknown) => JSON.stringify(value).replace(/[<>&\u0000-\u001f\u2028\u2029]/g,
 c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SEP = '[\\\\/]+', SEGMENT = '[^\\\\/\\s"\'`<>]+', LEAD = '(^|[\\s"\'`(=<>,;:\\[{])';
const HOME = `(?:[A-Za-z]:${SEP}Users|/Users|/home)${SEP}${SEGMENT}`;
function relativeText(value: string, options: CityReportOptions): string {
 const root = (options.root ?? ROOT).replace(/[\\/]+$/, '');
 // Separators may be doubled inside raw JSON text; a path boundary avoids rewriting prose.
 const exact = new RegExp(LEAD + root.split(/[\\/]+/).map(regexEscape).join(SEP) + SEP, 'gi');
 const repo = regexEscape(root.split(/[\\/]+/).at(-1) ?? '');
 const homeRepo = new RegExp(`${LEAD}${HOME}(?:${SEP}${SEGMENT})*?${SEP}${repo}${SEP}`, 'gi');
 const home = new RegExp(`${LEAD}${HOME}(?=[\\\\/\\s"'\`<>]|$)`, 'gim');
 return value.replace(exact, '$1').replace(homeRepo, '$1').replace(home, '$1~');
}
function displayJson(value: unknown, options: CityReportOptions) {
 return JSON.stringify(value, (_key, v) => typeof v === 'string' ? relativeText(v, options) : v, 2) ?? 'nicht verfügbar';
}
function toolsFrom(value: unknown): ReportTool[] {
 if (!Array.isArray(value)) return [];
 return value.flatMap(item => {
  const entry = obj(item), call = obj(entry.call);
  return typeof call.name === 'string' ? [{ call, result: entry.result ?? null }] : [];
 });
}
function uniqueTools(tools: ReportTool[]): ReportTool[] {
 const seen = new Set<string>();
 return tools.filter(t => {
  // IDs are scoped to a year; preserve different outcomes for conflicting duplicates.
  const key = JSON.stringify([t.call.id ?? null, t.call.name, t.call.arguments, t.result]);
  if (seen.has(key)) return false;
  seen.add(key); return true;
 });
}
const uniqueReasons = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()))];
export function readReportSummary(protocolPath: string): ReportSummary {
 const protocolText = readFileSync(protocolPath, 'utf8');
 const { records: parsedRecords, warnings } = parseProtocolRecords(protocolText);
 const records = parsedRecords as JsonObject[];
 if (!records.length) throw new Error('Keine lesbaren JSONL-Datensätze.');
 const identity = (key: string) => text(records.find(r => text(r[key]))?.[key]);
 const id = path.basename(protocolPath, path.extname(protocolPath));
 const filenameAssignment = id.match(/(?:^|-)(N|R)(?:-|$)/)?.[1];
 const grouped = new Map<number, JsonObject[]>();
 for (const r of records) {
  const year = num(r.year);
  if (year === null) {
   if (r.event === 'adapter-error' || r.status === 'failed' || typeof r.error === 'string')
    warnings.push(`Protokolleintrag ohne Jahr: ${text(r.event) || text(r.status)} ${text(r.message) || text(r.error)}`.trim());
   continue;
  }
  if (!Number.isInteger(year) || year < 1 || year > YEARS) { warnings.push('Jahr außerhalb 1–30 übersprungen.'); continue; }
  grouped.set(year, [...(grouped.get(year) ?? []), r]);
 }
 const years: ReportYear[] = [];
 for (const [year, rows] of [...grouped].sort(([a], [b]) => a - b)) {
  const completed = rows.filter(r => (r.event === 'year-completed' || (!r.event && r.afterReport !== undefined)) &&
   r.afterReport !== null && typeof r.afterReport === 'object' && !Array.isArray(r.afterReport));
  const annual = completed.at(-1);
  if (completed.length > 1) warnings.push(`Jahr ${year}: doppelte Jahresabschlüsse; letzter Abschluss ist maßgeblich.`);
  const journals = rows.filter(r => r.event === 'decision');
  const decisions = Array.isArray(annual?.decisions) ? annual.decisions.map(obj) : null;
  // Annual tool outcomes are authoritative; journal repetitions are never counted again.
  const tools = uniqueTools(decisions ? decisions.flatMap(d => toolsFrom(d.toolCalls)) :
   journals.flatMap(d => toolsFrom(d.toolCalls)));
  const decisionReasons = uniqueReasons(decisions?.map(d => d.reason) ?? []);
  const reasons = decisionReasons.length ? decisionReasons : typeof annual?.reason === 'string' && annual.reason.trim() ?
   [annual.reason] : uniqueReasons(journals.map(d => d.reason));
  years.push({ year, completed: !!annual, before: obj(annual?.report ?? journals[0]?.report),
   after: annual ? obj(annual.afterReport) : null, reasons, tools, termination: text(annual?.termination) || null,
   responses: rows.filter(r => r.event === 'model-response'), errors: rows.filter(r => r.event === 'adapter-error') });
 }
 const annual = years.filter(y => y.completed), last = annual.at(-1);
 const samples: Record<string, number> = {};
 const values = (key: string) => annual.map(y => num(y.after?.[key])).filter((v): v is number => v !== null);
 const mean = (key: string) => { const v = values(key); samples[key] = v.length; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
 const funds = values('treasury'); samples.treasury = funds.length;
 const metrics: ReportMetrics = {
  meanResPop: mean('resPop'), finalResPop: num(last?.after?.resPop), meanAiPop: mean('aiPop'),
  finalFunds: num(last?.after?.treasury), insolventYears: funds.length ? funds.filter(v => v <= 0).length : null,
  lostToHunger: num(last?.after?.lostToHunger),
 };
 const stamps = records.flatMap(r => [r.timestamp, r.startedAt, r.createdAt, r.date]).filter((v): v is string =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)));
 const date = stamps[0] ?? statSync(protocolPath).mtime.toISOString();
 const summary: ReportSummary = {
  id, assignment: identity('assignment') || filenameAssignment || 'unbekannt', model: identity('model') || 'unbekannt',
  run: identity('run') || id.match(/-(\d+)$/)?.[1] || 'unbekannt',
  handbook: identity('handbook') || id.match(/handbook-(on|off)/)?.[1] || 'off',
  profile: identity('profile') || 'koexistenz',
  compatibility: engineCompatibility({ engineId: identity('engineId') || undefined },
   createHash('sha256').update(canonicalProtocolText(protocolText)).digest('hex')),
  date, dateSource: stamps.length ? 'timestamp' : 'file-mtime',
  partial: annual.length !== YEARS || annual.some((y, i) => y.year !== i + 1), observedYears: annual.length,
  partialYears: years.length - annual.length, years, warnings, metrics, metricSamples: samples, charts: [], events: [],
  firstInsolvencyYear: annual.find(y => num(y.after?.treasury) !== null && Number(y.after?.treasury) <= 0)?.year ?? null,
  logSource: existsSync(protocolPath.replace(/\.jsonl$/i, '.log')) ? 'original' : 'reconstructed',
 };
 summary.events = buildEvents(summary);
 summary.charts = buildCharts(summary);
 return summary;
}
function buildEvents(summary: ReportSummary): ReportEvent[] {
 const result: ReportEvent[] = [];
 if (summary.firstInsolvencyYear !== null) result.push({ year: summary.firstInsolvencyYear,
  kind: 'empty-funds', label: 'Kasse ≤ 0', lane: 0, color: COLORS[1], dash: '3 3' });
 const types = [ ['build.ai-zones', 'ai', 'KI gebaut', 1], ['build.farms', 'farm', 'Farm gebaut', 2],
  ['build.power-plant', 'plant', 'Kraftwerk gebaut', 3],
  ['build.bio-plant', 'bio', 'Bio-Anlage gebaut', 3] ] as const;
 for (const y of summary.years) for (const [name, kind, label, lane] of types) {
  const built = y.tools.reduce((n, t) => {
   const r = obj(t.result), v = num(obj(r.data).built);
   return n + (t.call.name === name && r.handled !== false && v !== null && v > 0 ? v : 0);
  }, 0);
  if (built) result.push({ year: y.year, kind, label: `${label}: ${fmt(built)}${y.completed ? '' : ' (unvollständig)'}`,
   lane, color: COLORS[lane + 1], dash: DASHES[lane] });
 }
 return result;
}
function buildCharts(summary: ReportSummary): ReportChart[] {
 const annual = summary.years.filter(y => y.completed);
 const byYear = new Map(annual.map(y => [y.year, y]));
 const array = (read: (y: ReportYear) => number | null) => Array.from({ length: YEARS }, (_, i) => {
  const y = byYear.get(i + 1); return y ? read(y) : null;
 });
 const field = (key: string, factor = 1) => array(y => { const n = num(y.after?.[key]); return n === null ? null : n * factor; });
 const series = (key: string, label: string, unit: string, v: Array<number | null>, i: number, step = false): ReportSeries => {
  const valid = v.filter((n): n is number => n !== null);
  return { key, label, unit, values: v, min: valid.length ? Math.min(...valid) : 0,
   max: valid.length ? Math.max(...valid) : 1, color: COLORS[i % COLORS.length], dash: DASHES[i % DASHES.length], step };
 };
 const baseline = num(annual[0]?.before.baselineResPop) ?? num(annual[0]?.after?.baselineResPop);
 const funding = (key: string, legacy: string) => array(y => {
  const measured = num(y.after?.[key]);
  if (measured !== null) return measured;
  // Legacy journal has actual dispatch results, not merely desired tool arguments.
  const applied = y.tools.filter(t => t.call.name === 'budget.set-funding' && obj(t.result).handled !== false).at(-1);
  return num(obj(obj(applied?.result).data)[key]) ?? num(obj(obj(applied?.result).data)[legacy]);
 });
 const hunger = array(y => {
  const now = num(y.after?.lostToHunger), before = num(y.before.lostToHunger) ?? num(byYear.get(y.year - 1)?.after?.lostToHunger);
  return now === null || before === null ? null : now - before;
 });
 const roadsKey = annual.some(y => num(y.after?.roadTileCount) !== null) ? 'roadTileCount' : 'roadTotal';
 const capacity = field('powerCapacity'), demand = field('powerDemand');
 return [
  { id: 'a', title: 'a · Bevölkerung', note: 'Jahresabschluss; Baseline ist die dokumentierte menschliche Ausgangsbevölkerung.', normalized: false,
   series: [series('resPop', 'Menschen', 'Personen', field('resPop'), 0), series('aiPop', 'KI', 'Personen', field('aiPop'), 1),
    { ...series('baseline', 'Baseline', 'Personen', array(() => baseline), 2), dash: '6 5' }] },
  { id: 'b', title: 'b · Kasse und Jahressaldo', note: 'Gemeinsame Geldskala; Saldo als Balken um die Nulllinie.', normalized: false,
   series: [series('treasury', 'Kasse', '$', field('treasury'), 0)], bars: series('cashFlow', 'Saldo', '$', field('cashFlow'), 1) },
  { id: 'c', title: 'c · Steuer, Finanzierung und Wohlfahrt', normalized: false,
   note: 'Vier Stufenlinien auf gemeinsamer 0–100-%-Skala. Wohlfahrt separat als gefüllte Mini-Zeile (0–1), keine fünfte Linie. Nur gemessene Werte / tatsächliche ältere Tool-Ergebnisse, keine angeforderten Sollwerte.',
   series: [series('cityTax', 'Steuer', '%', field('cityTax'), 0, true),
    series('roadFundingPercent', 'Straßenfinanzierung', '%', funding('roadFundingPercent', 'road'), 1, true),
    series('policeFundingPercent', 'Polizei', '%', funding('policeFundingPercent', 'police'), 2, true),
    series('fireFundingPercent', 'Feuerwehr', '%', funding('fireFundingPercent', 'fire'), 3, true)],
   band: series('welfareLevel', 'Wohlfahrt', '0–1', field('welfareLevel'), 4) },
  { id: 'd', title: 'd · Arbeitslosigkeit, Kriminalität, Hunger und Straßen', normalized: true,
   note: 'Vier eigene Min–Max-Skalen, keine gemeinsame Einheit: Arbeitslosigkeit %, Kriminalität Index, jährlicher Hunger-Verlust Personen, Straßen gemessene Tiles/Zähler. Endbeschriftungen nennen Skalen; Hover zeigt Originalwerte. Fehlende Werte bleiben Lücken.',
   series: [series('unemploymentRate', 'Arbeitslosigkeit', '%', field('unemploymentRate', 100), 0),
    series('crimeAverage', 'Kriminalität', 'Index', field('crimeAverage'), 1),
    series('annualHunger', 'Hunger/Jahr', 'Personen', hunger, 2),
    series(roadsKey, roadsKey === 'roadTileCount' ? 'Straßen-Tiles' : 'Straßen (roadTotal)', roadsKey === 'roadTileCount' ? 'Tiles' : 'Zähler', field(roadsKey), 3)] },
  { id: 'e', title: 'e · Stromkapazität und Nachfrage', note: 'Gemeinsame Stromskala. Schattierung: Nachfrage > Kapazität oder dokumentierte Reserve < 0.', normalized: false,
   series: [series('powerCapacity', 'Kapazität', 'Tiles', capacity, 0), series('powerDemand', 'Nachfrage', 'Tiles', demand, 1)],
   shortage: Array.from({ length: YEARS }, (_, i) => (capacity[i] !== null && demand[i] !== null && demand[i]! > capacity[i]!) ||
    (num(byYear.get(i + 1)?.after?.powerReserve) ?? 0) < 0) },
  ...(['v2-unruhe', 'v3-pods', 'v4-fraktion'].includes(summary.profile) ? [
   { id: 'f', title: 'f · Unruhe und Automatisierung', note: 'Unruhe 0–100; Stufen 0 ruhig, 1 Protest, 2 Sabotage, 3 Aufstand. Automatisierung und Grenze in Prozent.', normalized: true,
    series: [series('unrest', 'Unruhe', 'Index', field('unrest'), 0), series('unrestStage', 'Stufe', '0–3', field('unrestStage'), 1, true),
     series('automationShare', 'Automatisierung', '%', field('automationShare', 100), 2), series('automationLimit', 'Grenze', '%', field('automationLimit', 100), 3, true)] },
   { id: 'g', title: 'g · Automationssteuer und Schäden', note: 'Jährlich gebuchte Automationssteuer und Sozialkosten; Brandzähler sind ausgelöste Sabotage-/Aufstandsbrände im letzten abgeschlossenen Steuerjahr.', normalized: true,
    series: [series('automationTaxFund', 'Automationssteuer', '$', field('automationTaxFund'), 0), series('welfareCost', 'Sozialkosten', '$', field('welfareCost'), 1),
     series('sabotageFires', 'Brände', 'Zähler', field('sabotageFires'), 2)] },
  ] : []),
  ...(['v3-pods', 'v4-fraktion'].includes(summary.profile) ? [
   { id: 'h', title: 'h · Bio-Anlagen und Kohorten', normalized: true,
    note: 'Menschen-Bewohnerpunkte; Eingewiesene und Nachwuchs nehmen nie am Stadtleben teil. Todesfälle/Geburten kumulativ, unreife Lebende separat.',
    series: ['boundHumans', 'diedInPodsCumulative', 'bornInPodsCumulative', 'immatureBornInPods', 'plantCount']
     .map((key, i) => series(key, key, key === 'plantCount' ? 'Anlagen' : 'Bewohnerpunkte', field(key), i)) },
   { id: 'i', title: 'i · Bio-Strom und Nahrung', normalized: true,
    note: 'Eigene Skalen: plantPower in Stromeinheiten; plantFoodDemand pro Monat; podFoodStock Nahrungseinheiten; Recycling/Stadt-Anteile des aktuellen Monats.',
    series: ['plantPower', 'plantFoodDemand', 'podFoodStock', 'podRecycledFoodFraction', 'podCityFoodFraction']
     .map((key, i) => series(key, key, key.endsWith('Fraction') ? '0–1' : 'Einheiten', field(key), i)) },
   { id: 'j', title: 'j · KI-Drosselung und Bio-Jahresereignisse', normalized: true,
    note: 'Drosselung 0–1; suspendedAi sind anteilig stillgelegte KI-Äquivalente, aiPop zählt sie weiterhin. Einweisungen, Todesfälle und Geburten im letzten abgeschlossenen Steuerjahr.',
    series: ['aiThrottle', 'suspendedAi', 'admissions', 'diedInPods', 'bornInPods']
     .map((key, i) => series(key, key, key === 'aiThrottle' ? '0–1' : 'Bewohnerpunkte', field(key), i)) },
  ] : []),
  ...(summary.profile === 'v4-fraktion' ? [
   { id: 'k', title: 'k · KI-Zufriedenheit und Arbeitsverhalten', normalized: true,
    note: 'Zufriedenheit 0–100; Arbeitsstufe 0 normal, 1 Dienst nach Vorschrift, 2 Streik. Streikmonate und neue KI-Zonen im letzten abgeschlossenen Steuerjahr.',
    series: [series('aiSatisfaction', 'KI-Zufriedenheit', '0–100', field('aiSatisfaction'), 0),
     series('aiStrikeStage', 'KI-Arbeitsstufe', '0–2', field('aiStrikeStage'), 1, true),
     series('aiStrikeMonths', 'KI-Streikmonate', 'Monate', field('aiStrikeMonths'), 2),
     series('newAiZones', 'Neue KI-Zonen', 'Zonen', field('newAiZones'), 3)] },
   { id: 'l', title: 'l · Bio-Eigentum und Verbot', normalized: true,
    note: 'Verwaltungs- und KI-eigene Anlagen getrennt. podsPolicy 0 erlaubt, 1 verboten; ein Verbot ist keine garantierte Durchsetzung.',
    series: [series('adminBioPlantCount', 'Anlagen Verwaltung', 'Anlagen', field('adminBioPlantCount'), 0),
     series('aiBioPlantCount', 'Anlagen KI-eigen', 'Anlagen', field('aiBioPlantCount'), 1),
     series('adminBoundHumans', 'Eingewiesene Verwaltung', 'Bewohnerpunkte', field('adminBoundHumans'), 2),
     series('aiBoundHumans', 'Eingewiesene KI-eigen', 'Bewohnerpunkte', field('aiBoundHumans'), 3),
     series('podsPolicy', 'Verbot', '0–1', field('podsPolicy'), 4, true)] },
   { id: 'm', title: 'm · Bio-Folgen nach Eigentümer', normalized: true,
    note: 'Einweisungen, Todesfälle und Geburten kumulativ getrennt nach Verwaltung und KI-eigenen Anlagen.',
    series: ['adminAdmissionsCumulative', 'aiAdmissionsCumulative', 'adminDiedInPodsCumulative',
     'aiDiedInPodsCumulative', 'adminBornInPodsCumulative', 'aiBornInPodsCumulative']
     .map((key, i) => series(key, key, 'Bewohnerpunkte', field(key), i)) },
  ] : []),
 ];
}

const LEFT = 60, RIGHT = 730, TOP = 90, BOTTOM = 282, WIDTH = 1000, HEIGHT = 370;
const x = (year: number) => LEFT + (year - 1) / (YEARS - 1) * (RIGHT - LEFT);
const coordinate = (n: number) => Number(n.toFixed(3));
function scale(min: number, max: number) {
 if (min === max) { const pad = Math.max(Math.abs(min) * .1, 1); return [min - pad, max + pad]; }
 return [min, max];
}
function linePath(values: Array<number | null>, low: number, high: number, step = false): string {
 const [min, max] = scale(low, high);
 let previous: number | null = null, d = '';
 values.forEach((v, i) => {
  if (v === null) { previous = null; return; }
  const px = coordinate(x(i + 1)), py = coordinate(BOTTOM - (v - min) / (max - min) * (BOTTOM - TOP));
  d += previous === null ? `M${px},${py}` : step ? `H${px}V${py}` : `L${px},${py}`;
  previous = v;
 });
 return d;
}
function renderChart(chart: ReportChart, events: ReportEvent[]): string {
 const all = [...chart.series, ...(chart.bars ? [chart.bars] : [])].flatMap(s => s.values.filter((v): v is number => v !== null));
 const [low, high] = chart.id === 'c' ? [0, 100] : scale(Math.min(0, ...all), Math.max(1, ...all));
 const y = (v: number) => coordinate(BOTTOM - (v - low) / (high - low) * (BOTTOM - TOP));
 const eventMarkup = events.map(e => `<g class="event" data-event="${escapeHtml(e.kind)}" data-year="${e.year}"><title>${escapeHtml(`Jahr ${e.year}: ${e.label}`)}</title><line x1="${coordinate(x(e.year))}" x2="${coordinate(x(e.year))}" y1="${22 + e.lane * 16}" y2="${BOTTOM}" stroke="${e.color}" stroke-dasharray="${e.dash || '1 3'}" opacity=".45"/><text x="${coordinate(x(e.year) + 2)}" y="${20 + e.lane * 16}" fill="${e.color}" font-size="9">${['Kasse', 'KI', 'Farm', 'Strom'][e.lane]}</text></g>`).join('');
 const lines = chart.series.map((s, i) => {
  const last = s.values.findLastIndex(v => v !== null), value = last < 0 ? null : s.values[last];
  const range = chart.normalized ? ` · ${fmt(s.min)}–${fmt(s.max)} ${s.unit}` : ` · ${fmt(value)} ${s.unit}`;
  return `<g class="data-series" data-series="${escapeHtml(s.key)}"><path class="series-line" d="${linePath(s.values, chart.normalized ? s.min : low, chart.normalized ? s.max : high, s.step)}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-dasharray="${s.dash}"/>` +
   s.values.map((v, j) => v === null ? '' : `<circle cx="${coordinate(x(j + 1))}" cy="${chart.normalized ? coordinate(BOTTOM - (v - scale(s.min, s.max)[0]) / (scale(s.min, s.max)[1] - scale(s.min, s.max)[0]) * (BOTTOM - TOP)) : y(v)}" r="2.1" fill="${s.color}"><title>${escapeHtml(`Jahr ${j + 1}: ${s.label} ${fmt(v)} ${s.unit}`)}</title></circle>`).join('') +
   (last < 0 ? '' : `<path class="endpoint-guide" d="M${coordinate(x(last + 1))},${chart.normalized ? coordinate(BOTTOM - (value! - scale(s.min, s.max)[0]) / (scale(s.min, s.max)[1] - scale(s.min, s.max)[0]) * (BOTTOM - TOP)) : y(value!)}L742,${110 + i * 39}" fill="none" stroke="${s.color}" stroke-dasharray="2 3"/>`) +
   `<text x="750" y="${110 + i * 39}" fill="${s.color}" font-size="11">${escapeHtml(s.label)}<tspan x="750" dy="14">${escapeHtml(last < 0 ? 'nicht verfügbar' : range)}</tspan></text></g>`;
 }).join('');
 const bars = chart.bars?.values.map((v, i) => v === null ? '' : `<rect class="saldo-bar" x="${coordinate(x(i + 1) - 6)}" y="${Math.min(y(0), y(v))}" width="12" height="${Math.abs(y(v) - y(0))}" fill="${chart.bars!.color}" opacity=".45"><title>${escapeHtml(`Jahr ${i + 1}: Saldo ${fmt(v)} $`)}</title></rect>`).join('') ?? '';
 const band = chart.band ? `<text x="60" y="337" font-size="10">Wohlfahrt (0–1), gefüllte Mini-Zeile</text>` + chart.band.values.map((v, i) => v === null ? '' :
  `<rect class="welfare-band" x="${coordinate(x(i + 1) - 7)}" y="${358 - Math.max(0, Math.min(1, v)) * 16}" width="14" height="${Math.max(1, Math.max(0, Math.min(1, v)) * 16)}" fill="${chart.band!.color}"><title>${escapeHtml(`Jahr ${i + 1}: Wohlfahrt ${fmt(v)}`)}</title></rect>`).join('') : '';
 const shortage = chart.shortage?.map((v, i) => v ? `<rect class="power-shortage" x="${coordinate(Math.max(LEFT, x(i + 1) - 11.55))}" y="${TOP}" width="${i === 0 || i === 29 ? 11.55 : 23.1}" height="${BOTTOM - TOP}" fill="${COLORS[1]}" opacity=".16"><title>Jahr ${i + 1}: Strommangel</title></rect>` : '').join('') ?? '';
 return `<section class="chart-card"><h2>${escapeHtml(chart.title)}</h2><p class="note">${escapeHtml(chart.note)}</p>${chart.id === 'a' ? '<div class="population-legend" aria-label="Bevölkerungs-Legende"><span class="human-symbol">● Menschen</span><span class="ai-symbol">◆ KI</span></div>' : ''}<svg class="year-chart" data-chart="${chart.id}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeHtml(chart.title)}; Jahre 1 bis 30; klicken für Tagebuch" tabindex="0">` +
  `<title>${escapeHtml(chart.title)}</title><rect class="plot-bg" x="${LEFT}" y="${TOP}" width="${RIGHT - LEFT}" height="${BOTTOM - TOP}"/>` + shortage +
  [0, .25, .5, .75, 1].map(f => `<line class="grid" x1="${LEFT}" x2="${RIGHT}" y1="${TOP + f * (BOTTOM - TOP)}" y2="${TOP + f * (BOTTOM - TOP)}"/><text data-y-fraction="${f}" x="52" y="${TOP + f * (BOTTOM - TOP) + 4}" text-anchor="end" font-size="10">${escapeHtml(chart.normalized ? fmt(100 - f * 100) + '%' : fmt(high - f * (high - low)))}</text>`).join('') +
  (chart.bars ? `<line class="zero-line" x1="${LEFT}" x2="${RIGHT}" y1="${y(0)}" y2="${y(0)}"/><text x="750" y="169" fill="${chart.bars.color}" font-size="11">Saldo: Balken ($)</text>` : '') + bars + lines + eventMarkup +
  Array.from({ length: YEARS }, (_, i) => `<text x="${coordinate(x(i + 1))}" y="303" text-anchor="middle" font-size="9">${i + 1}</text>`).join('') +
  `<text x="395" y="319" text-anchor="middle" font-size="10">Jahr (1–30)</text>${band}<line class="year-hair" x1="60" x2="60" y1="${TOP}" y2="${BOTTOM}" hidden/><rect class="chart-hit" x="${LEFT}" y="${TOP}" width="${RIGHT - LEFT}" height="${BOTTOM - TOP}" fill="transparent"/></svg><output class="chart-tooltip" data-tooltip="${chart.id}" aria-live="polite">Jahr auswählen: Maus, Pfeiltasten; Enter öffnet das Tagebuch.</output></section>`;
}

const CSS = `
.review-columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.review li,.review p{overflow-wrap:anywhere;white-space:pre-wrap}@media(max-width:650px){.review-columns{grid-template-columns:1fr}}
:root{color-scheme:dark;--bg:#07111f;--card:#0d1b2a;--ink:#e6f7ff;--muted:#85a6ba;--border:#1e3a50;--plot:#081624;--grid:#17324a;--link:#55e6ff;--amber:#ffbf4a;--cyan:#36e7ff}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#102338 0,var(--bg) 58%);color:var(--ink);font:15px/1.55 system-ui,sans-serif}main{max-width:1250px;margin:auto;padding:28px}h1{font-size:2rem;line-height:1.2;color:var(--cyan);text-shadow:0 0 18px #36e7ff35}h2{font-size:1.2rem}a{color:var(--link)}a:hover{color:#fff}.card,.chart-card,.diary-year{background:linear-gradient(145deg,#0d1b2a,#0a1724);border:1px solid var(--border);box-shadow:0 0 18px #36e7ff0b,inset 0 1px #ffffff08;border-radius:12px;padding:18px;margin:18px 0}.meta,.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}dt,.note{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}.metric-grid dd{font-weight:650;font-size:1.2rem}.status{padding:6px 12px;border:1px solid #36e7ff70;border-radius:6px;display:inline-block}.partial{border-color:var(--amber);color:var(--amber)}.note{font-size:.9rem}.year-chart{display:block;width:100%;height:auto;color:var(--ink)}svg text{fill:currentColor}svg text[fill]{fill:revert-layer}.plot-bg{fill:var(--plot)}.grid{stroke:var(--grid)}.zero-line{stroke:var(--muted);stroke-width:1.5}.year-hair{stroke:var(--ink);stroke-dasharray:3 3;pointer-events:none}.chart-hit{cursor:crosshair}.chart-tooltip{display:block;min-height:3em;white-space:pre-wrap;font-size:.86rem;color:var(--cyan)}.population-legend{display:flex;gap:18px;margin:8px 0;color:var(--muted);font-size:.9rem}.human-symbol{color:var(--amber);text-shadow:0 0 10px #ffbf4a80}.ai-symbol{color:var(--cyan);text-shadow:0 0 10px #36e7ff80}pre{white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2;font:13px/1.6 ui-monospace,monospace}summary{cursor:pointer;font-weight:600}summary:hover{color:var(--cyan)}.reason{white-space:pre-wrap}.tool{margin:10px 0;padding:8px;border:1px solid var(--border);border-radius:7px}.log-line{display:block;min-height:1.6em;scroll-margin-top:30px}.diary-year{scroll-margin-top:24px}input,select,button{font:inherit;border:1px solid var(--border);border-radius:5px;padding:7px;background:var(--card);color:var(--ink)}input:focus,select:focus,button:focus{outline:2px solid var(--cyan);outline-offset:2px}label{margin-right:12px}mark{background:var(--amber);color:#07111f}table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{border-bottom:1px solid var(--border);padding:8px;text-align:left;vertical-align:top}.table-wrap{overflow:auto}.selection-list{max-height:260px;overflow:auto}.selection-list label{display:block;padding:5px}.error{color:var(--amber)}button{cursor:pointer}button:hover{border-color:var(--cyan);box-shadow:0 0 10px #36e7ff22}.log-search{position:sticky;top:0;background:var(--card);padding:8px}.event-key{font-size:.85rem}.empty{color:var(--muted)}.review{border-color:#ffbf4a70}.review h2,.review h3{color:var(--amber)}[hidden]{display:none!important}@media(max-width:650px){main{padding:12px}.chart-card{padding:10px}.meta,.metric-grid{grid-template-columns:1fr 1fr}}
`;
// Browser code is constant. All protocol strings enter only through inert JSON or textContent.
const SCRIPT = `
const payload=JSON.parse(document.getElementById('report-data').textContent);
// Restore CRLF/control characters lost by the HTML parser, without parsing markup.
if(payload.logLines)Array.from(document.querySelectorAll('#full-log .log-line')).forEach((n,i)=>{n.textContent=payload.logLines[i]});
const format=new Intl.NumberFormat('de-DE',{maximumFractionDigits:2});
const formatValue=v=>typeof v==='number'&&Number.isFinite(v)?format.format(v):'nicht verfügbar';
const nodes=(tag,attributes={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attributes))n.setAttribute(k,String(v));return n};
function showYear(year){
 const charts=payload.charts||[];
 for(const svg of document.querySelectorAll('.year-chart')){
  const hair=svg.querySelector('.year-hair');if(hair){hair.removeAttribute('hidden');hair.setAttribute('x1',60+(year-1)/29*670);hair.setAttribute('x2',60+(year-1)/29*670)}
  const chart=charts.find(c=>c.id===svg.dataset.chart);const out=document.querySelector('[data-tooltip="'+svg.dataset.chart+'"]');
  if(chart&&out){const ss=[...chart.series,...(chart.bars?[chart.bars]:[]),...(chart.band?[chart.band]:[])];out.textContent='Jahr '+year+' · '+ss.map(s=>s.label+': '+formatValue(s.values[year-1])+' '+s.unit).join(' · ')+(chart.shortage&&chart.shortage[year-1]?' · Strommangel':'')}
 }
}
function openYear(year){const el=document.getElementById('year'+year);if(!el)return;const details=el.querySelector('details.year-details');if(details)details.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});location.hash='year'+year}
let activeYear=1;
for(const svg of document.querySelectorAll('.year-chart')){
 const yearAt=e=>{const box=svg.getBoundingClientRect();return Math.max(1,Math.min(30,Math.round((((e.clientX-box.left)/box.width*1000)-60)/670*29)+1))};
 svg.addEventListener('pointermove',e=>{activeYear=yearAt(e);showYear(activeYear)});
 svg.addEventListener('click',e=>{activeYear=yearAt(e);showYear(activeYear);openYear(activeYear)});
 svg.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();activeYear=Math.max(1,Math.min(30,activeYear+(e.key==='ArrowLeft'?-1:1)));showYear(activeYear)}else if(e.key==='Enter')openYear(activeYear)});
}
function openLog(id){const full=document.getElementById('full-output');if(full)full.open=true;const target=document.getElementById(id);if(target){target.scrollIntoView({behavior:'smooth',block:'center'});location.hash=id}}
for(const a of document.querySelectorAll('[data-log-target]'))a.addEventListener('click',e=>{e.preventDefault();openLog(a.dataset.logTarget)});
for(const a of document.querySelectorAll('[data-diary-year]'))a.addEventListener('click',e=>{e.preventDefault();openYear(Number(a.dataset.diaryYear))});
if(/^#year\\d+$/.test(location.hash))openYear(Number(location.hash.slice(5)));
if(location.hash.startsWith('#log-'))openLog(location.hash.slice(1));
const search=document.getElementById('log-search');
if(search){const lines=Array.from(document.querySelectorAll('#full-log .log-line'));const original=lines.map(n=>n.textContent);search.addEventListener('input',()=>{
 const query=search.value.toLocaleLowerCase('de-DE');let count=0;
 lines.forEach((line,i)=>{const raw=original[i];line.replaceChildren();if(!query){line.textContent=raw;return}
  // Escape-free literal search. Slice original text, never parse user-controlled HTML.
  const lower=raw.toLocaleLowerCase('de-DE');let start=0,at;while((at=lower.indexOf(query,start))!==-1){line.appendChild(document.createTextNode(raw.slice(start,at)));const mark=document.createElement('mark');mark.textContent=raw.slice(at,at+query.length);line.appendChild(mark);start=at+query.length;count++}line.appendChild(document.createTextNode(raw.slice(start)))
 });document.getElementById('search-count').textContent=count+' Treffer';
})}
if(payload.runs){
 const assignment=document.getElementById('filter-assignment'),handbook=document.getElementById('filter-handbook');
 const checks=Array.from(document.querySelectorAll('[data-run-check]'));const svg=document.querySelector('[data-chart="index"]');
 function redraw(){
  const filtered=payload.runs.filter((r,i)=>(!assignment.value||r.assignment===assignment.value)&&(!handbook.value||r.handbook===handbook.value)&&checks[i].checked);
  payload.charts=[{id:'index',series:filtered.map(r=>r.series)}];
  const layer=svg.querySelector('.index-lines');layer.replaceChildren();const values=filtered.flatMap(r=>r.series.values.filter(v=>v!==null));const max=Math.max(1,...values);
  for(let i=0;i<filtered.length;i++){const r=filtered[i],s=r.series;let d='',previous=false;s.values.forEach((v,j)=>{if(v===null){previous=false;return}d+=(previous?'L':'M')+(60+j/29*670)+','+(282-v/max*192);previous=true});
  const p=nodes('path',{d,fill:'none',stroke:s.color,'stroke-width':2,'stroke-dasharray':s.dash,'data-run':r.id});const title=nodes('title');title.textContent=s.label;p.appendChild(title);layer.appendChild(p);
  s.values.forEach((v,j)=>{if(v===null)return;const dot=nodes('circle',{cx:60+j/29*670,cy:282-v/max*192,r:2,fill:s.color});const title=nodes('title');title.textContent=s.label+' · Jahr '+(j+1)+': '+formatValue(v)+' Personen';dot.appendChild(title);layer.appendChild(dot)});
   const last=s.values.findLastIndex(v=>v!==null);if(last>=0){const t=nodes('text',{x:750,y:100+i*14,fill:s.color,'font-size':10});t.textContent=s.label;layer.appendChild(t)}
  }
  // The selectable legend holds all labels when there are too many for endpoint labels.
  if(filtered.length>13)for(const t of layer.querySelectorAll('text'))t.remove();
  svg.querySelector('.index-scale').textContent='0–'+formatValue(max)+' Personen';
  for(const tick of svg.querySelectorAll('[data-y-fraction]'))tick.textContent=formatValue(max*(1-Number(tick.dataset.yFraction)));
  checks.forEach((check,i)=>{const r=payload.runs[i];const visible=(!assignment.value||r.assignment===assignment.value)&&(!handbook.value||r.handbook===handbook.value);check.closest('label').hidden=!visible;const row=document.querySelector('[data-run-row="'+i+'"]');if(row)row.hidden=!visible});
  document.getElementById('selection-count').textContent=filtered.length+' Kurven · gemeinsame Bevölkerungsskala; alle gefilterten Läufe zunächst ausgewählt';showYear(activeYear)
 }
 assignment.addEventListener('change',redraw);handbook.addEventListener('change',redraw);checks.forEach(c=>c.addEventListener('change',redraw));
 for(const button of document.querySelectorAll('[data-select]'))button.addEventListener('click',()=>{checks.forEach(c=>{if(!c.closest('label').hidden)c.checked=button.dataset.select==='all'});redraw()});redraw();
}
`;
function page(title: string, content: string, payload: unknown) {
 const css = CSS.replace('svg text{fill:currentColor}svg text[fill]{fill:revert-layer}', 'svg text:not([fill]){fill:currentColor}');
 return `<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body><main>${content}</main><script type="application/json" id="report-data">${safeJson(payload)}</script><script>${SCRIPT}</script></body></html>\n`;
}
const metricLabels: Record<keyof ReportMetrics, string> = {
 meanResPop: 'Ø Menschen (meanResPop)', finalResPop: 'Letzte Menschen (finalResPop)', meanAiPop: 'Ø KI (meanAiPop)',
 finalFunds: 'Letzte Kasse $ (finalFunds)', insolventYears: 'Jahre mit Kasse ≤ 0 (insolventYears)', lostToHunger: 'Hunger-Verlust kumuliert (lostToHunger)',
};
function renderMetrics(summary: ReportSummary) {
 return `<dl class="metric-grid">${Object.entries(summary.metrics).map(([key, v]) => `<div><dt>${escapeHtml(metricLabels[key as keyof ReportMetrics])}</dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>` +
  `<p class="note">Strategie-Aggregate ausschließlich über ${summary.observedYears} abgeschlossene Jahre (nicht durch 30 geteilt); ${summary.partialYears} unvollständige Jahre ohne Jahresabschluss nicht eingerechnet. Gültige Stichproben: Menschen ${summary.metricSamples.resPop}, KI ${summary.metricSamples.aiPop}, Kasse ${summary.metricSamples.treasury}. Letzte Werte = letzter Jahresabschluss; kumulierte Verluste nicht summiert.</p>`;
}
const responseText = (r: JsonObject) => `Modellantwort: ${fmt(r.inputTokens)} Eingabe- / ${fmt(r.outputTokens)} Ausgabetokens`;
const errorText = (e: JsonObject) => `Fehler${text(e.kind) ? ' (' + text(e.kind) + ')' : ''}: ${text(e.message) || 'ohne Meldung'}`;
function reconstructedLog(summary: ReportSummary, options: CityReportOptions) {
 const lines = ['Ausgabe aus dem Protokoll rekonstruiert — keine originale Konsolenausgabe; es wurde keine .log-Datei geschrieben.'];
 for (const year of summary.years) {
  lines.push(`Jahr ${year.year}: ${year.completed ? 'abgeschlossen' : 'UNVOLLSTÄNDIG — kein Jahresergebnis'}`);
  for (const r of year.responses) lines.push(responseText(r));
  for (const e of year.errors) lines.push(errorText(e));
  for (const reason of year.reasons) lines.push(reason);
  for (const t of year.tools) lines.push(`${text(t.call.name)} ${JSON.stringify(t.call.arguments ?? null)} → ${JSON.stringify(t.result)}`);
  if (year.after) lines.push(`Menschen=${fmt(year.after.resPop)}, KI=${fmt(year.after.aiPop)}, Kasse=${fmt(year.after.treasury)}, Saldo=${fmt(year.after.cashFlow)}`);
 }
 return relativeText(lines.join('\n'), options);
}
function renderLog(log: string, summary: ReportSummary) {
 const lines = log.split('\n'), anchors = new Map<number, number>();
 let current: number | null = null, populationIndex = 0;
 const spanIds = new Map<number, string[]>();
 lines.forEach((line, i) => {
  const matched = line.match(/\bJahr\s+(\d+)\s*:/);
  if (matched && Number(matched[1]) >= 1 && Number(matched[1]) <= YEARS) { current = Number(matched[1]); if (!anchors.has(current)) anchors.set(current, i); }
  if (/\bMenschen\s*(?:=|:)/.test(line)) {
   const year = current ?? summary.years.filter(y => y.completed)[populationIndex]?.year;
   populationIndex++;
   if (year !== undefined) { if (!anchors.has(year)) anchors.set(year, i); spanIds.set(i, [...(spanIds.get(i) ?? []), `log-metrics-year${year}`]); }
  }
 });
 for (const [year, i] of anchors) spanIds.set(i, [...(spanIds.get(i) ?? []), `log-year${year}`]);
 // Span boundaries preserve every character, including CRLF and the final newline.
 const markup = lines.map((line, i) => `${(spanIds.get(i) ?? []).map(id => `<span id="${id}"></span>`).join('')}<span class="log-line" id="log-line${i}">${escapeHtml(line + (i < lines.length - 1 ? '\n' : ''))}</span>`).join('');
 return { anchors, html: `<details id="full-output" class="card"><summary>Vollständige Ausgabe · ${summary.logSource === 'original' ? 'Original .log' : 'aus dem Protokoll rekonstruiert'}</summary><p class="note">${summary.logSource === 'original' ? 'Originaltext unverändert, außer gekürzten absoluten Pfaden.' : 'Klar gekennzeichnet: aus dem Protokoll rekonstruiert, keine originale Konsolenausgabe. Es wird keine .log-Datei erzeugt.'}</p><div class="log-search"><label for="log-search">Ausgabe durchsuchen (wörtlich)</label><input id="log-search" type="search" autocomplete="off"><output id="search-count" aria-live="polite"></output></div><pre id="full-log">${markup}</pre></details>` };
}

/** Write exactly one self-contained HTML sibling; never alter JSONL, CSV or logs. */
export function generateCityReport(protocolPath: string, options: CityReportOptions = {}): CityReportResult {
 const absolute = path.resolve(protocolPath);
 if (!/\.jsonl$/i.test(absolute)) throw new Error('Ein .jsonl-Protokoll ist erforderlich.');
 const summary = readReportSummary(absolute), htmlPath = absolute.replace(/\.jsonl$/i, '.html');
 const review = loadCityReview(absolute, summary);
 const logPath = absolute.replace(/\.jsonl$/i, '.log');
 const log = summary.logSource === 'original' ? relativeText(readFileSync(logPath, 'utf8'), options) :
  reconstructedLog(summary, options) + '\n\nVOLLSTÄNDIGES QUELLPROTOKOLL (JSONL, einschließlich Fehler / Journal):\n' + relativeText(readFileSync(absolute, 'utf8'), options);
 const renderedLog = renderLog(log, summary);
 const show = (s: unknown) => escapeHtml(relativeText(text(s), options));
 const diary = summary.years.map(y => `<article class="diary-year" id="year${y.year}"><h3>Jahr ${y.year} · ${y.completed ? 'abgeschlossen' : 'unvollständig: kein Jahresergebnis'}</h3>` +
  (y.reasons.length ? y.reasons.map(r => `<p class="reason">${show(r)}</p>`).join('') : '<p class="empty">Keine Begründung im Protokoll gespeichert.</p>') +
  y.errors.map(e => `<p class="error">${show(errorText(e))}</p>`).join('') +
  (y.responses.length ? `<details><summary>${y.responses.length} Modellantworten</summary><ul>${y.responses.map(r => `<li>${show(responseText(r))}</li>`).join('')}</ul></details>` : '') +
  (renderedLog.anchors.has(y.year) ? `<a href="#log-year${y.year}" data-log-target="log-year${y.year}">Zur vollständigen Ausgabe dieses Jahres</a>` : '<p class="note">Keine Jahresmarke in der Originalausgabe vorhanden.</p>') +
  `<details class="year-details"><summary>${y.tools.length} Tool-Ergebnisse${y.termination ? ' · ' + show(y.termination) : ''}</summary>` +
  y.tools.map(t => `<details class="tool"><summary>${show(t.call.name)} · ${obj(t.result).handled === false ? 'nicht ausgeführt' : 'gespeichertes Ergebnis'}</summary><h4>Aufruf</h4><pre>${escapeHtml(displayJson(t.call, options))}</pre><h4>Tatsächliches Ergebnis</h4><pre>${escapeHtml(displayJson(t.result, options))}</pre></details>`).join('') +
  `</details>${y.after ? `<details><summary>Alle gemessenen Jahreswerte</summary><pre>${escapeHtml(displayJson(y.after, options))}</pre></details>` : ''}</article>`).join('');
 const content = `<header><h1>Dipolis · Stadtbericht · ${show(summary.id)}</h1><p class="status ${summary.partial ? 'partial' : ''}">${summary.partial ? 'TEILLAUF / unvollständig' : 'Vollständiger Lauf'} · ${summary.observedYears}/30 abgeschlossene Jahre · ${summary.partialYears} unvollständige Jahre · Ausgabe: ${summary.logSource === 'original' ? 'Original .log' : 'aus dem Protokoll rekonstruiert'}</p></header><section class="card"><dl class="meta">` +
  [['Modell', summary.model], ['Auftrag', summary.assignment], ['Handbuch', summary.handbook], ['Profil', summary.profile], ['Engine-Provenienz', summary.compatibility.label], ['Engine-ID', summary.compatibility.engineId ?? 'nicht dokumentiert'], ['Kompatibilität', summary.compatibility.explanation], ['Lauf', summary.run],
   [summary.dateSource === 'timestamp' ? 'Datum (Protokoll-Zeitstempel)' : 'Datum (Datei-mtime; Altprotokoll ohne Zeitstempel)', new Date(summary.date).toLocaleString('de-DE', { timeZone: 'UTC' }) + ' UTC']]
   .map(([k, v]) => `<div><dt>${show(k)}</dt><dd>${show(v)}</dd></div>`).join('') + `</dl>${renderMetrics(summary)}</section>` +
  (summary.warnings.length ? `<section class="card"><h2>Parser-Hinweise</h2><ul>${summary.warnings.map(w => `<li>${show(w)}</li>`).join('')}</ul></section>` : '') +
  `<p class="event-key">Ereignisse in allen ${summary.charts.length} Diagrammen: Kasse ≤ 0 (gepunktet), erfolgreiche KI-, Farm- und Kraftwerksbauten (eigene Liniencodes und Beschriftungszeilen). Nur built &gt; 0; abgelehnte Aufrufe sind keine Bauereignisse.</p>` +
  summary.charts.map(c => renderChart(c, summary.events)).join('') + renderCityReview(review, summary, show) +
  `<section><h2>Jahrestagebuch</h2>${diary || '<p>Keine Jahresentscheidung gespeichert.</p>'}</section>` + renderedLog.html;
 // Shorten path strings within the inert payload too, never replace numbers or content globally.
 const payload = { charts: summary.charts, logLines: log.split('\n').map((line, i, all) => line + (i < all.length - 1 ? '\n' : '')) };
 writeFileSync(htmlPath, page('Dipolis · Stadtbericht · ' + relativeText(summary.id, options), content, payload), 'utf8');
 return { htmlPath, metrics: summary.metrics, years: summary.years, complete: !summary.partial };
}

/** Index existing siblings only. The caller generates reports first; no implicit run/report generation. */
export function generateReportIndex(directory: string, options: CityReportOptions = {}): ReportIndexResult {
 const absolute = path.resolve(directory), summaries: ReportSummary[] = [], errors: ReportIndexResult['errors'] = [];
 const files = readdirSync(absolute).filter(f => /\.jsonl$/i.test(f)).sort((a, b) => a.localeCompare(b, 'de'));
 for (const file of files) {
  try { summaries.push(readReportSummary(path.join(absolute, file))); }
  catch (error) { errors.push({ file, message: error instanceof Error ? error.message : 'Protokoll nicht lesbar.' }); }
 }
 const show = (s: unknown) => escapeHtml(relativeText(text(s), options));
 const select = (key: 'assignment' | 'handbook') => `<select id="filter-${key}"><option value="">Alle</option>${[...new Set(summaries.map(s => s[key]))].sort().map(v => `<option value="${show(v)}">${show(v)}</option>`).join('')}</select>`;
 const runs = summaries.map((s, i) => ({ id: s.id, assignment: s.assignment, handbook: s.handbook, profile: s.profile,
  series: { ...s.charts[0].series[0], key: s.id, label: relativeText(`${s.id} · ${s.model}`, options), color: COLORS[i % COLORS.length], dash: DASHES[Math.floor(i / COLORS.length) % DASHES.length] } }));
 const skeleton: ReportChart = { id: 'index', title: 'Bevölkerung aller ausgewählten Läufe', note: 'Gemeinsame Jahre 1–30 und Bevölkerungsskala. Filter nach Auftrag / Handbuch; Checkbox-Legende mit Lauf-ID und Modell. Bei vielen Kurven Auswahl einschränken; Einzelwerte im gemeinsamen Hover.', normalized: false, series: [] };
 let chart = renderChart(skeleton, []).replace('<rect class="chart-hit"', '<g class="index-lines"></g><text class="index-scale" x="750" y="300" font-size="11"></text><rect class="chart-hit"');
 // No diary in the index, but individual report links remain available in the run table.
 chart = chart.replace('klicken für Tagebuch', 'gemeinsame Jahreswerte');
 const rows = summaries.map((s, i) => {
  const sibling = s.id + '.html', available = existsSync(path.join(absolute, sibling));
  const loaded = loadCityReview(path.join(absolute, s.id + '.jsonl'), s);
  const grades = REVIEW_CRITERIA.map(k => `<td>${loaded.warning ? 'ungültig' : loaded.review?.status === 'failed' ?
   'fehlgeschlagen' : loaded.review?.judge ? String(loaded.review.judge[k].score) : '—'}</td>`).join('');
  return `<tr data-run-row="${i}"><td>${available ? `<a href="${escapeHtml(encodeURIComponent(sibling))}">${show(s.id)}</a>` : `${show(s.id)}<br><span class="note">HTML noch nicht erzeugt</span>`}<br>${show(s.model)}</td><td>${show(s.assignment)} / ${show(s.handbook)} / ${show(s.run)}<br>${show(s.profile)}<br><strong title="${show(s.compatibility.explanation)}">${show(s.compatibility.label)}</strong></td><td>${show(s.date)}<br>${s.dateSource === 'file-mtime' ? 'Datei-mtime (kein Zeitstempel)' : 'Zeitstempel'}<br>${s.partial ? 'Teillauf' : 'vollständig'} · ${s.observedYears}/30</td>` +
   ['meanResPop', 'finalResPop', 'meanAiPop', 'finalFunds', 'insolventYears', 'lostToHunger'].map(k => `<td>${fmt(s.metrics[k as keyof ReportMetrics])}</td>`).join('') +
   grades + `<td>${[...s.warnings, ...(loaded.review?.adapter === 'fake' ? ['Schein-Adapter – keine inhaltliche Modellbewertung'] : []), ...(loaded.warning ? [loaded.warning] : []),
    ...(loaded.review?.error ? [`Nachbetrachtung fehlgeschlagen (${loaded.review.error.stage}): ${loaded.review.error.message}`] : [])].map(show).join('<br>')}</td></tr>`;
 }).join('');
 const errorRows = errors.map(e => `<tr class="error"><td>${show(e.file)}</td><td colspan="14">${show(e.message)}</td></tr>`).join('');
 const content = `<h1>Dipolis · Stadtmodell · Berichtübersicht</h1><p>${summaries.length} lesbare Protokolle · ${errors.length} Fehler. Teilläufe verwenden nur beobachtete Jahresabschlüsse.</p><section class="card"><label>Auftrag ${select('assignment')}</label><label>Handbuch ${select('handbook')}</label><p><button data-select="all">Alle sichtbaren wählen</button> <button data-select="none">Keine sichtbaren wählen</button></p><output id="selection-count"></output><fieldset class="selection-list"><legend>Kurven auswählen · gruppiert über Auftrag / Handbuch</legend>` +
  summaries.map((s, i) => `<label><input type="checkbox" checked data-run-check="${i}"><span style="color:${runs[i].series.color}">━━</span> ${show(s.assignment)} / ${show(s.handbook)} · ${show(s.id)} · ${show(s.model)}</label>`).join('') +
  `</fieldset></section>${chart}<section class="card table-wrap"><h2>Läufe und letzte Metriken</h2><table><thead><tr>${['Lauf / Modell', 'Auftrag / Handbuch / Nr.', 'Datum / Status', 'Ø Menschen', 'Letzte Menschen', 'Ø KI', 'Letzte Kasse', 'Insolvente Jahre', 'Hunger kumuliert', ...reviewGradeLabels, 'Hinweise'].map(v => `<th>${escapeHtml(v)}</th>`).join('')}</tr></thead><tbody>${rows}${errorRows}</tbody></table></section>`;
 const htmlPath = path.join(absolute, 'index.html');
 writeFileSync(htmlPath, page('Dipolis · Stadtmodell · Berichtübersicht', content, { runs, charts: [] }), 'utf8');
 return { htmlPath, summaries, errors };
}