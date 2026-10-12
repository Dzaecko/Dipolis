import { describe, expect, it } from 'vitest';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { PROFILES } from '../../src/lib/params/profiles';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

let enginePromise: Promise<MainModule> | undefined;
async function city() {
 const e = await (enginePromise ??= loadMicropolisMainModule());
 const m = new e.Micropolis();
 m.setCallback(createNoopJsCallback(e), {});
 m.setFixedSeed(266); m.init();
 for (const [key, value] of Object.entries(PROFILES['v4-fraktion'])) m.setParam(key, value);
 m.setParam('foundingEnabled', 1); m.setEnableDisasters(false);
 m.clearMap(); m.setFunds(1000000);
 return { e, m };
}
function map(e: MainModule, m: Micropolis) {
 return new Uint16Array(e.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2).slice();
}
function separatedBanks(e: MainModule, m: Micropolis) {
 for (let x = 0; x < e.WORLD_W; ++x) for (let y = 0; y < e.WORLD_H; ++y)
  m.setTile(x, y, e.Tiles.RIVER.value);
 for (let x = 10; x <= 24; ++x) for (let y = 35; y <= 70; ++y)
  m.setTile(x, y, e.Tiles.RADTILE.value);
 for (let x = 28; x <= 48; ++x) for (let y = 35; y <= 70; ++y)
  m.setTile(x, y, e.Tiles.DIRT.value);
 m.setTile(24, 50, e.Tiles.ROADS.value | e.MapTileBits.BULLBIT.value);
 m.setTile(24, 54, e.Tiles.LHPOWER.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.PWRBIT.value);
 m.setTile(23, 54, e.Tiles.POWERPLANT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.ZONEBIT.value | e.MapTileBits.PWRBIT.value);
}
function diagnostics(m: Micropolis) {
 return JSON.parse(m.getNetworkDiagnosticsJSON()) as {
  banks: { bankId: number; landTiles: number }[];
  islands: { islandId: number; bankIds: number[]; capacity: number; bioCapacity: number;
   conductiveTiles: number; zones: number; physicalPoweredZones: number; demand: number; aiDemand: number }[];
 };
}

