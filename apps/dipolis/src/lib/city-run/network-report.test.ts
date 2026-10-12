import { describe, expect, it, vi } from 'vitest';
import { flattenNetworkDiagnostics, readNetworkReport } from './network-report';
import { compareReports } from './replay';

const diagnostics = {
 banks: [{ bankId: 0, landTiles: 100 }, { bankId: 1, landTiles: 200 }],
 islands: [{
  islandId: 0, bankIds: [0, 1], capacity: 700, bioCapacity: 0, conductiveTiles: 10,
  zones: 2, physicalPoweredZones: 1, humanPopulation: 24, aiPopulation: 0, aiDemand: 0, demand: 10
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
   freeResidentialSites: 1, freeCommercialSites: 8, freeIndustrialSites: 9,
   freeFarmSites: 3, freePowerPlantSites: 4
  });
  expect(getBuildSiteCount.mock.calls).toEqual([[0], [7], [8], [2], [3]]);
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
