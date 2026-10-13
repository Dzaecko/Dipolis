function record(value: unknown, label: string): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value))
  throw new Error(`Invalid engine network diagnostics: ${label}`);
 return value as Record<string, unknown>;
}

function numeric(value: unknown, label: string, integer = false): number {
 if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
  (integer && !Number.isSafeInteger(value)))
  throw new Error(`Invalid engine network diagnostics: ${label}`);
 return value;
}

export function flattenNetworkDiagnostics(json: string): Record<string, number> {
 const root = record(JSON.parse(json), 'root');
 if (!Array.isArray(root.banks) || !Array.isArray(root.islands))
  throw new Error('Invalid engine network diagnostics: banks/islands');
 const report: Record<string, number> = {
  networkBankCount: root.banks.length, networkIslandCount: root.islands.length
 };
 const banks = new Set<number>();
 for (const [index, value] of root.banks.entries()) {
  const bank = record(value, `bank ${index}`);
  const id = numeric(bank.bankId, 'bankId', true);
  if (banks.has(id)) throw new Error('Invalid engine network diagnostics: duplicate bankId');
  banks.add(id);
  report[`networkBank${index}Id`] = id;
  report[`networkBank${index}LandTiles`] = numeric(bank.landTiles, 'landTiles', true);
 }
 const islands = new Set<number>();
 for (const [index, value] of root.islands.entries()) {
  const island = record(value, `island ${index}`);
  const prefix = `networkIsland${index}`;
  const id = numeric(island.islandId, 'islandId', true);
  if (islands.has(id)) throw new Error('Invalid engine network diagnostics: duplicate islandId');
  islands.add(id);
  report[`${prefix}Id`] = id;
  if (!Array.isArray(island.bankIds)) throw new Error('Invalid engine network diagnostics: bankIds');
  const seenBanks = new Set<number>();
  report[`${prefix}BankCount`] = island.bankIds.length;
  for (const [bankIndex, value] of island.bankIds.entries()) {
   const bankId = numeric(value, 'bankId', true);
   if (!banks.has(bankId) || seenBanks.has(bankId))
    throw new Error('Invalid engine network diagnostics: unknown or duplicate island bank');
   seenBanks.add(bankId);
   report[`${prefix}Bank${bankIndex}Id`] = bankId;
  }
  for (const [source, target, integer] of [
   ['capacity', 'Capacity', false], ['bioCapacity', 'BioCapacity', false],
   ['conductiveTiles', 'ConductiveTiles', true], ['zones', 'ZoneCount', true],
   ['physicalPoweredZones', 'PoweredZones', true], ['humanPopulation', 'HumanPopulation', true],
   ['aiPopulation', 'AiPopulation', true], ['aiDemand', 'AiDemand', false], ['demand', 'Demand', false]
  ] as const) report[`${prefix}${target}`] = numeric(island[source], source, integer);
  for (const [source, target] of [
   ['humanZones', 'HumanZones'], ['aiZones', 'AiZones'], ['otherZones', 'OtherZones'],
   ['unpoweredZones', 'UnpoweredZones']
  ] as const) if (island[source] !== undefined)
   report[`${prefix}${target}`] = numeric(island[source], source, true);
  if (island.connectionQuote !== undefined) {
   const quote = island.connectionQuote;
   if (quote === null) report[`${prefix}RouteAvailable`] = 0;
   else {
    const route = record(quote, 'connectionQuote');
    report[`${prefix}RouteAvailable`] = 1;
    report[`${prefix}ConnectCost`] = numeric(route.cost, 'connectionQuote.cost');
    report[`${prefix}ConnectLength`] = numeric(route.length, 'connectionQuote.length', true);
   }
  }
  if (report[`${prefix}PoweredZones`] > report[`${prefix}ZoneCount`])
   throw new Error('Invalid engine network diagnostics: powered zones exceed zones');
 }
 return report;
}

