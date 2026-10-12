import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { PROFILES } from '../../src/lib/params/profiles';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

type Faction = Micropolis & {
 aiSatisfaction: number; aiStrikeStage: number; aiStrikeMonths: number;
 aiShortageMonths: number; aiNoUnemployedMonths: number; aiPodBreeding: number;
 podsPolicy: number; podsForbiddenSinceMonth: number; newAiZones: number;
 adminBioPlantCount: number; aiBioPlantCount: number;
 adminBoundHumans: number; aiBoundHumans: number;
 adminAdmissions: number; aiAdmissions: number;
 adminAdmissionsCumulative: number; aiAdmissionsCumulative: number;
 adminDiedInPods: number; aiDiedInPods: number;
 adminDiedInPodsCumulative: number; aiDiedInPodsCumulative: number;
 adminBornInPods: number; aiBornInPods: number;
 adminBornInPodsCumulative: number; aiBornInPodsCumulative: number;
 updateAiFaction(): void; aiEconomicActivity(): number; aiWorkFactor(): number;
};

let modulePromise: Promise<MainModule> | undefined;
function engine(): Promise<MainModule> {
 if (!modulePromise) modulePromise = loadEngine();
 return modulePromise;
}
async function loadEngine(): Promise<MainModule> {
 const dir = process.env.V4_ENGINE_DIR;
 if (!dir) return loadMicropolisMainModule();
 const { default: init } = await import(/* @vite-ignore */ pathToFileURL(path.join(dir, 'micropolisengine.js')).href);
 const bytes = (name: string) => {
  const b = readFileSync(path.join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
 };
 return init({ wasmBinary: bytes('micropolisengine.wasm'),
  getPreloadedPackage: () => bytes('micropolisengine.data'),
  locateFile: (name: string) => path.join(dir, name), print: () => {}, printErr: console.error });
}

async function city(v4 = true) {
 const e = await engine(), m = new e.Micropolis() as Faction;
 m.setCallback(createNoopJsCallback(e), {});
 m.setFixedSeed(42); m.init();
 for (const [name, value] of Object.entries(PROFILES['v3-pods'])) expect(m.setParam(name, value)).toBe(true);
 m.setEnableDisasters(false); m.setSpeed(3); m.setPasses(1);
 expect(m.loadCity('/cities/haight.cty')).toBe(true);
 m.setCityTax(7);
 for (let tick = 0; tick < 1280; ++tick) m.simTick();
 m.setFunds(600000);
 if (v4) for (const [name, value] of Object.entries(PROFILES['v4-fraktion'])) expect(m.setParam(name, value)).toBe(true);
 m.setParam('podsPerPlant', 40);
 m.setParam('foodImportPrice', 0);
 m.setParam('unrestEnabled', 0);
 m.aiPop = 1000; m.aiCoverage = .5; m.powerReserve = 0;
 m.unemploymentRate = .1;
 return { e, m };
}

function months(m: Faction, count: number) {
 for (let i = 0; i < count; ++i) m.updatePods();
}
function owners(e: MainModule, m: Faction) {
 return new Uint8Array(e.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize());
}
function center(e: MainModule, m: Faction, owner: number) {
 const i = owners(e, m).findIndex(value => value === owner);
 expect(i).toBeGreaterThanOrEqual(0);
 return [Math.floor(i / e.WORLD_H), i % e.WORLD_H] as const;
}
function booking(m: Faction) {
 const revision = m.financeRevision;
 for (let i = 0; i < 4000 && m.financeRevision === revision; ++i) m.simTick();
 expect(m.financeRevision).not.toBe(revision);
}

describe('v4 real WASM faction and isolated ownership', () => {
 it('inherits corrected v3 unchanged and validates all new parameters with profile-off defaults', async () => {
  for (const [key, value] of Object.entries(PROFILES['v3-pods']))
   expect(PROFILES['v4-fraktion'][key as keyof typeof PROFILES['v3-pods']]).toBe(value);
  const { m } = await city(false);
  try {
   expect(m.getParam('aiFactionEnabled')).toBe(0);
   expect(m.getParam('aiAutonomousPods')).toBe(0);
   expect(m.setParam('podsPolicy', 1)).toBe(false);
   months(m, 24);
   expect(m.aiSatisfaction).toBe(100);
   expect(m.aiStrikeStage).toBe(0);
   expect(m.aiBioPlantCount).toBe(0);
   for (const key of Object.keys(PROFILES['v4-fraktion']).filter(key => key.startsWith('ai')))
    expect(m.setParam(key, NaN)).toBe(false);
   for (const [name, value] of [['aiFactionEnabled', 2], ['aiAutonomousPods', -1],
    ['aiSatisfactionInertia', 1.1], ['aiWorkToRuleTaxFactor', 1.1], ['aiFireWeight', -1]] as const)
    expect(m.setParam(name, value)).toBe(false);
  } finally { m.delete(); }
 });
 it('moves monthly with inertia, responds to coverage/throttle/priority/new lots, and uses thresholds 40/20', async () => {
  const { m } = await city();
  try {
   m.setParam('aiAutonomousPods', 0);
   m.aiCoverage = 0; m.updatePods();
   expect(m.aiSatisfaction).toBeCloseTo(89.5);
   const before = m.aiSatisfaction;
   m.setParam('aiThrottle', 1); m.setParam('powerPriority', 1); months(m, 16);
   expect(m.aiSatisfaction).toBeLessThan(20);
   expect(m.aiStrikeStage).toBe(2);
   expect(m.aiWorkFactor()).toBe(0);
   expect(m.automatedJobs).toBe(0);
   m.setParam('aiThrottle', 0); m.aiCoverage = 1; months(m, 12);
   expect(m.aiSatisfaction).toBeGreaterThan(before / 2);
   expect(m.aiStrikeStage).toBe(0);
   m.setParam('aiSatisfactionInertia', 1);
   m.setParam('powerPriority', 0); m.aiCoverage = .5; m.updatePods();
   const noNewLot = m.aiSatisfaction;
   expect(m.autoBuild(1, 1)).toBe(1); m.updatePods();
   expect(m.newAiZones).toBe(1);
   expect(m.aiSatisfaction).toBeCloseTo(noNewLot + 10);
   m.setParam('aiSatisfactionInertia', 0);
   for (const [satisfaction, stage] of [[40, 0], [39.9, 1], [20, 1], [19.9, 2]]) {
    m.aiSatisfaction = satisfaction; m.updatePods(); expect(m.aiStrikeStage).toBe(stage);
   }
  } finally { m.delete(); }
 });
 it('penalizes actual fire in an AI-owned lot', async () => {
  const { e, m } = await city();
  try {
   m.setParam('aiAutonomousPods', 0); m.setParam('aiSatisfactionInertia', 1);
   expect(m.autoBuild(1, 1)).toBe(1); m.aiCoverage = 1;
   const [x, y] = center(e, m, 2);
   m.updatePods(); expect(m.aiSatisfaction).toBe(100);
   m.setTile(x - 1, y, e.Tiles.FIRE.value);
   m.updatePods(); expect(m.aiSatisfaction).toBe(60);
  } finally { m.delete(); }
 });
 it('requires twelve consecutive shortage months; builds free routes even with city debt, then at most one plant per twelve months', async () => {
  const { e, m } = await city();
  try {
   m.setFunds(-1234);
   months(m, 11); expect(m.aiBioPlantCount).toBe(0);
   m.powerReserve = m.getParam('aiReserveHigh'); m.updatePods();
   expect(m.aiShortageMonths).toBe(0);
   m.powerReserve = 0; months(m, 11); expect(m.aiBioPlantCount).toBe(0);
   m.updatePods(); expect(m.aiBioPlantCount).toBe(1);
   expect(m.totalFunds).toBe(-1234);
   expect(m.aiAdmissionsCumulative).toBeGreaterThan(0);
   expect(m.adminAdmissionsCumulative).toBe(0);
   expect(m.checkOwnerInvariant()).toBe(0);
   expect(owners(e, m).filter(owner => owner === 5)).toHaveLength(1);
   months(m, 11); expect(m.aiBioPlantCount).toBe(1);
   m.updatePods(); expect(m.aiBioPlantCount).toBe(2);
   expect(m.totalFunds).toBe(-1234);
  } finally { m.delete(); }
 });
 it('never bypasses viable terrain and does not charge the city on failed autonomous construction', async () => {
  const { e, m } = await city();
  try {
   m.clearMap();
   for (let x = 0; x < e.WORLD_W; ++x)
    for (let y = 0; y < e.WORLD_H; ++y) m.setTile(x, y, e.Tiles.RIVER.value);
   m.setFunds(-1); months(m, 24);
   expect(m.aiBioPlantCount).toBe(0);
   expect(m.totalFunds).toBe(-1);
   expect(m.getParam('autoBuildFailure')).toBe(2);
  } finally { m.delete(); }
 });
 it('uses unemployed intake only, does not mix admin policy, and enables only AI breeding after a further twelve months', async () => {
  const { m } = await city();
  try {
   expect(m.autoBuild(5, 1)).toBe(1);
   m.setParam('podIntake', 0); m.setParam('podBreeding', 0);
   months(m, 12); expect(m.aiBoundHumans).toBe(40); expect(m.adminBoundHumans).toBe(0);
   m.setParam('podsPerPlant', 100); m.setParam('podBirthRate', .1);
   m.unemploymentRate = 0;
   months(m, 11); expect(m.aiPodBreeding).toBe(0); expect(m.aiBoundHumans).toBe(40);
   m.updatePods(); expect(m.aiPodBreeding).toBe(1);
   expect(m.aiBornInPodsCumulative).toBeGreaterThan(0);
   expect(m.adminBornInPodsCumulative).toBe(0);
   expect(m.getParam('podBreeding')).toBe(0);
   expect(m.adminAdmissionsCumulative).toBe(0);
   m.setParam('podIntake', 2); m.updatePods();
   expect(m.adminBoundHumans).toBe(100);
   expect(m.aiAdmissionsCumulative).toBe(40);
   expect(m.boundHumans).toBe(m.adminBoundHumans + m.aiBoundHumans);
   expect(m.bornInPodsCumulative).toBe(m.adminBornInPodsCumulative + m.aiBornInPodsCumulative);
  } finally { m.delete(); }
 });
 it('allows demolition only when empty, retains binding until death, and retires demolished AI plants', async () => {
  const { e, m } = await city();
  try {
   m.unemploymentRate = 0; months(m, 12);
   let [x, y] = center(e, m, 5);
   expect(m.occupiedBioTile(x, y)).toBe(false);
   expect(m.doTool(e.EditingTool.TOOL_BULLDOZER, x, y).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   m.updatePods(); expect(m.aiBioPlantCount).toBe(0);
   m.unemploymentRate = 1; months(m, 11);
   [x, y] = center(e, m, 5);
   expect(m.aiBoundHumans).toBe(40);
   expect(m.doTool(e.EditingTool.TOOL_BULLDOZER, x, y).value).not.toBe(e.ToolResult.TOOLRESULT_OK.value);
   m.setParam('podsPolicy', 1); m.setServiceFunding(1, 1, 1);
   m.policeEffect = 1000;
   m.setParam('podLifetimeMonths', 1); m.updatePods();
   expect(m.aiBoundHumans).toBe(0);
   expect(m.aiDiedInPodsCumulative).toBe(40);
   expect(m.diedInPodsCumulative).toBe(m.adminDiedInPodsCumulative + m.aiDiedInPodsCumulative);
   expect(m.doTool(e.EditingTool.TOOL_BULLDOZER, x, y).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
   m.updatePods(); expect(m.aiBioPlantCount).toBe(0);
  } finally { m.delete(); }
 });
 it('full actual police effect hard-stops a ban; allowed and zero-effect bans permit autonomy; first ban chronology is immutable', async () => {
  const { m } = await city();
  try {
   expect(m.podsPolicy).toBe(0); expect(m.podsForbiddenSinceMonth).toBe(-1);
   expect(m.setParam('podsPolicy', 1)).toBe(true);
   const first = m.podsForbiddenSinceMonth;
   // Funding setters alone are not the enforcement input: actual effects are.
   m.setServiceFunding(1, 1, 1); m.policeEffect = 1000; months(m, 24);
   expect(m.aiBioPlantCount).toBe(0);
   m.setServiceFunding(1, 0, 1);
   booking(m);
   m.aiPop = 1000; m.powerReserve = 0; months(m, 12);
   expect(m.aiBioPlantCount).toBeGreaterThan(0);
   expect(m.podsForbiddenSinceMonth).toBe(first);
   m.setParam('podsPolicy', 0); m.setParam('podsPolicy', 1);
   expect(m.podsForbiddenSinceMonth).toBe(first);
  } finally { m.delete(); }
 });
 it('uses reproducible engine RNG for partial police enforcement and books separate annual counters', async () => {
  const results = [];
  for (let run = 0; run < 2; ++run) {
   const { e, m } = await city();
   try {
    m.setParam('podsPolicy', 1); m.policeEffect = 500;
    months(m, 36);
    expect(m.aiBioPlantCount).toBeGreaterThan(0);
    expect(m.aiAdmissionsCumulative).toBeGreaterThan(0);
    results.push({ plants: m.aiBioPlantCount, admissions: m.aiAdmissionsCumulative,
     map: Array.from(new Uint16Array(e.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2)) });
    m.setParam('aiAutonomousPods', 0); booking(m);
    expect(m.admissions).toBe(m.adminAdmissions + m.aiAdmissions);
    expect(m.diedInPods).toBe(m.adminDiedInPods + m.aiDiedInPods);
    expect(m.bornInPods).toBe(m.adminBornInPods + m.aiBornInPods);
    expect(m.aiAdmissions).toBe(m.aiAdmissionsCumulative);
   } finally { m.delete(); }
  }
  expect(results[0]).toEqual(results[1]);
 });
 it('strike removes AI labor/taxes and physically reduces commerce, industry and farm food output', async () => {
  const samples = [];
  for (const satisfaction of [100, 30, 0]) {
   const { e, m } = await city();
   try {
    m.setParam('aiAutonomousPods', 0); m.setParam('aiSatisfactionInertia', 0);
    m.setParam('jobsPerAiPop', 10); m.setParam('automationYieldPerJob', 10);
    expect(m.autoBuild(1, 20)).toBe(20);
    const o = owners(e, m);
    for (let i = 0; i < o.length; ++i) if (o[i] === 2)
     m.setTile(Math.floor(i / e.WORLD_H), i % e.WORLD_H,
      e.Tiles.RZB.value + 27 | e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value);
    const tiles = new Uint16Array(e.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2);
    const industrial = tiles.findIndex(value => (value & e.MapTileBits.ZONEBIT.value) !== 0 &&
     (value & e.MapTileBits.LOMASK.value) >= e.Tiles.IZB.value &&
     (value & e.MapTileBits.LOMASK.value) <= e.Tiles.IZB.value + 63);
    expect(industrial).toBeGreaterThanOrEqual(0);
    expect(m.setZoneOwner(Math.floor(industrial / e.WORLD_H), industrial % e.WORLD_H, 3)).toBe(true);
    m.aiSatisfaction = satisfaction; m.updatePods();
    booking(m);
    samples.push({ ai: m.aiPop, jobs: m.automatedJobs, tax: m.aiTaxFund, automationTax: m.automationTaxFund,
     commerce: m.comPop, industry: m.indPop, farms: m.farmPop, food: m.foodProduction, strike: m.aiStrikeMonths });
   } finally { m.delete(); }
  }
  expect(samples[0].jobs).toBeGreaterThan(0);
  expect(samples[1].automationTax).toBeLessThan(samples[0].automationTax);
  expect(samples[2].jobs).toBe(0); expect(samples[2].tax).toBe(0); expect(samples[2].automationTax).toBe(0);
  expect(samples[2].commerce).toBeLessThan(samples[0].commerce);
  expect(samples[2].industry).toBeLessThan(samples[0].industry);
  expect(samples[2].farms).toBeLessThan(samples[0].farms);
  expect(samples[2].food).toBeLessThan(samples[0].food);
  expect(samples[2].strike).toBeGreaterThan(0);
 });
});
