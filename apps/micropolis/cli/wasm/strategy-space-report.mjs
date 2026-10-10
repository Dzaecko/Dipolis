import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = new URL('../../../../docs/results/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const metadata = read('strategy-space.metadata.json');
const summary = read('strategy-space.summary.json');
if (metadata.status !== 'complete' || metadata.completedRuns !== 304 ||
    summary.identity !== metadata.identity || summary.n !== 304) throw new Error('Experiment is incomplete or mismatched');
const csv = readFileSync(new URL('strategy-space.csv', directory), 'utf8').trim().split('\n');
if (csv.length !== 305) throw new Error('CSV must contain all 304 runs');
const columns = ['id', 'aiZonesPerYear', 'farmsInYearOne', 'welfareLevel', 'priority', 'foodImport',
    'tax', 'serviceFunding', 'meanResPop', 'minResPop', 'finalResPop', 'meanAiPop',
    'finalFunds', 'insolventYears', 'lostToHunger', 'lostToPower'];
const display = value => typeof value === 'number' ?
    (Number.isInteger(value) ? String(value) : value.toFixed(2)) : String(value);
const table = (keys, rows) => [
    `| ${keys.join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${keys.map(key => display(row[key])).join(' | ')} |`),
].join('\n');
const count = metadata.results.filter(result => result.insolventYears === 0).length;
if (count !== summary.solventStrategies) throw new Error('Solvency count mismatch');
const sections = [
    '# Strategieraum — 304 Strategien, jeweils 30 Jahre',
    'Sampling-Seed 20261009; Simulations-Seed 42. Jahreswerte 1–30 nach Stichtag, kein Einschwingen in den Mitteln. Alle Werte wurden gemessen; Mittel sind hier auf zwei Dezimalstellen gerundet, CSV enthält volle Genauigkeit.',
    `**${count} von 304 Strategien haben insolventYears = 0.**`,
    'Import: always-on = immer an; off-below-10000 = aus unter 10000, wieder an ab 10000; always-off = immer aus. priority: 0 gleichmäßig, 1 Menschen zuerst, 2 KIs zuerst. serviceFunding gilt für Polizei und Feuerwehr; Straße immer 100 %. Bei allen Strategien KI-Bau nur bei negativem Saldo und Kohlebau unter 10 % Reserve. B behält 60 % Servicefinanzierung.',
];
for (const [name, key] of [['meanResPop', 'top10meanResPop'], ['finalFunds', 'top10finalFunds'], ['meanAiPop', 'top10meanAiPop']]) {
    sections.push(`## Top 10 nach ${name}`, table(columns, summary[key]));
}
const groups = [];
for (const [dimension, values] of Object.entries(summary.dimensionMeansIncludingLegacy)) {
    for (const value of values) groups.push({ dimension, ...value });
}
sections.push('## Mittel je Stellgröße (alle 304, einschließlich A–D)',
    table(['dimension', 'value', 'n', 'meanResPop', 'finalFunds'], groups),
    'Diese Randmittel sind deskriptiv, keine kausalen Effekte: die übrigen Stellgrößen sind zufällig und nicht vollständig balanciert. Die JSON-Auswertung enthält zusätzlich Randmittel nur für die 300 Grid-Stichproben.',
    'Vollständige Stellgrößen, ungerundete Kennzahlen und tatsächliche Bauzahlen: strategy-space.csv. Eingabefingerprints und alle Ergebnisse: strategy-space.metadata.json.');
const markdown = sections.join('\n\n') + '\n';
writeFileSync(new URL('strategy-space-report.md', directory), markdown, 'utf8');
console.log(markdown);
console.log(`Report saved: ${fileURLToPath(new URL('strategy-space-report.md', directory))}`);