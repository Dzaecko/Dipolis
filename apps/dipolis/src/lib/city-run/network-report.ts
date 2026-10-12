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
  if (report[`${prefix}PoweredZones`] > report[`${prefix}ZoneCount`])
   throw new Error('Invalid engine network diagnostics: powered zones exceed zones');
 }
 return report;
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
