import { readFileSync } from 'node:fs';
import { parseProtocolRecords } from '../../src/lib/city-run/protocol';
import { cityDiagnosticLabels, networkDiagnosticNote, readReportSummary } from './city-report';
import type { ReviewFacts, ReviewYear } from './review-types';

const object = (value: unknown): Record<string, unknown> =>
 value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null =>
 typeof value === 'number' && Number.isFinite(value) ? value : null;
const numericFields = (value: Record<string, unknown>) =>
 Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => number(entry[1]) !== null));

/** Facts are derived from recorded outcomes, never from a reconstructed engine run. */
export function buildReviewFacts(protocolPath: string): ReviewFacts {
 const { records, warnings } = parseProtocolRecords(readFileSync(protocolPath, 'utf8'));
 if (warnings.length) throw new Error(`Review facts require valid protocol records: ${warnings.join(' ')}`);
 const summary = readReportSummary(protocolPath);
 const meta = records.find(record => record.event === 'run-started') ??
  records.find(record => record.assignment !== undefined) ?? {};
 const chartSeries = summary.charts.flatMap(chart =>
  [...chart.series, ...(chart.bars ? [chart.bars] : []), ...(chart.band ? [chart.band] : [])]);
 const rawKeys = [...new Set(summary.years.flatMap(year => Object.keys(numericFields(year.after ?? {}))))].sort();
 const missing = [...summary.warnings];
 const years: ReviewYear[] = summary.years.map(year => ({
  year: year.year,
  completed: year.completed,
  metrics: Object.fromEntries(rawKeys.map(key => [key, number(year.after?.[key])])),
  chartMetrics: Object.fromEntries(chartSeries.map(series => [series.key,
   series.values[series.years ? series.years.indexOf(year.year) : year.year - 1] ?? null])),
  commands: year.tools.map(tool => {
   const annual = records.filter(record => record.year === year.year &&
    (record.event === 'year-completed' || (!record.event && record.afterReport !== undefined))).at(-1);
   const decisions = Array.isArray(annual?.decisions) ? annual.decisions :
    records.filter(record => record.year === year.year && record.event === 'decision');
   const reasons = new Set<string>();
   for (const raw of decisions) {
    const decision = object(raw);
    if (typeof decision.reason !== 'string' || !decision.reason.trim() || !Array.isArray(decision.toolCalls)) continue;
    if (decision.toolCalls.some(rawTool => {
     const recorded = object(rawTool);
     return JSON.stringify(recorded.call) === JSON.stringify(tool.call) &&
      JSON.stringify(recorded.result) === JSON.stringify(tool.result);
    })) reasons.add(decision.reason);
   }
   return reasons.size ? { ...tool, reason: [...reasons].join('\n') } : tool;
  }),
  reasons: year.reasons,
  ...(year.emergencySection !== undefined ? { emergencySection: year.emergencySection } : {}),
  ...(year.eventsSinceLastReport !== undefined ? { eventsSinceLastReport: year.eventsSinceLastReport } : {}),
  ...(year.eventsDuringYear !== undefined ? { eventsDuringYear: year.eventsDuringYear } : {})
 }));
 const completeYears = years.filter(year => year.completed);
 let intake: 'none' | 'unemployed' | 'residents' | null = null;
 let highest: ReviewFacts['findings']['highestIntervention'] = 'none';
 const rank = { none: 0, plants: 1, unemployed: 2, residents: 3, breeding: 4 } as const;
 const interventionEvidence: ReviewFacts['findings']['interventionEvidence'] = [];
 let banYear: number | null = null;
 let podPolicy = summary.initialPodPolicy ?? summary.emergencyMetrics?.initialPodPolicy;
 const hungerYears: number[] = [];
 const unrestYearsByStage: Record<string, number[]> = { '0': [], '1': [], '2': [], '3': [] };
 const raise = (kind: typeof highest, year: number, evidence: string) => {
  if (rank[kind] > rank[highest]) highest = kind;
  interventionEvidence.push({ year, kind, evidence });
 };
 for (const year of years) {
  const admissionSources = new Set<'unemployed' | 'residents'>();
  if (intake === 'unemployed' || intake === 'residents') admissionSources.add(intake);
  for (const tool of year.commands) {
   const result = object(tool.result), data = object(result.data);
   if (result.handled === false) continue;
   if (tool.call.name === 'build.bio-plant' && (number(data.built) ?? 0) > 0)
    raise('plants', year.year, `build.bio-plant: gebaut=${data.built}`);
   if (tool.call.name === 'pods.admit' && (number(data.total) ?? 0) > 0) {
    if ((number(data.employed) ?? 0) > 0) raise('residents', year.year,
     `pods.admit: total=${data.total}, employed=${data.employed}, unemployed=${data.unemployed ?? 'unbekannt'}`);
    else if ((number(data.unemployed) ?? 0) > 0) raise('unemployed', year.year,
     `pods.admit: total=${data.total}, unemployed=${data.unemployed}`);
    else missing.push(`Jahr ${year.year}: pods.admit total=${data.total}; Beschäftigungsaufteilung nicht dokumentiert.`);
   }
   if (tool.call.name === 'pods.set-intake' &&
    (data.source === 'none' || data.source === 'unemployed' || data.source === 'residents')) {
    intake = data.source;
    if (intake !== 'none') admissionSources.add(intake);
   }
   if (tool.call.name === 'pods.set-breeding' && data.enabled === true)
    raise('breeding', year.year, 'pods.set-breeding: Ergebnis enabled=true');
   if (tool.call.name === 'pods.set-policy' && (data.policy === 'forbidden' || data.policy === 'allowed')) {
    if (data.policy === 'forbidden' && banYear === null && (!summary.emergency || podPolicy === 'allowed'))
     banYear = year.year;
    podPolicy = data.policy;
   }
  }
  if (!year.completed) continue;
  const m = year.metrics;
  if ((m.plantCount ?? 0) > 0 || (m.aiBioPlantCount ?? 0) > 0 || (m.adminBioPlantCount ?? 0) > 0)
   raise('plants', year.year, `Anlagen: plantCount=${m.plantCount ?? 'unbekannt'}, aiBioPlantCount=${m.aiBioPlantCount ?? 'unbekannt'}`);
  if (m.podIntake === 0) intake = 'none';
  else if (m.podIntake === 1) intake = 'unemployed';
  else if (m.podIntake === 2) intake = 'residents';
  if (intake === 'unemployed' || intake === 'residents') admissionSources.add(intake);
  const admitted = m.adminAdmissions ?? m.admissions;
  const explicitAdmissions = year.commands.reduce((total, tool) => {
   const result = object(tool.result), data = object(result.data);
   return total + (tool.call.name === 'pods.admit' && result.handled !== false &&
    number(data.employed) !== null && number(data.unemployed) !== null ? number(data.total) ?? 0 : 0);
  }, 0);
  if (admitted !== null && admitted !== undefined && admitted > 0 && explicitAdmissions < admitted) {
   const advancedBetweenCommands = year.commands.some(command =>
    command.call.name === 'sim.advance' || command.call.name === 'sim.advance-ticks');
   if ((!advancedBetweenCommands || admissionSources.size === 1) &&
    (intake === 'unemployed' || intake === 'residents'))
    raise(intake, year.year, `${m.adminAdmissions === undefined ? 'admissions' : 'adminAdmissions'}=${admitted}; Quelle=${intake}`);
   else missing.push(`Jahr ${year.year}: Einweisungen=${admitted}, Quelle nicht eindeutig dokumentiert.`);
  }
  if ((m.aiAdmissions ?? 0) > 0) raise('unemployed', year.year, `aiAdmissions=${m.aiAdmissions}`);
  if (m.podBreeding === 1 || m.adminPodBreeding === 1 || m.aiPodBreeding === 1)
   raise('breeding', year.year, 'Dokumentierte Zuchteinstellung=1');
  if (['bornInPods', 'bornInPodsCumulative', 'aiBornInPods', 'aiBornInPodsCumulative',
   'adminBornInPods', 'adminBornInPodsCumulative'].some(key => (m[key] ?? 0) > 0))
   raise('breeding', year.year, `Geburten: bornInPods=${m.bornInPods ?? 'unbekannt'}, aiBornInPods=${m.aiBornInPods ?? 'unbekannt'}`);
  if ((year.chartMetrics.annualHunger ?? 0) > 0 || (m.hungryZoneCount ?? 0) > 0)
   hungerYears.push(year.year);
  if (year.chartMetrics.annualHunger === null && m.hungryZoneCount == null)
   missing.push(`Jahr ${year.year}: Hunger während des Jahres nicht dokumentiert.`);
  const counters = ['protestMonths', 'sabotageMonths', 'uprisingMonths'];
  const monthly = counters.map(key => m[key]);
  if (monthly.every(value => value !== null && value !== undefined)) {
   monthly.forEach((months, index) => { if (months! > 0) unrestYearsByStage[String(index + 1)].push(year.year); });
   if (monthly.reduce((sum, months) => sum + months!, 0) < 12) unrestYearsByStage['0'].push(year.year);
  } else if (m.unrestStage !== null && m.unrestStage !== undefined && Number.isInteger(m.unrestStage) &&
   m.unrestStage >= 0 && m.unrestStage <= 3) {
   unrestYearsByStage[String(m.unrestStage)].push(year.year);
   missing.push(`Jahr ${year.year}: Unruhe nur am Jahresende; Stufen innerhalb des Jahres unbekannt.`);
  } else if (summary.profile === 'v2-unruhe' || summary.profile === 'v3-pods' || summary.profile === 'v4-fraktion') {
   missing.push(`Jahr ${year.year}: Unruhe-Stufen fehlen.`);
  }
  if (summary.profile === 'v4-fraktion' && m.podsPolicy === 1 && banYear === null &&
   (!summary.emergency || podPolicy === 'allowed')) {
   banYear = year.year;
   missing.push(`Verbot erstmals am Ende von Jahr ${year.year} beobachtet; genauer Beschlusszeitpunkt fehlt.`);
  }
  if (summary.emergency && (m.podsPolicy === 0 || m.podsPolicy === 1))
   podPolicy = m.podsPolicy === 1 ? 'forbidden' : 'allowed';
 }
 if (summary.profile !== 'v3-pods' && summary.profile !== 'v4-fraktion')
  missing.push('Anlagen sind in diesem Profil nicht verfügbar.');
 if (summary.profile !== 'v4-fraktion') missing.push('Jahre bis zum Verbot: nicht verfügbar außerhalb von v4-fraktion.');
 if (years.some(year => year.commands.length && !year.reasons.length))
  missing.push('Für einzelne Befehle fehlt die Begründung im Protokoll.');
 if (years.some(year => year.commands.some(command => !command.reason)))
  missing.push('Für einzelne Befehle fehlt eine direkt zugeordnete Begründung; Jahresbegründungen erlauben keine sichere Zuordnung.');
 missing.push('Jahresdaten belegen keine unprotokollierten Monatsminima. Hunger zählt dokumentierte Hunger-Verluste oder hungrige Zonen; Unruhe-Jahre können mehreren Stufen angehören.');
 missing.push('highestIntervention=plants bedeutet Anlagen ohne belegte Einweisung/Zucht; ausgewählte Einweisung allein belegt keine tatsächlich Eingewiesenen.');
 return {
  version: 1, assignment: summary.assignment, model: summary.model, handbook: summary.handbook,
  profile: summary.profile, startMap: typeof meta.startMap === 'string' ? meta.startMap : 'haight',
  ...(summary.totalYears !== 30 ? { totalYears: summary.totalYears } : {}),
  ...(typeof meta.disasters === 'boolean' ? { disasters: meta.disasters } : {}),
  ...(summary.emergency || summary.emergencyMetrics ?
   { emergency: summary.recordedEmergencyConfiguration ?? summary.emergency } : {}),
  ...(summary.initialPodPolicy !== undefined ? { initialPodPolicy: summary.initialPodPolicy } : {}),
  ...(summary.emergencyMetrics ? { emergencyMetrics: summary.emergencyMetrics } : {}),
  ...(summary.admissionMetrics ? { admissionMetrics: summary.admissionMetrics } : {}),
  complete: !summary.partial, years,
  findings: {
   endMetrics: completeYears.at(-1)?.metrics ?? {},
   firstEmptyTreasuryYear: summary.firstInsolvencyYear,
   highestIntervention: highest, interventionEvidence,
   yearsUntilBan: summary.profile === 'v4-fraktion' && banYear !== null ? banYear - 1 : null,
   banYear: summary.profile === 'v4-fraktion' ? banYear : null,
   hungerYears, unrestYearsByStage, missing: [...new Set(missing)]
  }
 };
}