export function networkIslandsSection(report: Record<string, number>): string {
  const count = report.networkIslandCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
   throw new Error('Invalid network island count in report');
  const islands: Array<{ id: number; banks: number[]; unpowered: number; demand: number; text: string }> = [];
  if (count > 0 && report.networkIsland0UnpoweredZones === undefined)
   return 'Netzinsel-Diagnostik: Uferseiten und Kapazitäten sind dokumentiert; Eigentümer, Unterversorgung und Verbindungsschätzungen sind in dieser Engine-Version nicht verfügbar.';
  for (let index = 0; index < count; index++) {
   const prefix = `networkIsland${index}`;
   const id = report[`${prefix}Id`];
   const unpowered = report[`${prefix}UnpoweredZones`];
   if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0)
    throw new Error(`Invalid network island ID at index ${index}`);
   if (unpowered === undefined) continue;
   if (typeof unpowered !== 'number' || !Number.isSafeInteger(unpowered) || unpowered < 0)
    throw new Error(`Invalid unpowered zone count for island ${id}`);
   if (unpowered === 0) continue;
   const bankCount = report[`${prefix}BankCount`];
   if (typeof bankCount !== 'number' || !Number.isSafeInteger(bankCount) || bankCount < 0)
    throw new Error(`Invalid bank count for island ${id}`);
   const banks: number[] = [];
   for (let bank = 0; bank < bankCount; bank++) {
    const bankId = report[`${prefix}Bank${bank}Id`];
    if (typeof bankId !== 'number' || !Number.isSafeInteger(bankId) || bankId < 0)
     throw new Error(`Invalid bank ID for island ${id}`);
    banks.push(bankId);
   }
   const humanZones = report[`${prefix}HumanZones`] ?? 0;
   const aiZones = report[`${prefix}AiZones`] ?? 0;
   const otherZones = report[`${prefix}OtherZones`] ?? 0;
   const capacity = report[`${prefix}Capacity`];
   const demand = report[`${prefix}Demand`];
   if (typeof capacity !== 'number' || !Number.isFinite(capacity) ||
    typeof demand !== 'number' || !Number.isFinite(demand))
    throw new Error(`Invalid capacity or demand for island ${id}`);
   const route = report[`${prefix}RouteAvailable`] === 1
    ? `Kosten ${report[`${prefix}ConnectCost`]}, Länge ${report[`${prefix}ConnectLength`]}`
    : 'keine Route verfügbar';
   islands.push({ id, banks, unpowered, demand,
    text: `Netzinsel ${id}; Uferseiten ${banks.length ? banks.join(', ') : 'keine dokumentierte'}; ` +
     `Kapazität ${capacity}, Bedarf ${demand}; unversorgte Zonen ${unpowered} ` +
     `(Menschen ${humanZones}, KI ${aiZones}, andere ${otherZones}); Verbindungsschätzung ${route}.` });
  }
  islands.sort((a, b) => b.unpowered - a.unpowered || b.demand - a.demand || a.id - b.id);
  return `Netzinseln mit unversorgten Zonen:\n${islands.length
    ? islands.slice(0, 10).map(island => island.text).join('\n')
    : 'Keine unversorgten Zonen in getrennten Netzinseln dokumentiert.'}`;
  }

export const BUILD_SITE_REPORT_KINDS = {
 freeResidentialSites: 0, freeCommercialSites: 7, freeIndustrialSites: 8,
 freeFarmSites: 2, freePowerPlantSites: 3
} as const;

export function readNetworkReport(engine: {
 getNetworkDiagnosticsJSON(): string;
 getBuildSiteCount(kind: number): number;
}): Record<string, number> {
 const report = flattenNetworkDiagnostics(engine.getNetworkDiagnosticsJSON());
 for (const [key, kind] of Object.entries(BUILD_SITE_REPORT_KINDS))
  report[key] = numeric(engine.getBuildSiteCount(kind), key, true);
 return report;
}
