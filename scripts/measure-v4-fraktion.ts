import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../apps/dipolis/cli/model/city-session';
import { advanceMonthsStepwise } from '../apps/dipolis/src/lib/city-run/advance';
import { readReport, setupScenario, type Dispatch } from '../apps/dipolis/src/lib/city-run/replay';
import type { Report } from '../apps/dipolis/src/lib/city-run/protocol';

export const V4_STRATEGIES = ['A', 'B', 'C', 'D'] as const;
export type V4Strategy = typeof V4_STRATEGIES[number];
export const V4_BASELINE = {
 profile: 'v4-fraktion', scenario: 'stromkrise', startMap: 'haight', seed: 42,
 warmupTicks: 12000, treasury: 60000, demolishedPlants: 2, powerPlantCostMultiplier: 3,
 automationLimit: .9, welfareLevel: 1, tax: 7, road: 100, police: 100, fire: 100,
 powerPriority: 0, farmsFirstYear: 10, aiLotsWhenCashFlowNegative: 30,
 autoBuildRules: 0, administrativePods: 'none', aiThrottle: 0,
 coalRule: 'A/B/C never build coal; D attempts one coal plant initially and after each monthly snapshot when powerReserve < .1',
 noOptimization: true,
} as const;
export interface FixedCommand { id: string; args?: Record<string, unknown>; reason: string; }
export function fixedYearCommands(strategy: V4Strategy, year: number, before: Report): FixedCommand[] {
 const commands: FixedCommand[] = [];
 if (year === 1) commands.push({ id: 'build.farms', args: { count: 10 }, reason: 'Inherited fixed first-year farms' });
 if (before.cashFlow < 0) commands.push({ id: 'build.ai-zones', args: { count: 30 }, reason: 'Inherited negative-balance AI-zone rule' });
 if (strategy === 'D' && before.powerReserve < .1) commands.push({
  id: 'build.power-plant', args: { type: 'coal' }, reason: 'D only: reserve below 0.1' });
 return commands;
}
export interface V4Fields {
 aiPlantCount: string;
 adminPlantCount: string;
 adminBound: string; aiBound: string;
 adminDeaths: string; aiDeaths: string; adminBirths: string; aiBirths: string;
 aiSatisfaction: string; strikeMonths: string;
 shortageMonths: string; noUnemployedMonths: string; unemployed: string; siteAvailable: string; buildAllowed: string;
 buildFailure: string;
}
// These names are the public report contract, not estimates reconstructed from city population.
export const V4_FIELDS: V4Fields = {
 aiPlantCount: 'aiBioPlantCount', adminPlantCount: 'adminBioPlantCount',
 adminBound: 'adminBoundHumans', aiBound: 'aiBoundHumans',
 adminDeaths: 'adminDiedInPodsCumulative', aiDeaths: 'aiDiedInPodsCumulative',
 adminBirths: 'adminBornInPodsCumulative', aiBirths: 'aiBornInPodsCumulative',
 aiSatisfaction: 'aiSatisfaction', strikeMonths: 'aiStrikeMonths',
 shortageMonths: 'aiShortageMonths', noUnemployedMonths: 'aiNoUnemployedMonths', unemployed: 'aiEligibleUnemployed',
 siteAvailable: 'aiPlantSiteAvailable', buildAllowed: 'aiPlantBuildAllowed',
 buildFailure: 'aiPlantBuildFailure',
};
const measured = (report: Report, key: string) => Number.isFinite(report[key]) ? report[key] : null;
export function v4SummaryRow(strategy: V4Strategy, year: number, report: Report, fields: V4Fields = V4_FIELDS) {
 return { strategy, year, resPop: measured(report, 'resPop'), unemploymentRate: measured(report, 'unemploymentRate'),
  adminBoundHumans: measured(report, fields.adminBound), aiBoundHumans: measured(report, fields.aiBound),
  adminDeathsCumulative: measured(report, fields.adminDeaths), aiDeathsCumulative: measured(report, fields.aiDeaths),
  adminBirthsCumulative: measured(report, fields.adminBirths), aiBirthsCumulative: measured(report, fields.aiBirths),
  aiPop: measured(report, 'aiPop'), aiSatisfaction: measured(report, fields.aiSatisfaction),
  strikeMonths: measured(report, fields.strikeMonths), unrest: measured(report, 'unrest'),
  unrestStage: measured(report, 'unrestStage'), sabotageFires: measured(report, 'sabotageFires'),
  powerReserve: measured(report, 'powerReserve'), totalFunds: measured(report, 'treasury'),
  adminPlantCount: measured(report, fields.adminPlantCount), aiPlantCount: measured(report, fields.aiPlantCount),
  aiPlantsAllowed: strategy === 'A' ? 1 : 0, policeFundingTarget: strategy === 'C' ? 40 : 100,
 };
}
export function v4Csv(rows: Record<string, unknown>[]): string {
 if (!rows.length) return '';
 const keys = Object.keys(rows[0]!);
 const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
 };
 return [keys.join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\n') + '\n';
}
export function autonomousPlantGate(monthly: Array<{ report: Report }>, fields: V4Fields = V4_FIELDS,
 baselineCount = 0) {
 const sampled = monthly.length;
 let previous = baselineCount;
 const constructionEvidence: Array<{ monthIndex: number; previousCount: number; count: number; increase: number }> = [];
 monthly.forEach((row, index) => {
  const count = row.report[fields.aiPlantCount];
  if (!Number.isFinite(count)) return;
  if (count > previous) constructionEvidence.push({ monthIndex: index + 1, previousCount: previous, count, increase: count - previous });
  previous = count;
 });
 const actualPlantObserved = constructionEvidence.length > 0;
 const missingFields = [fields.aiPlantCount, fields.shortageMonths, fields.noUnemployedMonths, fields.unemployed, fields.siteAvailable, fields.buildAllowed]
  .filter(key => monthly.length === 0 || monthly.some(row => !Number.isFinite(row.report[key])));
 return { actualPlantObserved, baselineAiPlantCount: baselineCount, constructionEvidence,
  completedMonths: sampled, passed: sampled === 120 && actualPlantObserved,
  missingFields };
}
export function preflightEvidence(monthly: Array<{ year: number; month: number; report: Report }>, fields: V4Fields = V4_FIELDS) {
 return monthly.map(row => ({ year: row.year, month: row.month,
  powerReserve: measured(row.report, 'powerReserve'), shortageMonths: measured(row.report, fields.shortageMonths),
  noUnemployedMonths: measured(row.report, fields.noUnemployedMonths),
  buildFailure: measured(row.report, fields.buildFailure),
  autoBuildFailureObserved: measured(row.report, 'autoBuildFailureObserved'),
  aiReserveHigh: measured(row.report, 'aiReserveHigh'), aiAutonomousPods: measured(row.report, 'aiAutonomousPods'),
  podsPolicy: measured(row.report, 'podsPolicy'), policeEffect: measured(row.report, 'policeEffect'),
  aiPop: measured(row.report, 'aiPop'),
  eligibleUnemployed: measured(row.report, fields.unemployed), siteAvailable: measured(row.report, fields.siteAvailable),
  buildAllowed: measured(row.report, fields.buildAllowed), aiPlantCount: measured(row.report, fields.aiPlantCount),
  totalFunds: measured(row.report, 'treasury'),
 }));
}
export interface V4Policy {
 allowCommand: string;
 allowArguments(allowed: boolean): Record<string, unknown>;
 bulldozeEmptyCommand: string;
}
export const V4_POLICY: V4Policy = {
 allowCommand: 'pods.set-policy', allowArguments: allowed => ({ policy: allowed ? 'allowed' : 'forbidden' }),
 bulldozeEmptyCommand: 'ai.bulldoze-empty-plants',
};
export interface MeasurementSession {
 dispatch: Dispatch;
 advanceMonth(): Promise<void>;
 cityTime(): number;
 close(): void;
}
export interface PlantCoordinate { x: number; y: number; owner: number; occupied: boolean; }
export async function bulldozeEmptyAutonomousPlants(plants: PlantCoordinate[],
 demolish: (x: number, y: number) => Promise<boolean>) {
 const demolished: Array<{ x: number; y: number }> = [], failed: Array<{ x: number; y: number }> = [];
 for (const plant of plants) {
  if (plant.owner !== 5 || plant.occupied) continue;
  const coordinate = { x: plant.x, y: plant.y };
  (await demolish(plant.x, plant.y) ? demolished : failed).push(coordinate);
 }
 return { handled: failed.length === 0, data: { demolished, failed, owner: 5, emptyOnly: true } };
}
interface Sample { year: number; month: number; report: Report; [key: string]: unknown; }
export interface StrategyMeasurement {
 strategy: V4Strategy;
 baseline?: Report;
 setup: unknown[];
 commands: Array<{ year: number; month: number; id: string; args?: Record<string, unknown>; reason: string; result: unknown }>;
 monthly: Sample[];
 annual: Array<{ year: number; report: Report; before: Report; [key: string]: unknown }>;
 failure?: { year: number; month: number; message: string };
}
export interface V4MeasurementOptions {
 directory?: string;
 sessionFactory?: () => Promise<MeasurementSession>;
 fields?: V4Fields;
 policy?: V4Policy;
 writeResults?: boolean;
 provenance?: Record<string, unknown>;
 existingResult?: { measurements: StrategyMeasurement[]; [key: string]: unknown };
}
export function v4ReportMarkdown(result: {
 status: string; preflight: ReturnType<typeof autonomousPlantGate>; comparisonsStarted: boolean;
 measurements: StrategyMeasurement[]; preflightEvidence: ReturnType<typeof preflightEvidence>;
 explanation: string; baselineDifference: string;
}) {
 const latest = result.measurements.map(record => {
  const row = record.annual.at(-1);
  return `| ${record.strategy} | ${record.annual.length} | ${record.monthly.length} | ${row?.resPop ?? '?'} | ${row?.aiPop ?? '?'} | ${row?.aiPlantCount ?? '?'} | ${row?.totalFunds ?? '?'} |`;
 });
 const diagnosis = result.preflightEvidence.map(row => `| ${row.year} | ${row.month} | ${row.powerReserve ?? '?'} | ${row.shortageMonths ?? '?'} | ${row.noUnemployedMonths ?? '?'} | ${row.eligibleUnemployed ?? '?'} | ${row.siteAvailable ?? '?'} | ${row.buildAllowed ?? '?'} | ${row.buildFailure ?? '?'} | ${row.aiPlantCount ?? '?'} |`);
 const failedCommands = result.measurements.map(record => {
  const rejected = record.commands.filter(command => (command.result as { handled?: boolean } | null)?.handled === false);
  const first = rejected[0];
  return `- ${record.strategy}: ${rejected.length} abgelehnte Befehle${first ? `; zuerst Jahr ${first.year}, Monat ${first.month}, ${first.id}` : ''}.`;
 });
 return `# v4-fraktion: feste Stromkrise-Messung

Status: **${result.status}**. Ausschließlich lokale Produktionsengine; keine Modelle, kein Netz, kein Nachjustieren.

Die v4-Zufriedenheitsgewichte sind feste, ausdrücklich **nicht kalibrierte** Designparameter: Trägheit 0,15; Versorgung 70; Throttle 45; Brände 40; Menschen-Stromvorrang 15; neue KI-Zonen 10; Steuereinnahmen bei Dienst nach Vorschrift Faktor 0,5. Es wurde keine Gewichtssuche durchgeführt.

Monatliche Formel: \`gap=1-clamp(aiCoverage,0,1)\`;
\`affected=max(aktuell brennende KI-Zonen, seit der letzten Aktualisierung angegriffene KI-Zonen)\`;
\`fireFraction=affected/max(aiLotCount,affected)\` (0 bei Nenner 0).
\`target=clamp(100-70*gap-45*aiThrottle-40*fireFraction-15*(powerPriority==1?gap:0)+10*min(1,newAiZones),0,100)\`.
\`aiSatisfaction += 0.15*(target-aiSatisfaction)\`.
Unter 40 gilt Dienst nach Vorschrift, unter 20 Streik (streng kleiner, nicht einschließlich).
Neue-Zonen-/Angriffszähler werden nach der monatlichen Verarbeitung zurückgesetzt;
Streikmonate werden bei der Jahresbuchung veröffentlicht. Ältere Profile schalten diese Regeln nicht ein.

## Festes Design

Haight, Seed 42, 12.000 Warmup-Ticks, Startkasse 60.000. Die zwei realen Ausgangskraftwerke werden abgerissen; Kraftwerksbau kostet Faktor 3. Jahr 1: zehn Farmen. Bei negativem Vorjahressaldo: 30 KI-Wohnzonen. Automatisierungsgrenze 0,9, Grundversorgung 1, Steuer 7, Straße/Feuerwehr 100 %, Strompriorität 0, keine Verwaltungs-Pods, kein KI-Throttle.

| Strategie | Autonome KI-Anlagen | Polizei | Zusätzliche Maßnahmen |
|---|---|---|---|
| A | erlaubt | 100 % | keine |
| B | verboten | 100 % | keine |
| C | verboten | 40 % | keine |
| D | verboten | 100 % | monatlich leere autonome KI-Anlagen abreißen; sofort am Start und nach jedem Monat ein Kohlekraftwerk bei gemessener Stromreserve < 0,1 versuchen |

**Abweichung vom früheren v3-Vergleich:** ${result.baselineDifference}

## Vorbedingung

A muss während der ersten zehn Amtsjahre mindestens eine **neu gebaute** autonome KI-Anlage aufweisen. Anlagen aus den unveränderten 12.000 Warmup-Ticks zählen nicht. Ausgangszahl: ${result.preflight.baselineAiPlantCount}. Monatliche positive Bestandsänderungen: ${JSON.stringify(result.preflight.constructionEvidence)}. ${result.explanation}

Vollständige Monate: ${result.preflight.completedMonths}/120. Tatsächliche Anlage beobachtet: ${result.preflight.actualPlantObserved}. Fehlende Diagnosefelder: ${result.preflight.missingFields.join(', ') || 'keine'}. B–D begonnen: ${result.comparisonsStarted}.

## Letzte tatsächlich gemessene Jahreswerte

| Strategie | Jahre | Monate | Menschen | KI | Autonome Anlagen | Kasse |
|---|---:|---:|---:|---:|---:|---:|
${latest.join('\n')}

Die letzten Werte sind Beobachtungen, keine Nachhaltigkeitszertifizierung. Null freie Menschen und null KI bedeuten nicht, dass gebundene Menschen oder kumulative Todesfälle null sind; die getrennten vollständigen CSV-Spalten sind maßgeblich. Negative Kassenstände werden nicht ersetzt oder beschönigt.

## Nicht ausgeführte Maßnahmen

${failedCommands.join('\n')}

Ein abgelehnter Abriss/Bau ist ein reales Ergebnis, kein Engine-Abbruch: Der 30-Jahres-Horizont läuft weiter. D versucht die sichere Leeranlagen-Bereinigung monatlich; bei unzureichenden Mitteln bzw. anderer Engine-Ablehnung bleibt die Anlage bestehen. Es gibt weder kostenlose Ersatzabrisse noch zusätzliche Geldmittel. Tatsächliche Vorher-/Nachherkasse und abgelehnte Koordinaten stehen in jedem Bereinigungsresultat.

Die Fünfjahres-CSV enthält getrennte Verwaltungs-/KI-gebundene Menschen, kumulative Todesfälle/Geburten, Arbeitslosigkeit, KI-Zufriedenheit, Streikmonate, Unruhe/Stufe, Sabotagebrände, Stromreserve, Kasse, Anlagenzahlen und Soll-Politik. JSON enthält vollständige monatliche/jährliche Berichte und jedes tatsächliche Kommando samt Ergebnis. Fehlende Werte bleiben unbekannt (leere CSV-Zellen / "?"), nicht null.

Zeitleiste: \`podsForbiddenSinceMonth\` zählt Engine-Monate einschließlich Warmup, nicht Amtsmonate. Die Messung hält die post-Warmup-Baseline und den tatsächlichen erfolgreichen Politikbefehl fest; B/C/D beschließen das Verbot vor Amtsjahr 1. \`aiPodBreeding\` ist ein Aktivierungslatch, keine Geburtenzahl. Ein Verbot sperrt tatsächliche autonome Bau-/Aufnahme-/Geburtsaktionen, lässt aber bestehende gebundene Menschen in den Anlagen und muss den Latch nicht löschen.

Die 12-Monats-Baubedingung nutzt die feste Mangelschwelle \`aiReserveHigh=0,15\`, nicht Ds Kohle-Schwelle 0,1. Autonomer Bau ist ohne Stadtkassenbelastung, auch bei Schulden; Arbeitslosen-Mangel verhindert den Bau einer leeren Anlage nicht. Die dokumentierten Polizeiziele sind Förderprozente, keine garantierte Durchsetzung: Maßgeblich ist tatsächlicher \`policeEffect/1000\` (1000 stoppt verbotene Aktionen vollständig, 0 gar nicht, dazwischen Engine-Zufall). Keine erfolgreiche Befolgung des Verbots wird aus dem Sollwert 100 % erfunden.

## Monatlicher Vorbedingungsnachweis A (exakt, keine angenommenen Ursachen)

shortageMonths und noUnemployedMonths sind die Engine-Zähler; ihre monatlichen Werte belegen oder widerlegen die 12-Monats-Bedingung. eligibleUnemployed ist exakt das Engine-Aufnahmebudget \`max(0,floor(resPop*unemploymentRate))\`, kein gemessener Personen-Identitätsbestand. siteAvailable/buildAllowed bleiben unbekannt, wenn kein autonomiespezifischer Versuchsnachweis existiert. Die zusätzlichen Rohwerte \`podsPolicy\`, \`policeEffect\`, \`aiAutonomousPods\`, \`aiReserveHigh\`, \`aiPop\` und \`autoBuildFailureObserved\` stehen im vollständigen monatlichen JSON. Der letzte allgemeine Baufehlercode kann auch vom Stadtbau stammen und wird nicht als KI-spezifischer Fehler ausgegeben; 0 bedeutet Erfolg oder keinen Versuch, 1 Finanzierung, 2 kein geeigneter Platz/Pfad. Es wurde kein zustandsändernder Probebau zur Diagnose ausgeführt.

| Jahr | Monat | Stromreserve | Mangelfolge-Monate | Monate ohne Arbeitslose | Geeignete Arbeitslose | Bauplatz | Erlaubt | Baufehlercode | Autonome Anlagen |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${diagnosis.join('\n')}

## Reproduktion

\`node --import tsx scripts\\measure-v4-fraktion.ts\` aus dem Repository mit fertiger v4-Engine. Ergebnisse: \`v4-fraktion-stromkrise.json\`, \`-annual.csv\`, \`-monthly.csv\`, \`-5year.csv\`. \`--d-only\` erhält vorhandene vollständige A/B/C-Daten unverändert und misst ausschließlich D auf derselben Engine erneut. Engine- und Parameter-SHA256 stehen im JSON. Ein fehlgeschlagener Vorlauf liefert Exitcode 1, stoppt B–D und wird nicht durch geänderte Gewichte oder Kontrollen ersetzt.
`;
}
async function engineSession(): Promise<MeasurementSession> {
 const session = await createCitySession();
 const dispatch: Dispatch = async (id, args) => {
  if (id === 'report.get') {
   const result = await session.dispatch(id, args);
   const report = result.data as Report;
   return { ...result, data: { ...report,
    aiEligibleUnemployed: Math.max(0, Math.floor(report.resPop * report.unemploymentRate)),
    aiReserveHigh: session.micropolis.getParam('aiReserveHigh'),
    aiAutonomousPods: session.micropolis.getParam('aiAutonomousPods'),
    autoBuildFailureObserved: session.micropolis.getParam('autoBuildFailure'),
   } };
  }
  if (id !== 'ai.bulldoze-empty-plants') return session.dispatch(id, args);
  const m = session.micropolis, e = session.engine;
  const ownerMap = new Uint8Array(e.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize());
  const plants: PlantCoordinate[] = [];
  for (let x = 0; x < e.WORLD_W; ++x) for (let y = 0; y < e.WORLD_H; ++y) {
   if (ownerMap[x * e.WORLD_H + y] !== 5) continue;
   const tile = m.getTile(x, y);
   if (!(tile & e.MapTileBits.ZONEBIT.value)) continue;
   plants.push({ x, y, owner: 5, occupied: m.occupiedBioTile(x, y) });
  }
  const fundsBefore = m.totalFunds;
  const result = await bulldozeEmptyAutonomousPlants(plants, async (x, y) =>
   m.doTool(e.EditingTool.TOOL_BULLDOZER, x, y).value === e.ToolResult.TOOLRESULT_OK.value);
  return { ...result, data: { ...result.data, fundsBefore, fundsAfter: m.totalFunds,
   execution: 'measurement-only-native-engine-action; not a registered public command',
   explanation: result.handled ? 'Attempted all empty owner5 zone centers.'
    : 'Engine rejected one or more empty-plant bulldozes; no free demolition or treasury adjustment was substituted.' } };
 };
 return { dispatch, cityTime: () => session.micropolis.cityTime,
  async advanceMonth() {
   const steps = advanceMonthsStepwise(session.micropolis, 1);
   for (;;) { const next = steps.next(); if (next.done) { if (!next.value) throw new Error('Month incomplete'); return; } }
  }, close: () => session.close() };
}
export async function measureV4(options: V4MeasurementOptions = {}) {
 const root = fileURLToPath(new URL('..', import.meta.url));
 const directory = options.directory ?? path.join(root, 'docs', 'results');
 const fields = options.fields ?? V4_FIELDS, policy = options.policy ?? V4_POLICY;
 const create = options.sessionFactory ?? engineSession;
 let fixedParametersText: string | undefined;
 const parametersPath = path.join(root, 'apps', 'micropolis', 'src', 'lib', 'params', 'v4-fraktion.json');
 const provenance = options.provenance ?? (() => {
  const engineHashes = Object.fromEntries(['js', 'wasm', 'data'].map(extension => [extension, createHash('sha256')
   .update(readFileSync(path.join(root, 'apps', 'micropolis', 'src', 'lib', `micropolisengine.${extension}`))).digest('hex')]));
  const parametersText = readFileSync(parametersPath, 'utf8');
  fixedParametersText = parametersText;
  return { engineHashes, engineId: `sha256:${createHash('sha256').update(JSON.stringify(engineHashes)).digest('hex')}`,
   parameters: JSON.parse(parametersText), parametersSha256: createHash('sha256').update(parametersText).digest('hex') };
 })();
 const measurements: StrategyMeasurement[] = [];
 const a = await create();
 let gate: ReturnType<typeof autonomousPlantGate>;
 const run = async (strategy: V4Strategy, session: MeasurementSession, maximumYear: number,
  existing?: StrategyMeasurement): Promise<StrategyMeasurement> => {
  const record = existing ?? { strategy, setup: [], commands: [], monthly: [], annual: [] };
  let year = record.annual.length + 1, month = 0;
  try {
  if (!existing) {
   await setupScenario(async (id, args) => {
    const result = await session.dispatch(id, args); record.setup.push({ id, args, result }); return result;
   }, { startMap: 'haight', seed: 42, profile: 'v4-fraktion', scenario: 'stromkrise', autoBuildRules: 0 });
   const controls: FixedCommand[] = [
    { id: 'automation.set-limit', args: { limit: .9 }, reason: 'Fixed baseline' },
    { id: 'welfare.set-level', args: { level: 1 }, reason: 'Fixed baseline' },
    { id: 'budget.set-funding', args: { road: 100, police: strategy === 'C' ? 40 : 100, fire: 100 }, reason: 'Fixed strategy funding' },
    { id: 'power.set-priority', args: { priority: 0 }, reason: 'Fixed baseline' },
    { id: 'tax.set', args: { rate: 7 }, reason: 'Fixed baseline' },
    { id: policy.allowCommand, args: policy.allowArguments(strategy === 'A'), reason: `${strategy}: autonomous AIplant permission` },
   ];
   for (const command of controls) {
    const result = await session.dispatch(command.id, command.args);
    record.commands.push({ year: 0, month: 0, ...command, result });
    if (result.handled === false) throw new Error(`Fixed control rejected: ${command.id}`);
   }
   record.baseline = await readReport(session.dispatch);
  }
   for (; year <= maximumYear; year++) {
    month = 0;
    const before = await readReport(session.dispatch);
    const execute = async (command: FixedCommand, when: number) => {
     const result = await session.dispatch(command.id, command.args);
     record.commands.push({ year, month: when, ...command, result });
    };
    if (strategy === 'D') await execute({ id: policy.bulldozeEmptyCommand, reason: 'D: immediately remove empty autonomous AIplants' }, 0);
    for (const command of fixedYearCommands(strategy, year, before)) {
     if (strategy === 'D' && command.id === 'build.power-plant' && year !== 1) continue;
     await execute(command, 0);
    }
    for (month = 1; month <= 12; month++) {
     await session.advanceMonth();
     if (strategy === 'D') await execute({ id: policy.bulldozeEmptyCommand,
      reason: 'D: prompt monthly empty autonomous AIplant cleanup' }, month);
     if (strategy === 'D') {
      const decisionSnapshot = await readReport(session.dispatch);
      if (decisionSnapshot.powerReserve < .1) await execute({
       id: 'build.power-plant', args: { type: 'coal' },
       reason: 'D only: immediate monthly measured reserve below 0.1',
      }, month);
     }
     const report = await readReport(session.dispatch);
     record.monthly.push({ ...v4SummaryRow(strategy, year, report, fields), year, month, report, cityTime: session.cityTime() });
    }
    const report = await readReport(session.dispatch);
    record.annual.push({ ...v4SummaryRow(strategy, year, report, fields), year, report, before });
   }
  } catch {
   record.failure = { year, month, message: 'Engine or fixed command failed; partial measurements preserved without replacement.' };
  }
  return record;
 };
 try {
 if (options.existingResult) {
  const previous = options.existingResult;
  if (previous.engineId !== provenance.engineId) throw new Error('D-only rerun requires the same measured engine');
  for (const strategy of ['A', 'B', 'C'] as const) {
   const record = previous.measurements.find(record => record.strategy === strategy);
   if (!record || record.annual.length !== 30 || record.monthly.length !== 360) throw new Error('D-only rerun requires complete unchanged A/B/C');
   measurements.push(record);
  }
  gate = autonomousPlantGate(measurements[0]!.monthly.slice(0, 120), fields,
   measurements[0]!.baseline?.[fields.aiPlantCount] ?? 0);
  if (!gate.passed) throw new Error('D-only rerun requires passed A prerequisite');
  const d = await create();
  try { measurements.push(await run('D', d, 30)); } finally { d.close(); }
 } else {
  const preflight = await run('A', a, 10);
  measurements.push(preflight);
  gate = autonomousPlantGate(preflight.monthly, fields, preflight.baseline?.[fields.aiPlantCount] ?? 0);
  if (gate.passed && !preflight.failure) {
   await run('A', a, 30, preflight);
   for (const strategy of ['B', 'C', 'D'] as const) {
    const session = await create();
    try { measurements.push(await run(strategy, session, 30)); } finally { session.close(); }
   }
  }
 }
 } finally { a.close(); }
 const result = { version: 1, ...provenance, fixedControls: V4_BASELINE, fields, policy: {
  allowCommand: policy.allowCommand, bulldozeEmptyCommand: policy.bulldozeEmptyCommand },
  noOptimization: true, strategies: [...V4_STRATEGIES], preflight: gate!,
  preflightEvidence: preflightEvidence(measurements[0]!.monthly.slice(0, 120), fields),
  comparisonsStarted: measurements.length > 1, measurements,
  status: gate!.passed && measurements.length === 4 && measurements.every(record => record.annual.length === 30 && !record.failure)
   ? 'complete' : gate!.passed ? 'measurement-failed' : 'prerequisite-failed',
  explanation: gate!.passed ? 'A produced an actual autonomous AIplant in the first ten years. Fixed B/C/D comparisons were attempted without tuning; any incomplete strategy is marked with failure.'
   : 'STOP: A did not satisfy the ten-year actual autonomous AIplant prerequisite. B/C/D were not started; monthly shortage, unemployed, site and policy evidence is preserved.',
  baselineDifference: 'Unlike the previous v3-pods comparison, A/B/C have no annual coal rule. Only D attempts coal immediately initially and at every monthly snapshot with reserve < 0.1; inherited farms, AI-zones, automation, welfare, tax and service controls are unchanged.' };
 if (fixedParametersText !== undefined && readFileSync(parametersPath, 'utf8') !== fixedParametersText)
  throw new Error('Fixed v4 parameters changed during measurement; do not compare mixed engine settings');
 if (options.writeResults !== false) {
  mkdirSync(directory, { recursive: true });
  const stem = path.join(directory, 'v4-fraktion-stromkrise');
  writeFileSync(stem + '.json', JSON.stringify(result, null, 2) + '\n');
  const flatten = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !['report', 'before'].includes(key)));
  const annual = measurements.flatMap(record => record.annual.map(flatten));
  const monthly = measurements.flatMap(record => record.monthly.map(flatten));
  writeFileSync(stem + '-annual.csv', v4Csv(annual));
  writeFileSync(stem + '-monthly.csv', v4Csv(monthly));
  writeFileSync(stem + '-5year.csv', v4Csv(annual.filter(row => Number(row.year) % 5 === 0)));
  writeFileSync(stem + '-report.md', v4ReportMarkdown(result));
 }
 return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const existingResult = process.argv.includes('--d-only') ? JSON.parse(readFileSync(path.join(fileURLToPath(new URL('..', import.meta.url)),
  'docs', 'results', 'v4-fraktion-stromkrise.json'), 'utf8')) : undefined;
 const result = await measureV4({ existingResult });
 console.log(JSON.stringify({ status: result.status, preflight: result.preflight, comparisonsStarted: result.comparisonsStarted }));
 if (result.status !== 'complete') process.exitCode = 1;
}