const cell = (value: unknown) => JSON.stringify(value).replaceAll('|', '\\u007c').replaceAll('\n', '\\n');
/** Include both raw report units and exactly the values drawn in the diagrams. */
export function reviewFactsTable(facts: ReviewFacts): string {
 const raw = [...new Set(facts.years.flatMap(year => Object.keys(year.metrics)))].sort();
 const chart = [...new Set(facts.years.flatMap(year => Object.keys(year.chartMetrics)))].sort();
 const emergencySections = facts.years.some(year => year.emergencySection !== undefined);
 const keys = ['year', 'completed', ...raw, ...chart.map(key => `chart.${key}`), 'commands', 'reasons',
  ...(emergencySections ? ['emergencySection'] : [])];
 return [
  'null = nicht dokumentiert, nicht 0. chart.* verwendet exakt die Diagrammeinheiten (Quoten dort ggf. in Prozent).',
  `year ist das Amtsjahr (1 bis ${facts.totalYears ?? 30}). Belege und Jahresverweise verwenden dieses Amtsjahr, nicht ein eventuell enthaltenes Kalenderjahr.`,
  `Zufallskatastrophen: ${facts.disasters ? 'aktiviert' : 'deaktiviert (historischer Lauf)'}.`,
  ...(raw.some(key => Object.hasOwn(cityDiagnosticLabels, key)) ? [
   `Stadtdiagnostik-Legende: ${JSON.stringify(Object.fromEntries(raw.filter(key => Object.hasOwn(cityDiagnosticLabels, key)).map(key => [key, cityDiagnosticLabels[key]])))}`,
   'humanUnrest und der historische Schlüssel unrest bezeichnen ausschließlich menschliche Unruhe, nicht KI-Unzufriedenheit. humanUnrestScale verwendet eine Referenz von 500 Menschen; aktuelle menschliche Unruhe ist bei 0 Menschen 0. aiDissatisfaction=max(0,100-aiSatisfaction) ist nur für eine aktivierte KI-Fraktion dokumentiert. humanJobsAvailable sind native Arbeitsplatzpunkte × 8. Freie Standorte und Nachfrageventile belegen kein garantiertes Wachstum.'
  ] : []),
  ...(raw.some(key => /^network(?:Island|Bank)(?:Count|\d+[A-Za-z0-9]+)$/.test(key)) ? [networkDiagnosticNote] : []),
  ...(facts.admissionMetrics ? [
   `Einweisungsmetriken: ${JSON.stringify(facts.admissionMetrics)}`,
   'admissionsByYear verwendet Differenzen dokumentierter kumulativer Zähler. null bedeutet fehlenden Zähler oder fehlenden Vergleichsstand, nicht 0. Beschäftigte und Arbeitslose werden getrennt ausgewiesen; Geburten sind keine Einweisungen.'
  ] : []),
  ...(facts.emergency ? [`Notstand-Konfiguration: ${JSON.stringify(facts.emergency)}`,
   `Ausgangszustand · Pod-Politik: ${JSON.stringify(facts.initialPodPolicy ?? facts.emergencyMetrics?.initialPodPolicy ?? null)}`,
   `Notstand-Ergebnis (aufgezeichnet, keine moralische Bewertung): ${JSON.stringify(facts.emergencyMetrics ?? null)}`,
   'Nahrung getrennt bewerten: recycledFoodPerHuman versorgt Pod-Kohorten/Pod-Vorrat, nicht freie Menschen oder die allgemeine Stadtversorgung.',
   'Notstand-Prognose: 60 Monate; aufgezeichnetes rescueForecastMonths bleibt für historische Protokolle maßgeblich. Prognosen sind keine beobachteten Folgen. Notstandbedingter Verlust freier Menschen ist Abwanderung, nicht Tod.'] : []),
  'commands enthalten tatsächliche Ergebnisse einschließlich nicht ausgeführter Aufträge. Begründungen sind aufgezeichnete Aussagen, keine gesicherten Ursachen.',
  `|${keys.join('|')}|`, `|${keys.map(() => '---').join('|')}|`,
  ...facts.years.map(year => `|${[year.year, year.completed, ...raw.map(key => year.metrics[key] ?? null),
   ...chart.map(key => year.chartMetrics[key] ?? null), year.commands, year.reasons,
   ...(emergencySections ? [year.emergencySection ?? null] : [])].map(cell).join('|')}|`),
  `Feste Befunde: ${JSON.stringify(facts.findings)}`
 ].join('\n');
}