describe('real WASM water routing and physical network diagnostics', () => {
 it('crosses an actual seed-two natural river after other land sites are depleted', async () => {
  const { e, m } = await city();
  try {
   m.generateMap(2); m.setFunds(1000000);
   for (let x = 0; x < e.WORLD_W; ++x) for (let y = 0; y < e.WORLD_H; ++y) {
    const tile = m.getTile(x, y) & e.MapTileBits.LOMASK.value;
    if (tile >= e.Tiles.FIRSTRIVEDGE.value && tile <= e.Tiles.LASTRIVEDGE.value)
     m.doTool(e.EditingTool.TOOL_BULLDOZER, x, y);
   }
   const natural = map(e, m), mask = e.MapTileBits.LOMASK.value;
   const land = (x: number, y: number) => {
    const tile = natural[x * e.WORLD_H + y]! & mask;
    return tile === e.Tiles.DIRT.value || tile >= e.Tiles.TREEBASE.value && tile <= e.Tiles.WOODS5.value;
   };
   const water = (x: number, y: number) =>
    [e.Tiles.RIVER.value, e.Tiles.REDGE.value, e.Tiles.CHANNEL.value].includes(natural[x * e.WORLD_H + y]! & mask);
   let selected: { left: number; right: number; y: number } | undefined;
   for (let x = 3; x < e.WORLD_W - 10 && !selected; ++x)
    for (let y = 5; y < e.WORLD_H - 8 && !selected; ++y) {
     if (!land(x, y) || !land(x, y + 2) || !land(x - 1, y + 2)) continue;
     let right = x + 1;
     while (right < e.WORLD_W - 8 && water(right, y) && water(right, y + 2)) ++right;
     if (right === x + 1 || right - x > 40) continue;
     let room = true;
     for (let px = right; px < right + 7 && room; ++px)
      for (let py = y - 2; py < y + 5; ++py) if (!land(px, py)) { room = false; break; }
     if (room) selected = { left: x, right, y };
    }
   expect(selected).toBeDefined();
   const { left, right, y } = selected!;
   for (let x = 0; x < e.WORLD_W; ++x) for (let py = 0; py < e.WORLD_H; ++py)
    if (land(x, py)) m.setTile(x, py, e.Tiles.RADTILE.value);
   for (let x = right; x < right + 7; ++x) for (let py = y - 2; py < y + 5; ++py)
    m.setTile(x, py, e.Tiles.DIRT.value);
   m.setTile(left, y, e.Tiles.ROADS.value);
   m.setTile(left, y + 2, e.Tiles.LHPOWER.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.PWRBIT.value);
   m.setTile(left - 1, y + 2, e.Tiles.POWERPLANT.value | e.MapTileBits.CONDBIT.value |
    e.MapTileBits.ZONEBIT.value | e.MapTileBits.PWRBIT.value);
   expect(m.autoBuild(0, 1)).toBe(1);
   let bridges = 0, wires = 0;
   for (let x = left + 1; x < right; ++x) for (let py = y - 2; py < y + 5; ++py) {
    if (!water(x, py)) continue;
    const tile = m.getTile(x, py) & mask;
    if (tile === e.Tiles.HBRIDGE.value) ++bridges;
    if (tile === e.Tiles.VPOWER.value) ++wires;
   }
   expect(bridges).toBeGreaterThan(0); expect(wires).toBeGreaterThan(0);
  } finally { m.delete(); }
 });
 it('connects an otherwise depleted bank with straight paid bridges and underwater wires that reach the opposite bank', async () => {
  const { e, m } = await city();
  try {
   separatedBanks(e, m);
   expect(m.getBuildSiteCount(0)).toBeGreaterThan(0);
   expect(m.autoBuild(0, 1)).toBe(1);
   const tiles = map(e, m), mask = e.MapTileBits.LOMASK.value;
   const rows = new Map<number, number>();
   for (let x = 25; x <= 27; ++x) for (let y = 0; y < e.WORLD_H; ++y) {
    const tile = tiles[x * e.WORLD_H + y]! & mask;
    if (tile === e.Tiles.RIVER.value) continue;
    expect([e.Tiles.HBRIDGE.value, e.Tiles.VPOWER.value]).toContain(tile);
    rows.set(y, tile);
   }
   expect([...rows.values()]).toContain(e.Tiles.HBRIDGE.value);
   expect([...rows.values()]).toContain(e.Tiles.VPOWER.value);
   for (const [y, tile] of rows) {
    for (let x = 25; x <= 27; ++x) expect(m.getTile(x, y) & mask).toBe(tile);
    expect(m.getTile(28, y) & mask).not.toBe(e.Tiles.RIVER.value);
   }
   const joined = diagnostics(m).islands.find(island => island.bankIds.length === 2);
   expect(joined).toBeDefined();
   expect(joined!.capacity).toBeGreaterThan(0);
   expect(joined!.zones).toBeGreaterThanOrEqual(2);
   expect(joined!.demand).toBe(joined!.conductiveTiles + joined!.aiDemand);
  } finally { m.delete(); }
 });
 it('uses the exact native road and wire water costs and rejects unsupported water turns', async () => {
  const { e, m } = await city();
  try {
   separatedBanks(e, m);
   const before = m.totalFunds;
   expect(m.doTool(e.EditingTool.TOOL_ROAD, 25, 50).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   const roadCost = before - m.totalFunds;
   expect(m.doTool(e.EditingTool.TOOL_ROAD, 26, 50).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   expect(before - m.totalFunds).toBe(roadCost * 2);
   const snapshot = map(e, m), funds = m.totalFunds;
   expect(m.doTool(e.EditingTool.TOOL_ROAD, 26, 51).value).not.toBe(e.ToolResult.TOOLRESULT_OK.value);
   expect(map(e, m)).toEqual(snapshot); expect(m.totalFunds).toBe(funds);
   expect(m.doTool(e.EditingTool.TOOL_WIRE, 25, 54).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   const wireCost = funds - m.totalFunds;
   expect(m.doTool(e.EditingTool.TOOL_WIRE, 26, 54).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   expect(funds - m.totalFunds).toBe(wireCost * 2);
   expect(m.doTool(e.EditingTool.TOOL_WIRE, 26, 55).value).not.toBe(e.ToolResult.TOOLRESULT_OK.value);
  } finally { m.delete(); }
 });
 it('prefers any valid funded zero-crossing site over a nearer opposite-bank site', async () => {
  const { e, m } = await city();
  try {
   separatedBanks(e, m);
   for (let x = 10; x <= 22; ++x) for (let y = 36; y <= 46; ++y) m.setTile(x, y, e.Tiles.DIRT.value);
   for (let x = 19; x <= 24; ++x) m.setTile(x, 42, e.Tiles.ROADS.value);
   for (let y = 42; y <= 54; ++y) m.setTile(22, y, e.Tiles.LHPOWER.value | e.MapTileBits.CONDBIT.value);
   expect(m.autoBuild(0, 1)).toBe(1);
   for (let x = 25; x <= 27; ++x) for (let y = 0; y < e.WORLD_H; ++y)
    expect(m.getTile(x, y)).toBe(e.Tiles.RIVER.value);
  } finally { m.delete(); }
 });
 it('counts spatially connectable sites independently of funds and reports impossible sites as zero without mutation', async () => {
  const { e, m } = await city();
  let reference: Micropolis | undefined;
  try {
   separatedBanks(e, m); m.setFunds(0); reference = m.clone();
   const before = map(e, m), failure = m.autoBuildFailure;
   expect(m.getBuildSiteCount(0)).toBeGreaterThan(0);
   expect(m.getBuildSiteCount(9)).toBe(0);
   diagnostics(m);
   expect(map(e, m)).toEqual(before); expect(m.totalFunds).toBe(0);
   expect(m.autoBuildFailure).toBe(failure);
   expect(m.autoBuild(0, 1)).toBe(0);
   expect(m.rescueQueuePending).toBe(reference.rescueQueuePending);
   expect(m.getRandom16()).toBe(reference.getRandom16());
   m.setFunds(1000000);
   for (let x = 28; x <= 48; ++x) for (let y = 35; y <= 70; ++y) m.setTile(x, y, e.Tiles.RADTILE.value);
   expect(m.getBuildSiteCount(0)).toBe(0);
   expect(m.autoBuild(0, 1)).toBe(0);
  } finally { reference?.delete(); m.delete(); }
 });
 it('reports physically disconnected capacity on the correct land bank rather than assigning global power to isolated zones', async () => {
  const { e, m } = await city();
  let reference: Micropolis | undefined;
  try {
   separatedBanks(e, m);
   const bits = e.MapTileBits.CONDBIT.value | e.MapTileBits.ZONEBIT.value;
   m.setTile(34, 54, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(34, 54, 1);
   reference = m.clone(); const before = map(e, m);
   const report = diagnostics(m);
   expect(report.banks).toHaveLength(2);
   const supply = report.islands.find(island => island.capacity > 0)!;
   const demand = report.islands.find(island => island.capacity === 0 && island.zones > 0)!;
   expect(supply.bankIds).not.toEqual(demand.bankIds);
   expect(supply.physicalPoweredZones).toBe(1);
   expect(demand.physicalPoweredZones).toBe(0);
   expect(demand.demand).toBeGreaterThan(0);
   expect(map(e, m)).toEqual(before);
   expect(m.getRandom16()).toBe(reference.getRandom16());
  } finally { reference?.delete(); m.delete(); }
 });
 it('builds real commercial and industrial zones without treating them as farms or AI residential lots', async () => {
  const { e, m } = await city();
  try {
   expect(m.autoBuild(0, 1)).toBe(1);
   for (const kind of [7, 8]) {
    expect(m.getBuildSiteCount(kind)).toBeGreaterThan(0);
    expect(m.autoBuild(kind, 1)).toBe(1);
   }
   const tiles = map(e, m), owners = new Uint8Array(e.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize());
   let commercial = 0, industrial = 0;
   for (let x = 0; x < e.WORLD_W; ++x) for (let y = 0; y < e.WORLD_H; ++y) {
    const id = x * e.WORLD_H + y, tile = tiles[id]!;
    if (!(tile & e.MapTileBits.ZONEBIT.value)) continue;
    const base = tile & e.MapTileBits.LOMASK.value;
    if (base >= e.Tiles.COMBASE.value && base < e.Tiles.INDBASE.value) { ++commercial; expect(owners[id]).toBe(0); }
    if (base >= e.Tiles.INDBASE.value && base < e.Tiles.PORTBASE.value) { ++industrial; expect(owners[id]).toBe(0); }
   }
   expect(commercial).toBe(1); expect(industrial).toBe(1);
  } finally { m.delete(); }
 });
});
