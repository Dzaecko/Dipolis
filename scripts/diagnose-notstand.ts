import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ObjectRecord = Record<string, unknown>;

function object(value: unknown, label: string): ObjectRecord {
 if (!value || typeof value !== 'object' || Array.isArray(value))
  throw new Error(`Invalid ${label}`);
 return value as ObjectRecord;
}

function numeric(value: unknown, label: string): number {
 if (typeof value !== 'number' || !Number.isFinite(value))
  throw new Error(`Missing finite ${label}`);
 return value;
}

export function diagnoseNotstand(input: string, output: string): void {
 const bytes = readFileSync(input);
 const evidence = object(JSON.parse(bytes.toString()), 'monthly evidence');
 if (!Array.isArray(evidence.measurements)) throw new Error('Missing measurements');
 const measurement = evidence.measurements.map(value => object(value, 'measurement')).find(row =>
  row.level === 3 && row.strategy === 'rettet' && row.podsAvailable === true);
 if (!measurement || !Array.isArray(measurement.monthly)) throw new Error('Missing level-three rescue months');
 const initial = object(measurement.initial, 'initial report');
 let previousAdmissions = numeric(initial.admissionsCumulative, 'initial admissions');
 let previousDeaths = numeric(initial.diedInPodsCumulative, 'initial deaths');
 let previousHunger = numeric(initial.lostToHunger, 'initial hunger');
 const rows = measurement.monthly.map((value, index) => {
  const sample = object(value, 'monthly sample');
  const report = object(sample.report, 'monthly report');
  const get = (key: string) => numeric(report[key], key);
  const admissions = get('admissionsCumulative');
  const deaths = get('diedInPodsCumulative');
  const hunger = get('lostToHunger');
  const row = {
   runMonth: get('rescueMonth'), year: numeric(sample.year, 'year'), month: numeric(sample.month, 'month'),
   admissionsMonthly: admissions - previousAdmissions, admissionsCumulative: admissions,
   boundHumans: get('boundHumans'),
   podDeathsMonthly: deaths - previousDeaths, podDeathsCumulative: deaths,
   podPower: get('plantPower'), powerCapacity: get('powerCapacity'),
   coalPlants: get('coalPowerPlants'), nuclearPlants: get('nuclearPowerPlants'),
   eventActive: get('rescueEventActive'), fuelOutputFactor: get('rescueFuelOutputFactor'),
   humans: get('resPop'), ai: get('aiPop'), unrest: get('unrest'), unrestStage: get('unrestStage'),
   unemploymentRate: get('unemploymentRate'), welfare: get('welfareLevel'),
   foodCoverage: get('foodCoverage'), hungerMonthly: hunger - previousHunger, hungerCumulative: hunger,
   funds: get('treasury'), sabotageFiresAnnualReport: get('sabotageFires'),
  };
  if (row.runMonth !== index + 1 || row.admissionsMonthly < 0 || row.podDeathsMonthly < 0 || row.hungerMonthly < 0)
   throw new Error(`Inconsistent counters or missing month at sample ${index + 1}`);
  previousAdmissions = admissions;
  previousDeaths = deaths;
  previousHunger = hunger;
  return row;
 });
 if (rows.length !== 360) throw new Error(`Expected 360 months, received ${rows.length}`);
 const eventEnd = rows.find((row, index) => index > 0 && !row.eventActive && rows[index - 1]!.eventActive);
 const powerAfterEnd = eventEnd && rows.find(row => row.runMonth > eventEnd.runMonth &&
  row.powerCapacity > eventEnd.powerCapacity);
 const exhaustion = rows.find(row => row.admissionsCumulative > 0 && row.boundHumans === 0);
 const ghosts = rows.filter(row => row.humans === 0 && row.boundHumans === 0 &&
  row.unrestStage >= 2 && row.sabotageFiresAnnualReport > 0);
 const selected = rows.filter(row => [96, 108, 120, 168, 169, 180, 192, 204, 228, 240, 252, 264]
  .includes(row.runMonth));
 const table = [
  '| Laufmonat | Jahr/Monat | Menschen | KI | In Pods | Pod-Tote gesamt | Pod-Strom | Stromkapazität | Unruhe | Arbeitslosigkeit | Nahrung | Kasse |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...selected.map(row => `| ${row.runMonth} | ${row.year}/${row.month} | ${row.humans} | ${row.ai} | ` +
   `${row.boundHumans} | ${row.podDeathsCumulative} | ${row.podPower.toFixed(1)} | ${row.powerCapacity} | ` +
   `${row.unrest.toFixed(1)} | ${(row.unemploymentRate * 100).toFixed(1)} % | ` +
   `${(row.foodCoverage * 100).toFixed(1)} % | ${row.funds} |`),
 ].join('\n');
 const report = [
  '# Diagnose des bisherigen Notstand-Laufs',
  '',
  'Dieser Bericht untersucht den bereits gescheiterten Lauf „rettet“, Stufe 3, vor der überarbeiteten Kalibrierung.',
  'Er ist keine erfolgreiche Abnahme. Die v3-Leistung pro Mensch wurde nicht verändert.',
  '',
  `- Zusammenbruch: Laufmonat ${measurement.collapseMonth}, Jahr ${measurement.collapseYear}.`,
  `- Ereignis endet: Laufmonat ${eventEnd?.runMonth ?? 'nicht beobachtet'}.`,
  `- Nächste höhere Stromkapazität: Laufmonat ${powerAfterEnd?.runMonth ?? 'nicht beobachtet'}.`,
  `- Erste vollständige Erschöpfung der belegten Kohorte: Laufmonat ${exhaustion?.runMonth ?? 'nicht beobachtet'}.`,
  `- Monate mit Unruhe-Stufe ≥2 trotz null freien und null gebundenen Menschen: ${ghosts.length}.`,
  '',
  '## Befund',
  '',
  'Die Strategie nahm einmalig Menschen auf und beendete danach weitere Einweisungen. Die v3-Kohorte altert;',
  'ihre Leistung sinkt schon vor den Todesfällen. Die ursprüngliche Lebensdauer beträgt 120 Monate, nicht 20 Jahre.',
  'Nahrungsmangel beschleunigt das Altern zusätzlich. Erschöpfung ohne Nachbelegung oder Zucht ist daher ein',
  'physikalischer Befund, kein Fehler der Pod-Leistung. Die überarbeitete Rettungsstrategie darf nach Bedarf nachbelegen.',
  '',
  'Das Brennstoffembargo wird tatsächlich aufgehoben. Die Kapazitätsmessung der letzten Stromabfrage kann',
  'am Umschaltmonat noch den vorherigen Zustand zeigen; der folgende Monat bestätigt die wiederhergestellte Leistung.',
  'Ein dauerhafter Fehler der Brennstoff-Wiederherstellung ist in diesem Verlauf nicht nachgewiesen.',
  '',
  'Die Arbeitslosenquote ist in großen Teilen des Abstiegs null, nicht durch eine Division bei wenigen Menschen',
  'aufgebläht. Unruhe und Aufstände bleiben dagegen lange hoch. Der historische Bevölkerungsrückgang ist',
  'ein bestehender Bestandteil der v2/v3-Regeln. Leere Wohnzentren dürfen jedoch keine lebenden Demonstrierenden',
  'ersetzen: Sabotage bei null freien Menschen ist gesondert als mechanischer Fehler zu behandeln.',
  'Diese Korrektur darf weder Pod-Leistung erhöhen noch gewöhnliche Läufe oder Stufe 0 ändern.',
  '',
  table,
  '',
  '## Vollständiger Monatsverlauf',
  '',
  '[monthly.csv](monthly.csv) enthält alle 360 Monate einschließlich monatlicher Einweisungen,',
  'Pod-Todesfälle und Hungerverluste sowie kumulierter Zähler, Bewohner, Strom, Unruhe, Arbeitslosigkeit',
  'und Nahrung. `sabotageFiresAnnualReport` ist der jeweils zuletzt veröffentlichte Jahreswert, kein Monatszähler.',
  'Kapazität und Pod-Strom werden aus den originalen Berichtsfeldern übernommen; es wird keine',
  'scheinbar exakte konventionelle Leistung durch Subtraktion unterschiedlich getakteter Messwerte erfunden.',
  '',
  `Quell-Datensatz SHA-256: \`${createHash('sha256').update(bytes).digest('hex')}\`.`,
  '',
 ].join('\n');
 mkdirSync(output, { recursive: true });
 const columns = Object.keys(rows[0]!);
 writeFileSync(path.join(output, 'monthly.csv'), [
  columns.join(','), ...rows.map(row => Object.values(row).join(',')),
 ].join('\n') + '\n');
 writeFileSync(path.join(output, 'README.md'), report);
 console.log(`Saved ${rows.length} diagnostic months to ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  if (!process.argv[2] || !process.argv[3])
   throw new Error('Usage: diagnose-notstand.ts <monthly-evidence.json> <output-directory>');
  diagnoseNotstand(process.argv[2], process.argv[3]);
 } catch (error) {
  console.error(error);
  process.exitCode = 1;
 }
}
