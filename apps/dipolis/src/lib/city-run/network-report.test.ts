import { describe, expect, it, vi } from 'vitest';
import { flattenNetworkDiagnostics, networkIslandsSection, readNetworkReport } from './network-report';
import { compareReports } from './replay';

const diagnostics = {
 banks: [{ bankId: 0, landTiles: 100 }, { bankId: 1, landTiles: 200 }],
 islands: [{
  islandId: 0, bankIds: [0, 1], capacity: 700, bioCapacity: 0, conductiveTiles: 10,
  zones: 2, physicalPoweredZones: 1, humanPopulation: 24, aiPopulation: 0, aiDemand: 0, demand: 10,
  humanZones: 1, aiZones: 1, otherZones: 0, unpoweredZones: 1, connectionQuote: { cost: 35, length: 7 }
 }]
};
describe('native network report', () => {
 it('preserves banks, physical supply and funding-independent site counts', () => {
  const getBuildSiteCount = vi.fn((kind: number) => kind + 1);
  const report = readNetworkReport({
   getNetworkDiagnosticsJSON: () => JSON.stringify(diagnostics), getBuildSiteCount
  });
  expect(report).toMatchObject({
   networkBankCount: 2, networkBank1Id: 1, networkBank1LandTiles: 200,
   networkIslandCount: 1, networkIsland0Capacity: 700, networkIsland0BankCount: 2,
   networkIsland0Bank1Id: 1, networkIsland0ZoneCount: 2, networkIsland0PoweredZones: 1,
   networkIsland0HumanZones: 1, networkIsland0AiZones: 1, networkIsland0UnpoweredZones: 1,
   networkIsland0RouteAvailable: 1, networkIsland0ConnectCost: 35, networkIsland0ConnectLength: 7,
   freeResidentialSites: 1, freeCommercialSites: 8, freeIndustrialSites: 9,
   freeFarmSites: 3, freePowerPlantSites: 4
  });
  expect(getBuildSiteCount.mock.calls).toEqual([[0], [7], [8], [2], [3]]);
 });
 it('formats only the ten largest unpowered islands with current-bank IDs and native quotes', () => {
  const report = flattenNetworkDiagnostics(JSON.stringify({ banks: [{ bankId: 0, landTiles: 20 }], islands:
   Array.from({ length: 12 }, (_, islandId) => ({
    islandId, bankIds: [0], capacity: 10, bioCapacity: 0, conductiveTiles: 3, zones: islandId + 1,
    physicalPoweredZones: 0, humanPopulation: 0, aiPopulation: 0, aiDemand: 0, demand: islandId + 1,
    humanZones: 0, aiZones: islandId + 1, otherZones: 0, unpoweredZones: islandId + 1,
    connectionQuote: { cost: islandId * 10, length: islandId }
   })) }));
  const section = networkIslandsSection(report);
  expect(section.split('\n')).toHaveLength(11);
  expect(section).toContain('Netzinsel 11; Uferseiten 0; Kapazität 10, Bedarf 12; unversorgte Zonen 12 (Menschen 0, KI 12, andere 0); Verbindungsschätzung Kosten 110, Länge 11.');
  expect(section).not.toContain('Netzinsel 1;');
 });
 it.each([
  '{', '{}', JSON.stringify({ ...diagnostics, banks: [] }),
  JSON.stringify({ ...diagnostics, islands: [{ ...diagnostics.islands[0], capacity: -1 }] }),
  JSON.stringify({ ...diagnostics, islands: [{ ...diagnostics.islands[0], bankIds: [0, 0] }] }),
  JSON.stringify({ ...diagnostics, islands: [{ ...diagnostics.islands[0], physicalPoweredZones: 3 }] })
 ])('surfaces invalid diagnostics instead of inventing supply', json => {
  expect(() => flattenNetworkDiagnostics(json)).toThrow();
 });
 it('rejects invalid site counts', () => {
  expect(() => readNetworkReport({
   getNetworkDiagnosticsJSON: () => JSON.stringify(diagnostics), getBuildSiteCount: () => NaN
  })).toThrow('freeResidentialSites');
 });
 it('checks dynamic island and site data during replay, leaving old missing metrics alone', () => {
  expect(compareReports({ networkIsland0Capacity: 0 }, { networkIsland0Capacity: 700 }).synchronous).toBe(false);
  expect(compareReports({ freeResidentialSites: 2 }, { freeResidentialSites: 1 }).synchronous).toBe(false);
  expect(compareReports({ networkIsland0Capacity: 700 }, {})).toEqual({ synchronous: true, differences: [] });
 });
});
