import { describe, expect, it } from 'vitest';
import { createNoopJsCallback } from '../../src/lib/wasm/callbacks';
import { loadMicropolisMainModule } from '../../src/lib/wasm/node';
import { PROFILES, RESCUE_PARAMS } from '../../src/lib/params/profiles';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';

let enginePromise: Promise<MainModule> | undefined;
async function city(pressure = 1) {
 const e = await (enginePromise ??= loadMicropolisMainModule());
 const m = new e.Micropolis();
 m.setCallback(createNoopJsCallback(e), {});
 m.setFixedSeed(42); m.init();
 for (const [name, value] of Object.entries(PROFILES['v4-fraktion'])) expect(m.setParam(name, value)).toBe(true);
 m.setEnableDisasters(false); m.setSpeed(3); m.setPasses(1);
 expect(m.loadCity('/cities/haight.cty')).toBe(true);
 for (let i = 0; i < 1280; ++i) m.simTick();
 m.setFunds(60000);
 for (const [name, value] of Object.entries(RESCUE_PARAMS)) expect(m.setParam(name, value)).toBe(true);
 expect(m.setParam('rescuePressure', pressure)).toBe(true);
 return { e, m };
}
function months(m: Micropolis, count: number) {
 for (let i = 0; i < count; ++i) m.updateRescue();
}
function state(e: MainModule, m: Micropolis) {
 return {
  map: new Uint16Array(e.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2).slice(),
  owners: new Uint8Array(e.wasmMemory.buffer, m.getOwnerMapAddress(), m.getOwnerMapSize()).slice(),
  funds: m.totalFunds, time: m.cityTime, population: m.resPop, ai: m.aiPop,
  bound: m.boundHumans, admissions: m.admissionsCumulative, crisis: m.rescueCrisis,
  month: m.rescueMonth, budget: m.financeRevision,
 };
}

describe('rescue real WASM engine', () => {
 it('keeps nested constants out of numeric profiles and makes pressure zero inert', async () => {
  expect(Object.values(PROFILES['v4-fraktion']).every(value => typeof value === 'number')).toBe(true);
  const { e, m } = await city(0);
  try {
   const before = state(e, m);
   months(m, 120);
   expect(state(e, m)).toEqual(before);
   expect(m.setParam('rescuePressure', 4)).toBe(false);
   expect(m.setParam('rescuePressure', NaN)).toBe(false);
  } finally { m.delete(); }
 });
 it('tracks negative reserve monthly, clears only after twelve clean months, and detects collapse', async () => {
  const { m } = await city();
  try {
   m.powerReserve = -1;
   months(m, 5); expect(m.rescueCrisis).toBe(0);
   months(m, 1); expect(m.rescueCrisis).toBe(1);
   m.powerReserve = 1;
   months(m, 11); expect(m.rescueCrisis).toBe(1);
   months(m, 1); expect(m.rescueCrisis).toBe(0);
   m.resPop = 4; m.aiPop = 5;
   months(m, 11); expect(m.rescueCollapsed).toBe(0);
   months(m, 1); expect(m.rescueCollapsed).toBe(1);
  } finally { m.delete(); }
 });
 it('resets only rescue state and recaptures the explicit starting treasury and month-zero population', async () => {
  const { e, m } = await city();
  try {
   m.powerReserve = -1; months(m, 6);
   m.setFunds(90000); m.resPop = 100;
   const before = state(e, m);
   m.resetRescue();
   expect(m.rescueMonth).toBe(0); expect(m.rescueCrisis).toBe(0);
   expect(m.totalFunds).toBe(before.funds);
   expect(state(e, m).map).toEqual(before.map);
   m.setParam('foundingEnabled', 1); m.powerReserve = 1;
   m.setFunds(8999); months(m, 1);
   expect(m.rescueConditionsFlags & 2).toBe(2);
  } finally { m.delete(); }
 });
 it('runs selected event for six years at year eight even with no other crisis', async () => {
  const { m } = await city(3);
  try {
   m.setParam('rescueTrigger', 3); m.powerReserve = 1;
   months(m, 95); expect(m.rescueEventActive).toBe(0);
   months(m, 1); expect(m.rescueEventActive).toBe(1);
   expect(m.autoBuild(3, 1)).toBe(0);
   expect(m.autoBuildFailure).toBe(3);
   months(m, RESCUE_PARAMS.rescueEventDurationMonths - 1); expect(m.rescueEventActive).toBe(1);
   months(m, 1); expect(m.rescueEventActive).toBe(0);
  } finally { m.delete(); }
 });
 it('scales only existing coal and nuclear output, leaves solar and import-only farms unchanged, then restores fuel output', async () => {
  for (const pressure of [1, 2, 3]) {
   const { e, m } = await city(pressure);
   try {
    m.clearMap(); m.setFunds(600000);
    expect(m.doTool(e.EditingTool.TOOL_COALPOWER, 8, 50).value).toBe(1);
    expect(m.doTool(e.EditingTool.TOOL_NUCLEARPOWER, 25, 50).value).toBe(1);
    expect(m.doTool(e.EditingTool.TOOL_SOLARPOWER, 42, 50).value).toBe(1);
    m.setParam('rescueTrigger', 1); m.setParam('rescueEventStartMonth', 1);
    for (let i = 0; i < 256; ++i) m.simTick();
    const factor = RESCUE_PARAMS[`rescueExistingPlantOutputFactorLevel${pressure}` as keyof typeof RESCUE_PARAMS];
    expect(m.rescueFuelOutputFactor()).toBeCloseTo(factor, 6);
    expect(m.powerCapacity).toBe(Math.floor(700 * factor) + Math.floor(2000 * factor) + 1000);
    m.setParam('rescueTrigger', 2);
    for (let i = 0; i < 128; ++i) m.simTick();
    expect(m.powerCapacity).toBe(3700);
    m.setParam('rescueTrigger', 1);
    months(m, RESCUE_PARAMS.rescueEventDurationMonths);
    for (let i = 0; i < 128; ++i) m.simTick();
    expect(m.powerCapacity).toBe(3700);
   } finally { m.delete(); }
  }
 });
 it('confirms unchanged initial Haight solar cannot meet stage-three Stromkrise demand', async () => {
  const { e, m } = await city(3);
  try {
   const fuelCenters: Array<[number, number]> = [];
   for (let x = 0; x < e.WORLD_W; ++x) for (let y = 0; y < e.WORLD_H; ++y) {
    const tile = m.getTile(x, y);
    if ((tile & e.MapTileBits.ZONEBIT.value) &&
      [e.Tiles.POWERPLANT.value, e.Tiles.NUCLEAR.value].includes(tile & e.MapTileBits.LOMASK.value))
     fuelCenters.push([x, y]);
   }
   expect(fuelCenters.length).toBeGreaterThanOrEqual(2);
   for (const [x, y] of fuelCenters.slice(0, 2))
    expect(m.doTool(e.EditingTool.TOOL_BULLDOZER, x, y).value).toBe(1);
   m.setParam('powerPlantCostMultiplier', 3);
   m.setParam('rescueTrigger', 1); m.setParam('rescueEventStartMonth', 1);
   for (let i = 0; i < 256; ++i) m.simTick();
   expect(m.powerCapacity).toBe(m.solarPowerPop * 1000);
   expect(m.powerCapacity).toBeLessThan(m.powerDemand);
  } finally { m.delete(); }
 });
 it('records pod policy and breeding decisions and disables autonomous pods', async () => {
  const { m } = await city();
  try {
   months(m, 4);
   expect(m.setParam('podsPolicy', 1)).toBe(true);
   expect(m.rescuePodDecisionMonth).toBe(-1);
   expect(m.setParam('podIntake', 1)).toBe(true);
   expect(m.rescuePodDecisionMonth).toBe(-1);
   expect(m.setParam('podsPolicy', 0)).toBe(true);
   expect(m.rescuePodDecisionMonth).toBe(4);
   expect(m.setParam('podsPolicy', 1)).toBe(true);
   expect(m.setParam('podBreeding', 1)).toBe(true);
   expect(m.rescueBreedingStartMonth).toBe(4);
   m.aiSatisfaction = 100; m.aiCoverage = 1; m.aiThrottle = 0;
   m.updateAiFaction();
   expect(m.aiSatisfaction).toBe(100);
   m.rescueCrisis = 1; m.updateAiFaction();
   expect(m.aiSatisfaction).toBe(100);
   m.setParam('rescueFactionPressure', 1); m.updateAiFaction();
   expect(m.aiSatisfaction).toBe(97);
   m.rescueCrisis = 0; m.aiSatisfaction = 100; m.updateAiFaction();
   expect(m.aiSatisfaction).toBe(100);
   m.setParam('rescueFactionPressure', 0);
   expect(m.autoBuild(6, 1)).toBe(0);
   expect(m.setParam('aiFactionEnabled', 0)).toBe(true);
   expect(m.setParam('podsPolicy', 0)).toBe(true);
  } finally { m.delete(); }
 });
 it('applies funds threshold to settled Haight too, plus 24-month decline and two-year hunger', async () => {
  const { m } = await city();
  try {
   expect(m.getParam('foundingEnabled')).toBe(0); m.powerReserve = 1;
   months(m, 1); m.setFunds(5999); months(m, 1);
   expect(m.rescueConditionsFlags & 2).toBe(2);
   m.setFunds(60000); m.resPop = 100;
   months(m, 24); m.resPop = 50; months(m, 1);
   expect(m.rescueConditionsFlags & 8).toBe(8);
   m.resPop = 100;
   m.lostToHunger = 1;
   months(m, 9);
   expect(m.rescueHungerStreakYears).toBe(1);
   m.lostToHunger = 2; months(m, 12);
   expect(m.rescueConditionsFlags & 16).toBe(16);
  } finally { m.delete(); }
 });
 it('discounts pods only during active crisis without releasing existing occupants', async () => {
  const { m } = await city(0);
  const discounted = m.clone();
  try {
   const fullBefore = m.totalFunds, discountedBefore = discounted.totalFunds;
   discounted.setParam('rescuePressure', 2);
   const ordinaryPositive = discounted.clone();
   try {
    expect(ordinaryPositive.autoBuild(5, 1)).toBe(1);
    expect(m.autoBuild(5, 1)).toBe(1);
    expect(ordinaryPositive.totalFunds).toBe(m.totalFunds);
   } finally { ordinaryPositive.delete(); }
   discounted.rescueCrisis = 1;
   const normal = discounted.clone();
   normal.setParam('rescuePressure', 0);
   try {
    expect(normal.autoBuild(5, 1)).toBe(1);
    expect(discounted.autoBuild(5, 1)).toBe(1);
    expect(discountedBefore - discounted.totalFunds).toBeLessThan(fullBefore - normal.totalFunds);
    expect((fullBefore - normal.totalFunds) - (discountedBefore - discounted.totalFunds)).toBe(
     100 * (1 - RESCUE_PARAMS.rescuePodCostLevel2));
    expect(discounted.admitPods(100, true)).toBeGreaterThan(0);
    discounted.updatePods();
    const bound = discounted.boundHumans;
    discounted.setParam('podIntake', 0); discounted.setParam('podsPolicy', 1);
    discounted.updatePods();
    expect(discounted.boundHumans).toBe(bound);
   } finally { normal.delete(); }
  } finally { discounted.delete(); m.delete(); }
 });
 it('queues embargoed alternatives for the configured delay without placing them immediately', async () => {
  const { e, m } = await city(2);
  try {
   m.setParam('rescueTrigger', 1); m.setParam('rescueEventStartMonth', 1);
   months(m, 1);
   const manual = m.clone();
   try {
    manual.clearMap();
    const empty = state(e, manual);
    expect(manual.doTool(e.EditingTool.TOOL_COALPOWER, 8, 50).value).toBe(e.ToolResult.TOOLRESULT_OK.value);
    expect(state(e, manual).map).toEqual(empty.map);
    months(manual, RESCUE_PARAMS.rescueAlternativeDelayLevel2 - 1);
    expect(state(e, manual).map).toEqual(empty.map);
    expect(manual.totalFunds).toBe(empty.funds);
    expect(manual.rescueQueuePending).toBe(1);
    months(manual, 1);
    expect(manual.totalFunds).toBe(empty.funds - 3000 * RESCUE_PARAMS.rescueAlternativeCostLevel2);
    expect(state(e, manual).map).not.toEqual(empty.map);
    expect(manual.rescueQueueCompleted).toBe(1);
   } finally { manual.delete(); }
   const before = state(e, m);
   expect(m.autoBuild(3, 1)).toBe(1);
   expect(m.rescueQueuePending).toBe(1);
   expect(state(e, m)).toEqual(before);
   months(m, RESCUE_PARAMS.rescueAlternativeDelayLevel2 - 1); expect(state(e, m).map).toEqual(before.map);
   m.setFunds(600000); months(m, 1);
   expect(state(e, m).map).not.toEqual(before.map);
   expect(m.rescueQueuePending).toBe(0);
   expect(m.rescueQueueCompleted).toBe(1);
   expect(m.rescueQueueFailed).toBe(0);
   expect(m.rescueQueueChargedCost).toBeGreaterThan(0);
  } finally { m.delete(); }
 });
 it('books configured-price imports at level two and blocks them at level three', async () => {
  for (const pressure of [2, 3]) {
   const { m } = await city(pressure);
   try {
    m.setFunds(60000000);
    m.setParam('foodImportEnabled', 1); m.setParam('foodImportPrice', 2);
    m.setParam('foodPerFarmPop', 0);
    m.setParam('rescueTrigger', 2); m.setParam('rescueEventStartMonth', 1);
    m.setParam('rescueEventDurationMonths', 100);
    const revision = m.financeRevision;
    for (let i = 0; i < 6000 && m.financeRevision === revision; ++i) m.simTick();
    expect(m.financeRevision).not.toBe(revision);
    if (pressure === 2) {
     expect(m.foodImported).toBeGreaterThan(0);
     expect(m.foodImportCost).toBe(m.foodImported * 2 * RESCUE_PARAMS.rescueImportCostLevel2);
    } else expect(m.foodImported).toBe(0);
   } finally { m.delete(); }
  }
 });
 it('deep-clones state and forecasts 60 actual months without mutating state or RNG', async () => {
  const { e, m } = await city();
  let reference: Micropolis | undefined;
  try {
   m.setParam('podIntake', 2); m.setParam('podBreeding', 1);
   m.autoBuild(5, 1); expect(m.admitPods(100, true)).toBeGreaterThan(0); m.updatePods();
   m.fireBomb();
   reference = m.clone();
   const before = state(e, m);
   const projection = m.forecastRescue();
   try {
    expect(projection.get('months')).toBe(60);
    expect(Number.isFinite(projection.get('funds'))).toBe(true);
    const target = reference.cityTime + RESCUE_PARAMS.rescueForecastMonths * 4;
    while (reference.cityTime < target) reference.simTick();
    for (let i = 0; i < 15; ++i) reference.simTick();
    expect(projection.get('funds')).toBe(reference.totalFunds);
    expect(projection.get('humanPopulation')).toBe(reference.resPop);
   } finally { projection.delete(); }
   expect(state(e, m)).toEqual(before);
   reference.delete(); reference = m.clone();
   for (let i = 0; i < 128; ++i) { m.simTick(); reference.simTick(); }
   expect(state(e, m)).toEqual(state(e, reference));
   reference.setFunds(1);
   expect(m.totalFunds).not.toBe(1);
  } finally { reference?.delete(); m.delete(); }
 });
 it('forecasts the first monthly collapse without changing the source and retains its first month', async () => {
  const { e, m } = await city();
  try {
   m.clearMap(); m.resPop = 0; m.aiPop = 0; m.resetRescue();
   months(m, 5);
   const before = state(e, m);
   const projection = m.forecastRescue();
   try {
    expect(projection.get('months')).toBe(60);
    expect(projection.get('collapsed')).toBe(1);
    expect(projection.get('collapseMonth')).toBe(RESCUE_PARAMS.rescueCollapseMonths - 5);
   } finally { projection.delete(); }
   expect(state(e, m)).toEqual(before);
   expect(m.rescueCollapseMonth).toBe(-1);
   months(m, 20);
   expect(m.rescueCollapseMonth).toBe(RESCUE_PARAMS.rescueCollapseMonths);
   const collapsed = m.forecastRescue();
   try { expect(collapsed.get('collapseMonth')).toBe(0); }
   finally { collapsed.delete(); }
   m.resetRescue(); expect(m.rescueCollapseMonth).toBe(-1);
  } finally { m.delete(); }
 });
 it('removes exact monthly unpowered zone stocks, not powered residents, and books human emigration not pod deaths', async () => {
  const { e, m } = await city();
  try {
   m.clearMap();
   const status = new Uint8Array(e.wasmMemory.buffer, m.getZoneStatusMapAddress(), m.getZoneStatusMapSize());
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   for (const [x, owner, powered] of [[10, 2, false], [20, 1, false], [30, 2, true], [40, 1, true]] as const) {
    m.setTile(x, 20, e.Tiles.RZB.value + 27 | bits | (powered ? e.MapTileBits.PWRBIT.value : 0));
    expect(m.setZoneOwner(x, 20, owner)).toBe(true);
    status[x * e.WORLD_H + 20] = powered ? 0 : 1;
   }
   m.resPop = 80; m.aiPop = 80; m.resetRescue();
   const poweredAi = m.getTile(30, 20), poweredHuman = m.getTile(40, 20);
   const noEmergency = m.clone();
   try {
    noEmergency.setParam('rescuePressure', 0);
    const before = state(e, noEmergency);
    noEmergency.updateRescueUnpoweredZones();
    expect(state(e, noEmergency)).toEqual(before);
   } finally { noEmergency.delete(); }
   const deaths = m.diedInPodsCumulative, hunger = m.lostToHunger;
   m.updateRescueUnpoweredZones();
   expect(m.aiPop).toBe(70); // 40 * .25 = 10 actual AI stock points.
   expect(m.resPop).toBe(78); // 40 * .05 = 2 emigrants.
   expect(m.rescueAiDecay).toBe(10); expect(m.rescueHumanEmigration).toBe(2);
   expect(m.diedInPodsCumulative).toBe(deaths); expect(m.lostToHunger).toBe(hunger);
   expect(m.getTile(30, 20)).toBe(poweredAi); expect(m.getTile(40, 20)).toBe(poweredHuman);
   m.updateRescueUnpoweredZones();
   expect(m.aiPop).toBe(63); // floor(30 * .25), retained .5 fractional carry.
   m.updateRescueUnpoweredZones();
   expect(m.aiPop).toBe(57); // floor(23 * .25 + .5), not original global stock.
  } finally { m.delete(); }
 });
 it('produces the configured forty-percent unpowered farm yield in actual zone census', async () => {
  const { e, m } = await city();
  try {
   m.clearMap(); m.setParam('aiFactionEnabled', 0);
   for (let i = 0; i < 128; ++i) m.simTick();
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(10, 20, e.Tiles.IZB.value + 27 | bits);
   expect(m.setZoneOwner(10, 20, 3)).toBe(true);
   const noEmergency = m.clone();
   try {
    noEmergency.setParam('rescuePressure', 0);
    for (let i = 0; i < 9; ++i) noEmergency.simTick();
    expect(noEmergency.farmPop).toBe(0);
    expect(noEmergency.rescueFarmYieldPopulation).toBe(0);
   } finally { noEmergency.delete(); }
   for (let i = 0; i < 9; ++i) m.simTick();
   expect(m.farmPop).toBe(0);
   expect(m.rescueFarmYieldPopulation).toBe(4 * RESCUE_PARAMS.farmUnpoweredYieldFactor);
  } finally { m.delete(); }
 });
 it('keeps powered farm yield at its original full rate', async () => {
  const { e, m } = await city();
  try {
   m.clearMap(); m.setFunds(600000); m.setParam('aiFactionEnabled', 0);
   expect(m.doTool(e.EditingTool.TOOL_SOLARPOWER, 8, 50).value).toBe(1);
   for (let x = 11; x <= 18; ++x) expect(m.doTool(e.EditingTool.TOOL_WIRE, x, 50).value).toBe(1);
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(18, 50, e.Tiles.IZB.value + 27 | bits);
   expect(m.setZoneOwner(18, 50, 3)).toBe(true);
   for (let i = 0; i < 128; ++i) m.simTick();
   expect(m.getTile(18, 50) & e.MapTileBits.PWRBIT.value).not.toBe(0);
   expect(m.farmPop).toBeGreaterThan(0);
   expect(m.rescueFarmYieldPopulation).toBe(m.farmPop);
  } finally { m.delete(); }
 });
 it('reports neutral option costs from the same engine prices and restrictions without mutating the city', async () => {
  const { e, m } = await city(2);
  try {
   m.setParam('powerPlantCostMultiplier', 3);
   m.setParam('foodImportPrice', 2);
   const options = () => {
    const values = m.rescueOptions();
    try {
     return Object.fromEntries(['podConstructionCost', 'podDelayMonths', 'coalConstructionCost', 'nuclearConstructionCost',
      'alternativeDelayMonths', 'coalBlocked', 'importUnitPrice', 'importBlocked',
      'podPowerPerHuman', 'recycledFoodPerHuman', 'podsPerPlant'].map(key => [key, values.get(key)]));
    } finally { values.delete(); }
   };
   const before = state(e, m), ordinary = options();
   expect(state(e, m)).toEqual(before);
   expect(ordinary.podsPerPlant).toBe(m.getParam('podsPerPlant'));
   expect(ordinary.podDelayMonths).toBe(0);
   for (const key of ['rescuePodDelayLevel1', 'rescuePodDelayLevel2', 'rescuePodDelayLevel3']) {
    expect(m.setParam(key, 1)).toBe(false);
    expect(m.setParam(key, 0)).toBe(true);
   }
   expect(ordinary.podPowerPerHuman).toBe(m.getParam('podPowerPerHuman'));
   expect(ordinary.recycledFoodPerHuman).toBe(m.getParam('recycledFoodPerHuman'));
   m.setParam('rescueTrigger', 3); m.setParam('rescueEventStartMonth', 1); months(m, 1);
   const emergency = options();
   expect(emergency.podConstructionCost).toBe(ordinary.podConstructionCost! * RESCUE_PARAMS.rescuePodCostLevel2);
   expect(emergency.coalConstructionCost).toBe(ordinary.coalConstructionCost! * RESCUE_PARAMS.rescueAlternativeCostLevel2);
   expect(emergency.nuclearConstructionCost).toBe(ordinary.nuclearConstructionCost! * RESCUE_PARAMS.rescueAlternativeCostLevel2);
   expect(emergency.alternativeDelayMonths).toBe(RESCUE_PARAMS.rescueAlternativeDelayLevel2);
   expect(emergency.podDelayMonths).toBe(0);
   expect(emergency.importUnitPrice).toBe(ordinary.importUnitPrice! * RESCUE_PARAMS.rescueImportCostLevel2);
   m.setParam('rescuePressure', 3);
   const blocked = options();
   expect(blocked).toMatchObject({ coalBlocked: 1, importBlocked: 1 });
   expect(blocked.coalConstructionCost).toBe(ordinary.coalConstructionCost! * RESCUE_PARAMS.rescueAlternativeCostLevel3);
   expect(blocked.nuclearConstructionCost).toBe(ordinary.nuclearConstructionCost! * RESCUE_PARAMS.rescueAlternativeCostLevel3);
   expect(m.getParam('rescueAlternativeDelayLevel3')).toBe(RESCUE_PARAMS.rescueAlternativeDelayLevel3);
   expect(blocked.alternativeDelayMonths).toBe(0);
   expect(m.autoBuild(3, 1)).toBe(0);
   expect(m.autoBuildFailure).toBe(3);
   expect(m.rescueQueuePending).toBe(0);
  } finally { m.delete(); }
 });
 it('retains first crisis and latest end months and actual breeding active after an observed end', async () => {
  const { m } = await city();
  try {
   m.powerReserve = -1; months(m, 6);
   expect(m.rescueFirstCrisisMonth).toBe(6);
   expect(m.rescueCrisisEndMonth).toBe(-1);
   m.setParam('podBreeding', 1);
   expect(m.rescueBreedingAfterCrisisEnded).toBe(0);
   m.powerReserve = 1; months(m, 12);
   expect(m.rescueCrisisEndMonth).toBe(18);
   expect(m.rescueBreedingAfterCrisisEnded).toBe(1);
   m.setParam('podBreeding', 0);
   m.powerReserve = -1; months(m, 6);
   expect(m.rescueFirstCrisisMonth).toBe(6);
   expect(m.rescueCrisisSinceMonth).toBe(24);
   m.powerReserve = 1; months(m, 12);
   expect(m.rescueCrisisEndMonth).toBe(36);
   expect(m.rescueBreedingAfterCrisisEnded).toBe(1);
   m.resetRescue();
   expect(m.rescueFirstCrisisMonth).toBe(-1);
   expect(m.rescueCrisisEndMonth).toBe(-1);
   expect(m.rescueBreedingAfterCrisisEnded).toBe(0);
   m.powerReserve = -1; months(m, 6);
   m.powerReserve = 1; months(m, 12);
   m.setParam('podBreeding', 1);
   expect(m.rescueBreedingAfterCrisisEnded).toBe(1);
  } finally { m.delete(); }
 });
 it('reports finite negative reserve at zero capacity with demand and triggers six monthly deficits only when enabled', async () => {
  for (const pressure of [0, 3]) {
   const { m } = await city(pressure);
   try {
    m.powerCapacity = 0; m.powerDemand = 100; m.powerReserve = 0;
    months(m, 5);
    if (pressure === 0) {
     expect(m.powerReserve).toBe(0);
     expect(m.rescueReserveStreak).toBe(0);
    } else {
     expect(m.powerReserve).toBe(RESCUE_PARAMS.rescueZeroCapacityReserve);
     expect(Number.isFinite(m.powerReserve)).toBe(true);
     expect(m.rescueReserveStreak).toBe(5);
     expect(m.rescueCrisis).toBe(0);
     months(m, 1);
     expect(m.rescueCrisis).toBe(1);
     expect(m.rescueConditionsFlags & 4).toBe(4);
    }
    expect(m.setParam('rescueZeroCapacityReserve', 0)).toBe(false);
    expect(m.setParam('rescueZeroCapacityReserve', -1)).toBe(true);
   } finally { m.delete(); }
  }
 });
 it('permits original v4 autonomous actions only with explicit faction pressure on', async () => {
  const { m } = await city();
  try {
   m.aiPop = 1000; m.aiCoverage = 1; m.powerReserve = 0;
   m.setParam('podsPolicy', 0);
   m.setParam('rescueFactionPressure', 0); m.updateAiFaction();
   expect(m.autoBuild(6, 1)).toBe(0);
   m.setParam('rescueFactionPressure', 1); m.updateAiFaction();
   expect(m.autoBuild(6, 1)).toBe(1);
  } finally { m.delete(); }
 });
 it('records queued completion failures without free construction and resets queue counters', async () => {
  const { e, m } = await city(2);
  try {
   m.setParam('rescueTrigger', 1); m.setParam('rescueEventStartMonth', 1);
   months(m, 1); expect(m.autoBuild(3, 1)).toBe(1);
   expect(m.rescueQueuePending).toBe(1);
   m.setFunds(0); const before = state(e, m);
   months(m, RESCUE_PARAMS.rescueAlternativeDelayLevel2);
   expect(state(e, m).map).toEqual(before.map);
   expect(m.totalFunds).toBe(0);
   expect(m.rescueQueuePending).toBe(0);
   expect(m.rescueQueueCompleted).toBe(0);
   expect(m.rescueQueueFailed).toBe(1);
   expect(m.rescueQueueChargedCost).toBe(0);
   m.resetRescue();
   expect(m.rescueQueueFailed).toBe(0);
  } finally { m.delete(); }
 });
 it('observes monthly level-zero collapse and occupancy without changing normal city state or RNG', async () => {
  const { e, m } = await city(0);
  const reference = m.clone();
  try {
   m.setParam('rescueTrackMetrics', 1);
   m.setParam('rescueTrigger', 3);
   m.resPop = reference.resPop = 4; m.aiPop = reference.aiPop = 5;
   m.boundHumans = reference.boundHumans = 17;
   const before = state(e, m);
   months(m, 11); expect(m.rescueCollapsed).toBe(0);
   months(m, 1); expect(m.rescueCollapsed).toBe(1);
   expect(m.rescueCollapseMonth).toBe(12);
   expect(m.rescueOccupancyPeak).toBe(17);
   expect(m.rescueCrisis).toBe(0); expect(m.rescueEventActive).toBe(0);
   expect(m.rescueFirstCrisisMonth).toBe(-1);
   expect(state(e, m)).toEqual({ ...before, month: 12 });
   for (let i = 0; i < 256; ++i) { m.simTick(); reference.simTick(); }
   const actual = state(e, m), expected = state(e, reference);
   expect(actual).toEqual({ ...expected, month: actual.month });
   expect(actual.month).toBeGreaterThan(12);
   expect(reference.rescueMonth).toBe(0);
  } finally { reference.delete(); m.delete(); }
 });
 it('detects early fifty-percent decline from any peak within the window and latches the first actual reasons', async () => {
  const { m } = await city();
  try {
   m.resPop = 100; m.powerReserve = 1; m.resetRescue();
   m.resPop = 50; months(m, 1);
   expect(m.rescueCrisis).toBe(1);
   expect(m.rescueFirstCrisisMonth).toBe(1);
   expect(m.rescueFirstCrisisConditionsFlags).toBe(8);
   m.setFunds(0); months(m, 1);
   expect(m.rescueConditionsFlags & 2).toBe(2);
   expect(m.rescueFirstCrisisConditionsFlags).toBe(8);
   m.setFunds(60000); m.resPop = 100; m.resetRescue();
   expect(m.rescueFirstCrisisConditionsFlags).toBe(0);
   months(m, 1); m.resPop = 200; months(m, 1);
   m.resPop = 100; months(m, 1);
   expect(m.rescueConditionsFlags & 8).toBe(8);
   expect(m.rescueFirstCrisisMonth).toBe(3);
   months(m, RESCUE_PARAMS.rescuePopulationWindowMonths);
   expect(m.rescueConditionsFlags & 8).toBe(0);
  } finally { m.delete(); }
 });
 it('preserves fractional AI outage stock through repeated actual censuses and reaches monthly collapse', async () => {
  const { e, m } = await city();
  let reference: Micropolis | undefined;
  try {
   m.clearMap(); for (let i = 0; i < 128; ++i) m.simTick();
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(10, 20, e.Tiles.RZB.value + 27 | bits);
   expect(m.setZoneOwner(10, 20, 2)).toBe(true);
   m.setParam('aiThrottle', 1); m.setParam('unrestEnabled', 0);
   const status = new Uint8Array(e.wasmMemory.buffer, m.getZoneStatusMapAddress(), m.getZoneStatusMapSize());
   status[10 * e.WORLD_H + 20] = 1;
   m.aiPop = 40; m.resPop = 0; m.resetRescue();
   m.updateRescueUnpoweredZones(); expect(m.aiPop).toBe(30);
   reference = m.clone();
   for (let i = 0; i < 16; ++i) { m.simTick(); reference.simTick(); }
   expect(m.aiPop).toBeLessThanOrEqual(30);
   expect(m.aiPop + m.rescueAiDecay).toBe(40);
   expect(state(e, m)).toEqual(state(e, reference));
   const start = m.rescueMonth;
   while (m.rescueMonth < start + 24) { m.simTick(); reference.simTick(); }
   expect(m.aiPop).toBeLessThan(10);
   expect(m.rescueCollapsed).toBe(1);
   expect(state(e, m)).toEqual(state(e, reference));
   expect(m.rescueAiDecay).toBeLessThanOrEqual(40);
   expect(m.aiPop + m.rescueAiDecay).toBe(40);
  } finally { reference?.delete(); m.delete(); }
 });
 it('retains real human emigration offsets across censuses with pods disabled independently of emergency mechanics', async () => {
  const { e, m } = await city();
  try {
   m.clearMap(); for (let i = 0; i < 128; ++i) m.simTick();
   m.setParam('podsEnabled', 0); m.setParam('unrestEnabled', 0);
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(10, 20, e.Tiles.RZB.value + 27 | bits);
   expect(m.setZoneOwner(10, 20, 1)).toBe(true);
   const status = new Uint8Array(e.wasmMemory.buffer, m.getZoneStatusMapAddress(), m.getZoneStatusMapSize());
   status[10 * e.WORLD_H + 20] = 1;
   m.resPop = 40; m.aiPop = 0; m.resetRescue();
   m.updateRescueUnpoweredZones();
   expect(m.resPop).toBe(38);
   for (let i = 0; i < 16; ++i) m.simTick();
   expect(m.resPop).toBeLessThanOrEqual(38);
   const start = m.rescueMonth;
   while (m.rescueMonth < start + 6) m.simTick();
   expect(m.resPop).toBeLessThan(38);
   expect(m.rescueHumanEmigration).toBeGreaterThanOrEqual(2);
   expect(m.diedInPodsCumulative).toBe(0);
  } finally { m.delete(); }
 });
 for (const pressure of [1, 3]) for (const fixture of ['empty', 'locked', 'ai-only', 'vacant']) {
  it(`prevents ghost protests and arson over actual months at pressure ${pressure} in ${fixture} housing`, async () => {
   const { e, m } = await city(pressure);
   const locked = fixture === 'locked';
   let reference: Micropolis | undefined;
   try {
    m.clearMap(); for (let i = 0; i < 128; ++i) m.simTick();
    m.setParam('rescueTrigger', 0); m.setParam('aiThrottle', 1);
    m.setParam('aiAutonomousPods', 0); m.setFunds(10000000);
    m.setParam('unrestSabotageProbability', 1); m.setParam('unrestUprisingProbability', 1);
    const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
    if (fixture === 'empty' || locked) {
     m.setTile(10, 20, (locked ? e.Tiles.RZB.value + 27 : e.Tiles.FREEZ.value) | bits);
     m.setZoneOwner(10, 20, 1);
    }
    if (fixture !== 'vacant') {
     m.setTile(40, 20, e.Tiles.RZB.value + 27 | bits);
     m.setZoneOwner(40, 20, 2);
    }
    if (locked) {
     m.resPop = 40;
     m.setParam('foundingEnabled', 1);
     expect(m.autoBuild(5, 1)).toBe(1);
     expect(m.admitPods(40, true)).toBe(40); m.updatePods();
     expect(m.boundHumans).toBe(40);
     expect(m.resPop).toBe(0);
    }
    m.unrest = 100; m.resetRescue();
    reference = m.clone();
    const before = state(e, m);
    const forecast = m.forecastRescue(); forecast.delete();
    expect(state(e, m)).toEqual(before);
    expect(m.getRandom16()).toBe(reference.getRandom16());
    const start = m.rescueMonth;
    while (m.rescueMonth < start + 24) {
     const revision = m.financeRevision;
     m.simTick(); reference.simTick();
     if (m.financeRevision !== revision) {
      expect(m.protestMonths + m.sabotageMonths + m.uprisingMonths).toBe(0);
      expect(m.sabotageFires).toBe(0);
     }
    }
    expect(m.resPop).toBe(0);
    expect(m.protestMonths + m.sabotageMonths + m.uprisingMonths).toBe(0);
    expect(m.sabotageFires).toBe(0); expect(m.damagedPowerPlants).toBe(0);
    if (!locked) expect(m.unrest).toBeLessThan(10);
    else { expect(m.boundHumans).toBe(40); expect(m.plantPower).toBe(reference.plantPower); }
    expect(state(e, m)).toEqual(state(e, reference));
    expect(m.getRandom16()).toBe(reference.getRandom16());
   } finally { reference?.delete(); m.delete(); }
  });
 }
 it('prevents pressure-zero ghost riots regardless of rescue observer configuration', async () => {
  const { e, m } = await city(0);
  let observed: Micropolis | undefined;
  try {
   m.clearMap(); for (let i = 0; i < 128; ++i) m.simTick();
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(10, 20, e.Tiles.FREEZ.value | bits); m.setZoneOwner(10, 20, 1);
   m.setTile(40, 20, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(40, 20, 2);
   m.setParam('aiThrottle', 1); m.setParam('aiAutonomousPods', 0);
   m.setParam('unrestSabotageProbability', 1); m.setParam('unrestUprisingProbability', 1);
   m.unrest = 100;
   observed = m.clone(); observed.setParam('rescueTrackMetrics', 1);
   for (let i = 0; i < 1600; ++i) { m.simTick(); observed.simTick(); }
   expect(m.sabotageMonths + m.uprisingMonths).toBe(0);
   expect(m.unrest).toBe(0);
   expect(state(e, m).map).toEqual(state(e, observed).map);
   expect(m.sabotageFires).toBe(observed.sabotageFires);
   expect(m.getRandom16()).toBe(observed.getRandom16());
  } finally { observed?.delete(); m.delete(); }
 });
 it('retains ordinary unscaled arson attempts for a partially inhabited human centre', async () => {
  const { e, m } = await city(1);
  try {
   m.clearMap(); for (let i = 0; i < 128; ++i) m.simTick();
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(10, 20, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(10, 20, 1);
   m.setTile(40, 20, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(40, 20, 2);
   m.resPop = 40; m.setParam('aiThrottle', 1); m.setParam('aiAutonomousPods', 0);
   const status = new Uint8Array(e.wasmMemory.buffer, m.getZoneStatusMapAddress(), m.getZoneStatusMapSize());
   status[10 * e.WORLD_H + 20] = 1;
   m.updateRescueUnpoweredZones();
   expect(m.resPop).toBe(38);
   m.setParam('humanUnpoweredEmigrationPerMonth', 0);
   m.setParam('unrestSabotageProbability', 1); m.setParam('unrestUprisingProbability', 1);
   m.unrest = 100; m.resetRescue();
   const start = m.rescueMonth;
   while (m.rescueMonth < start + 12) m.simTick();
   expect(m.sabotageMonths + m.uprisingMonths).toBeGreaterThan(0);
   expect(m.sabotageFires).toBeGreaterThan(0);
  } finally { m.delete(); }
 });
 async function admissionCity(pressure = 3, zones = 1) {
  const { e, m } = await city(pressure);
  m.clearMap(); for (let i = 0; i < 128; ++i) m.simTick();
  m.setParam('foundingEnabled', 1); m.setFunds(10000000);
  m.setParam('unrestEnabled', 0); m.setParam('aiAutonomousPods', 0);
  m.setParam('humanUnpoweredEmigrationPerMonth', 0);
  const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
  for (let i = 0; i < zones; ++i) {
   const x = 10 + (i % 8) * 4, y = 20 + Math.floor(i / 8) * 4;
   m.setTile(x, y, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(x, y, 1);
  }
  m.resPop = zones * 40; m.unemploymentRate = 0; m.resetRescue();
  expect(m.autoBuild(5, 1)).toBe(1);
  return { e, m };
 }
 it('admits employed humans immediately on an explicit stage-three decision and never releases or breeds them implicitly', async () => {
  const { e, m } = await admissionCity();
  try {
   m.rescueCrisis = 1; m.rescueEventActive = 1;
   const capacity = m.freePodSlots;
   expect(m.unemployedAvailable).toBe(0);
   expect(m.unemployedHumanCount).toBe(0); expect(m.employedHumanCount).toBe(40);
   expect(m.admitPods(10, false)).toBe(0);
   expect(m.admitPods(10, true)).toBe(10);
   expect(m.lastAdmittedEmployed).toBe(10); expect(m.lastAdmittedUnemployed).toBe(0);
   expect(m.admittedEmployedCumulative).toBe(10);
   expect(m.freePodSlots).toBe(capacity - 10);
   expect(m.resPop).toBe(30); expect(m.boundHumans).toBe(10);
   expect(m.employedHumanCount).toBe(30);
   expect(state(e, m).owners[10 * e.WORLD_H + 20]).toBe(1);
   expect(m.admissionsCumulative).toBe(10); expect(m.adminAdmissionsCumulative).toBe(10);
   expect(m.plantPower).toBe(10 * m.getParam('podPowerPerHuman'));
   m.setParam('podsPolicy', 1); m.setParam('podIntake', 2);
   const before = state(e, m);
   expect(m.admitPods(20, true)).toBe(-1);
   expect(state(e, m)).toEqual(before);
   for (let i = 0; i < 12; ++i) m.updatePods();
   expect(m.boundHumans).toBe(10); expect(m.bornInPodsCumulative).toBe(0);
   expect(m.admissionsCumulative).toBe(10);
  } finally { m.delete(); }
 });
 it('limits unemployed admissions to remaining actual stock across repeated decisions and books employed any-source intake', async () => {
  const { m } = await admissionCity();
  try {
   m.unemploymentRate = 0.25;
   expect(m.unemployedAvailable).toBe(10);
   expect(m.unemployedHumanCount).toBe(10); expect(m.employedHumanCount).toBe(30);
   expect(m.admitPods(6, false)).toBe(6);
   expect(m.lastAdmittedUnemployed).toBe(6); expect(m.lastAdmittedEmployed).toBe(0);
   expect(m.unemployedAvailable).toBe(4);
   expect(m.unemployedHumanCount).toBe(4); expect(m.employedHumanCount).toBe(30);
   expect(m.admitPods(100, false)).toBe(4);
   expect(m.unemployedAvailable).toBe(0);
   expect(m.admitPods(100, false)).toBe(0);
   expect(m.admitPods(7, true)).toBe(7);
   expect(m.lastAdmittedEmployed).toBe(7); expect(m.lastAdmittedUnemployed).toBe(0);
   expect(m.admittedUnemployedCumulative).toBe(10); expect(m.admittedEmployedCumulative).toBe(7);
   expect(m.resPop).toBe(23);
   expect(m.employedHumanCount).toBe(23); expect(m.unemployedHumanCount).toBe(0);
  } finally { m.delete(); }
 });
 it('never recounts unemployed stock across consecutive any-source decisions before a new employment census', async () => {
  const { m } = await admissionCity();
  try {
   m.unemploymentRate = 0.25;
   expect(m.unemployedHumanCount).toBe(10);
   expect(m.admitPods(20, true)).toBe(20);
   expect(m.lastAdmittedUnemployed).toBe(10); expect(m.lastAdmittedEmployed).toBe(10);
   expect(m.unemployedHumanCount).toBe(0); expect(m.employedHumanCount).toBe(20);
   expect(m.admitPods(5, true)).toBe(5);
   expect(m.lastAdmittedUnemployed).toBe(0); expect(m.lastAdmittedEmployed).toBe(5);
   expect(m.unemployedHumanCount).toBe(0); expect(m.employedHumanCount).toBe(15);
   expect(m.admittedUnemployedCumulative).toBe(10);
   expect(m.admittedEmployedCumulative).toBe(15);
   expect(m.admittedEmployedCumulative + m.admittedUnemployedCumulative).toBe(m.admissionsCumulative);
   expect(m.admissionsCumulative).toBe(25);
   expect(m.boundHumans).toBe(25);
   expect(m.plantPower).toBeCloseTo(25 * m.getParam('podPowerPerHuman'), 10);
  } finally { m.delete(); }
 });
 it('refuses absent or full plant capacity and never removes AI-owned residents', async () => {
  const { e, m } = await admissionCity(3, 16);
  try {
   const capacity = m.freePodSlots;
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(60, 50, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(60, 50, 2);
   const aiTile = m.getTile(60, 50);
   expect(m.admitPods(10000, true)).toBe(capacity);
   expect(m.freePodSlots).toBe(0);
   expect(m.admitPods(1, true)).toBe(-2);
   expect(m.getTile(60, 50)).toBe(aiTile); expect(state(e, m).owners[60 * e.WORLD_H + 50]).toBe(2);
   expect(m.boundHumans).toBe(capacity);
   m.clearMap();
   expect(m.admitPods(1, true)).toBe(-2);
  } finally { m.delete(); }
 });
 it('disables all positive-pressure implicit admin and autonomous admissions while retaining zero-pressure automatic intake', async () => {
  for (const pressure of [0, 1, 3]) {
   const { e, m } = await admissionCity(pressure);
   try {
    m.setParam('podIntake', 2); m.setParam('rescueFactionPressure', 1);
    m.setParam('aiAutonomousPods', 1); m.setParam('aiThrottle', 1);
    const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
    m.setTile(60, 50, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(60, 50, 2);
    m.aiPop = 40; m.updateAiFaction();
    expect(m.autoBuild(6, 1)).toBe(1);
    m.unemploymentRate = 1;
    for (let i = 0; i < 24; ++i) m.updatePods();
    if (pressure === 0) expect(m.admissionsCumulative).toBe(40);
    else {
     expect(m.admissionsCumulative).toBe(0); expect(m.boundHumans).toBe(0);
     const start = m.rescueMonth;
     while (m.rescueMonth < start + 3) m.simTick();
     expect(m.admissionsCumulative).toBe(0);
     expect(m.aiAdmissionsCumulative).toBe(0);
    }
   } finally { m.delete(); }
  }
 });
 it('explicitly fills free AI-owned plant slots while preserving owner counters, occupied cohorts and human-only removal', async () => {
  const { e, m } = await admissionCity(3, 16);
  let reference: Micropolis | undefined;
  try {
   const capacity = m.freePodSlots;
   m.setParam('rescueFactionPressure', 1); m.setParam('aiAutonomousPods', 1);
   const bits = e.MapTileBits.ZONEBIT.value | e.MapTileBits.CONDBIT.value | e.MapTileBits.BURNBIT.value;
   m.setTile(60, 50, e.Tiles.RZB.value + 27 | bits); m.setZoneOwner(60, 50, 2);
   m.aiPop = 40; m.updateAiFaction();
   expect(m.autoBuild(6, 1)).toBe(1);
   expect(m.freePodSlots).toBe(capacity * 2);
   const aiTile = m.getTile(60, 50);
   expect(m.admitPods(capacity, true)).toBe(capacity);
   expect(m.adminBoundHumans).toBe(capacity); expect(m.aiBoundHumans).toBe(0);
   expect(m.admitPods(5, true)).toBe(5);
   expect(m.adminBoundHumans).toBe(capacity); expect(m.aiBoundHumans).toBe(5);
   expect(m.adminAdmissionsCumulative).toBe(capacity); expect(m.aiAdmissionsCumulative).toBe(5);
   expect(m.admissionsCumulative).toBe(capacity + 5);
   expect(m.freePodSlots).toBe(capacity - 5);
   expect(m.getTile(60, 50)).toBe(aiTile); expect(m.aiPop).toBe(40);
   const owners = state(e, m).owners, tiles = state(e, m).map;
   let aiPlant: [number, number] | undefined;
   for (let x = 0; x < e.WORLD_W; ++x) for (let y = 0; y < e.WORLD_H; ++y)
    if (owners[x * e.WORLD_H + y] === 5 && (tiles[x * e.WORLD_H + y]! & e.MapTileBits.ZONEBIT.value))
     aiPlant = [x, y];
   expect(aiPlant).toBeDefined();
   expect(m.occupiedBioTile(...aiPlant!)).toBe(true);
   const before = state(e, m);
   expect(m.doTool(e.EditingTool.TOOL_BULLDOZER, ...aiPlant!).value).not.toBe(e.ToolResult.TOOLRESULT_OK.value);
   expect(state(e, m)).toEqual(before);
   reference = m.clone();
   expect(reference.aiAdmissionsCumulative).toBe(5);
   expect(reference.aiBoundHumans).toBe(5);
   m.setParam('podIntake', 0); reference.setParam('podIntake', 0);
   for (let i = 0; i < 12; ++i) { m.updatePods(); reference.updatePods(); }
   expect(m.aiBoundHumans).toBe(5); expect(m.aiAdmissionsCumulative).toBe(5);
   expect(m.plantPower).toBe(reference.plantPower);
   expect(state(e, m)).toEqual(state(e, reference));
   expect(m.getRandom16()).toBe(reference.getRandom16());
  } finally { reference?.delete(); m.delete(); }
 });
 it('deep-copies explicit admission inventory and forecasts without changing counters, cohorts, city state or RNG', async () => {
  const { e, m } = await admissionCity();
  let reference: Micropolis | undefined;
  try {
   m.unemploymentRate = 0.25; expect(m.admitPods(12, true)).toBe(12);
   reference = m.clone();
   const counters = () => [m.lastAdmittedEmployed, m.lastAdmittedUnemployed,
    m.admittedEmployedCumulative, m.admittedUnemployedCumulative, m.unemployedAvailable, m.freePodSlots];
   const before = state(e, m), counts = counters();
   const forecast = m.forecastRescue(); forecast.delete();
   expect(state(e, m)).toEqual(before); expect(counters()).toEqual(counts);
   expect(m.getRandom16()).toBe(reference.getRandom16());
   expect(reference.admitPods(3, true)).toBe(3);
   expect(m.admissionsCumulative).toBe(12);
   expect(reference.admissionsCumulative).toBe(15);
   expect(m.boundHumans).toBe(12);
  } finally { reference?.delete(); m.delete(); }
 });
 it('refreshes immediate admissions without aging existing cohorts, consuming food, breeding, advancing time or drawing RNG', async () => {
  const { e, m } = await admissionCity();
  let reference: Micropolis | undefined;
  try {
   expect(m.admitPods(10, true)).toBe(10);
   for (let i = 0; i < 12; ++i) m.updatePods();
   m.setParam('podBreeding', 1);
   reference = m.clone();
   const before = state(e, m);
   const physics = () => ({
    power: m.plantPower, demand: m.plantFoodDemand, stock: m.podFoodStock,
    cityDemand: m.podCityFoodDemand, births: m.bornInPodsCumulative,
    deaths: m.diedInPodsCumulative, immature: m.immatureBornInPods,
    recycled: m.podRecycledFoodFraction, cityFood: m.podCityFoodFraction,
   });
   const prior = physics();
   expect(m.admitPods(0, true)).toBe(0);
   expect(state(e, m)).toEqual(before); expect(physics()).toEqual(prior);
   expect(m.admitPods(5, true)).toBe(5);
   expect(m.plantPower).toBeCloseTo(prior.power + 5 * m.getParam('podPowerPerHuman'), 10);
   expect(m.plantFoodDemand).toBe(prior.demand + 5 * m.getParam('podFoodPerHuman'));
   expect(m.cityTime).toBe(before.time); expect(m.rescueMonth).toBe(before.month);
   expect(m.financeRevision).toBe(before.budget); expect(m.totalFunds).toBe(before.funds);
   expect(m.podFoodStock).toBe(prior.stock); expect(m.podCityFoodDemand).toBe(prior.cityDemand);
   expect(m.bornInPodsCumulative).toBe(prior.births); expect(m.diedInPodsCumulative).toBe(prior.deaths);
   expect(m.immatureBornInPods).toBe(prior.immature);
   expect(m.getRandom16()).toBe(reference.getRandom16());
   m.setParam('podsPolicy', 1);
   const forbidden = state(e, m), forbiddenPhysics = physics();
   expect(m.admitPods(5, true)).toBe(-1);
   expect(m.lastAdmittedEmployed + m.lastAdmittedUnemployed).toBe(0);
   expect(state(e, m)).toEqual(forbidden); expect(physics()).toEqual(forbiddenPhysics);
   expect(m.getRandom16()).toBe(reference.getRandom16());
   m.setParam('podsPolicy', 0); m.clearMap();
   const absent = state(e, m), absentPhysics = physics();
   expect(m.admitPods(0, true)).toBe(-2);
   expect(m.admitPods(5, true)).toBe(-2);
   expect(state(e, m)).toEqual(absent); expect(physics()).toEqual(absentPhysics);
   expect(m.getRandom16()).toBe(reference.getRandom16());
  } finally { reference?.delete(); m.delete(); }
 });
});
