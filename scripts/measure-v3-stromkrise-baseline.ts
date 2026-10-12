import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCitySession } from '../apps/dipolis/cli/model/city-session';
import { advanceMonthsStepwise } from '../apps/dipolis/src/lib/city-run/advance';
import type { Report } from '../apps/dipolis/src/lib/city-run/protocol';
import { setupScenario, readReport } from '../apps/dipolis/src/lib/city-run/replay';

export const BASELINE_CONTROLS = {
 automationLimit: .9, welfareLevel: 1, tax: 7, road: 100, police: 100, fire: 100,
 powerPriority: 0, farmsFirstYear: 10, aiLotsWhenCashFlowNegative: 30,
 coalRule: 'one coal plant/year when pre-decision powerReserve < .1; unchanged, no affordability tuning',
 autoBuildRules: 0, pods: 'none', throttle: 0,
 futurePodSchedule: 'B/C/E request one plant/year in years 1..3, maximum three actual plants; failed unaffordable builds are not retried',
 futureE: 'unemployed intake years 1..5; none + breeding from year 6',
} as const;

export function baselineGate(annualCount: number, monthlyCount: number, minimumFunds: number,
 unemploymentObserved: boolean, financeReconciled: boolean) {
 return { complete: annualCount === 30 && monthlyCount === 360,
  treasuryNeverEmpty: minimumFunds > 0, unemploymentExists: unemploymentObserved,
  financeReconciled,
  passed: annualCount === 30 && monthlyCount === 360 && minimumFunds > 0 &&
   unemploymentObserved && financeReconciled };
}

export function summaryRow(strategy: string, year: number, r: Report) {
 return { strategy, year, resPop: r.resPop, boundHumans: r.boundHumans,
  diedInPods: r.diedInPodsCumulative, bornInPods: r.bornInPodsCumulative,
  aiPop: r.aiPop, suspendedAi: r.suspendedAi, reserve: r.powerReserve,
  plantPower: r.plantPower, plantFoodDemand: r.plantFoodDemand, unrest: r.unrest,
  stage: r.unrestStage, cashFlow: r.cashFlow, totalFunds: r.treasury,
  unemploymentRate: r.unemploymentRate, welfareCost: r.welfareCost,
  fires: r.sabotageFires, plantCount: r.plantCount };
}

export function csv(rows: Record<string, unknown>[]) {
 const keys = Object.keys(rows[0]);
 return [keys.join(','), ...rows.map(r => keys.map(k => r[k]).join(','))].join('\n') + '\n';
}

export async function measureBaseline(outputSuffix = '') {
 process.chdir(fileURLToPath(new URL('..', import.meta.url)));
 const weightsText = readFileSync('apps\\micropolis\\src\\lib\\params\\v2-unruhe.json', 'utf8');
 const weightsHash = createHash('sha256').update(weightsText).digest('hex');
 const engineHashes = Object.fromEntries(['js', 'wasm', 'data'].map(extension => [extension,
 createHash('sha256').update(readFileSync(`apps\\micropolis\\src\\lib\\micropolisengine.${extension}`)).digest('hex')]));
 const measuredEngineId = `sha256:${createHash('sha256').update(JSON.stringify(engineHashes)).digest('hex')}`;
 const session = await createCitySession();
 try {
  const setupCommands: unknown[] = [];
  await setupScenario(async (id, args) => {
   const result = await session.dispatch(id, args);
   setupCommands.push({ id, args, result });
   return result;
  }, { startMap: 'haight', seed: 42, profile: 'v3-pods', scenario: 'stromkrise', autoBuildRules: 0 });
  const start = await readReport(session.dispatch);
  const controls: unknown[] = [];
  for (const [id, args] of [
   ['automation.set-limit', { limit: .9 }], ['welfare.set-level', { level: 1 }],
   ['budget.set-funding', { road: 100, police: 100, fire: 100 }],
   ['power.set-priority', { priority: 0 }], ['tax.set', { rate: 7 }],
  ] as const) {
   const result = await session.dispatch(id, args);
   if (result.handled === false) throw new Error(`Control failed: ${id}`);
   controls.push({ id, args, result });
  }
  const annual: Record<string, unknown>[] = [], monthly: Record<string, unknown>[] = [];
  const buildEvents: Record<string, unknown>[] = [], ledger: Record<string, unknown>[] = [];
  let minimumFunds = start.treasury, unemploymentObserved = false, buildCost = 0, bookedCashFlow = 0;
  let firstEmpty: Record<string, unknown> | null = null;
  let runtimeFailure: Record<string, unknown> | null = null;
  const observe = (year: number, month: number, phase: string, report: Report) => {
   minimumFunds = Math.min(minimumFunds, report.treasury);
   if (report.treasury <= 0 && firstEmpty === null)
    firstEmpty = { year, month, phase, cityTime: session.micropolis.cityTime,
     funds: report.treasury, report, negativeLedger: ledger.filter(r => Number(r.delta) < 0),
     failedBuilds: buildEvents.filter(r => r.failed) };
  };
  years: for (let year = 1; year <= 30; year++) {
   const before = await readReport(session.dispatch);
   const build = async (id: string, args: Record<string, unknown>) => {
    const fundsBefore = session.micropolis.totalFunds;
    const result = await session.dispatch(id, args);
    const after = await readReport(session.dispatch);
    const data = result.data as { built?: number; requested?: number } | undefined;
    const cost = fundsBefore - after.treasury;
    buildCost += cost;
    buildEvents.push({ year, month: 0, id, args, result, cost,
     failed: result.handled === false || data?.built === 0 ||
      (data?.requested !== undefined && Number(data.built) < data.requested) });
    observe(year, 0, id, after);
   };
   if (year === 1) await build('build.farms', { count: 10 });
   if (before.cashFlow < 0) await build('build.ai-zones', { count: 30 });
   if (before.powerReserve < .1) await build('build.power-plant', { type: 'coal' });
   for (let month = 1; month <= 12; month++) {
    const steps = advanceMonthsStepwise(session.micropolis, 1);
    let previousFunds = session.micropolis.totalFunds;
    for (;;) {
     const phaseBeforeTick = session.micropolis.phaseCycle;
     const fundingBeforeTick = { road: session.micropolis.roadPercent,
      police: session.micropolis.policePercent, fire: session.micropolis.firePercent };
     let next: IteratorResult<number, boolean>;
     try {
      next = steps.next();
     } catch (error) {
      const interrupted = await readReport(session.dispatch);
      runtimeFailure = { year, month, message: String(error), fundsBeforeTick: previousFunds,
       fundsAtFailure: interrupted.treasury, interruptedReport: interrupted,
       unbookedTreasuryDelta: interrupted.treasury - previousFunds };
      observe(year, month, 'interrupted budget tick', interrupted);
      break years;
     }
     if (next.done) {
      if (!next.value) throw new Error('Month advance did not finish');
      break;
     }
     const funds = session.micropolis.totalFunds;
     minimumFunds = Math.min(minimumFunds, funds);
     const budgetCompleted = phaseBeforeTick === 9 && session.micropolis.cityTime % 48 === 0;
     if (funds !== previousFunds || budgetCompleted) {
      const r = await readReport(session.dispatch);
      const delta = funds - previousFunds;
      bookedCashFlow += delta;
      const income = r.taxFund + r.aiTaxFund + r.automationTaxFund;
      // Budgeting uses pre-budget percentages; post-budget percentages can reset
      // to 100% despite zero spend and cannot reconstruct the actual booking.
      const requestedServices = Math.trunc(Math.fround(r.roadFund * fundingBeforeTick.road)) +
       Math.trunc(Math.fround(r.policeFund * fundingBeforeTick.police)) +
       Math.trunc(Math.fround(r.fireFund * fundingBeforeTick.fire));
      const availableForServices = previousFunds + income - r.foodImportCost - r.welfareCost;
      const services = Math.min(requestedServices, Math.max(0, availableForServices));
      const expectedDelta = income - services - r.foodImportCost - r.welfareCost;
      ledger.push({ year, month, cityTime: session.micropolis.cityTime, delta,
       fundsBefore: previousFunds, fundsAfter: funds, income, services,
       requestedServices, availableForServices, fundingBeforeTick,
       foodImportCost: r.foodImportCost, welfareCost: r.welfareCost,
       expectedDelta, cashFlow: r.cashFlow, report: r });
      observe(year, month, 'post-tick/census', r);
     }
     previousFunds = funds;
    }
    const after = await readReport(session.dispatch);
    unemploymentObserved ||= after.resPop > 0 && after.unemploymentRate > 0;
    observe(year, month, 'post-census monthly', after);
    monthly.push({ ...summaryRow('A', year, after), month,
     cityTime: session.micropolis.cityTime, report: after });
   }
   const after = await readReport(session.dispatch);
   annual.push({ ...summaryRow('A', year, after), before, after,
    builds: buildEvents.filter(r => r.year === year) });
  }
  const final = await readReport(session.dispatch);
  const reconstructedFunds = start.treasury - buildCost + bookedCashFlow;
  const completedBookingsReconciled = ledger.every(r => r.delta === r.expectedDelta &&
    r.cashFlow === Math.max(-32768, Math.min(32767, Number(r.delta))));
  const interruptedDelta = Number(runtimeFailure?.unbookedTreasuryDelta ?? 0);
  const treasurySumReconciled = reconstructedFunds + interruptedDelta === final.treasury;
  const financeReconciled = runtimeFailure === null && treasurySumReconciled && completedBookingsReconciled;
  const gate = baselineGate(annual.length, monthly.length, minimumFunds, unemploymentObserved, financeReconciled);
  if (readFileSync('apps\\micropolis\\src\\lib\\params\\v2-unruhe.json', 'utf8') !== weightsText)
   throw new Error('Unrest weights changed during measurement');
  const result = { profile: 'v3-pods', scenario: 'stromkrise', strategy: 'A prerequisite ONLY',
   engineId: measuredEngineId, engineHashes, formulaVersion: 'v2-unruhe-2026.10-human-decline-automation-v1',
   weights: JSON.parse(weightsText), weightsSha256: weightsHash, seed: 42,
   fixedControls: BASELINE_CONTROLS, noOptimization: true, setupCommands, controls, start,
   finance: { startFunds: start.treasury, buildCost, bookedCashFlow, reconstructedFunds,
    finalFunds: final.treasury, interruptedDelta, treasurySumReconciled,
    completedBookingsReconciled, financeReconciled,
    equation: 'finalFunds = startFunds - sum(actual build costs) + sum(post-tick budget bookings)',
    budgetEquation: 'booking = human taxes + AI taxes + automation taxes - actual services - food imports - welfare',
    interruptedEquation: 'If the engine aborts, finalFunds = reconstructedFunds + interruptedDelta; this is NOT a completed budget booking.',
    incomeAndExpenseAssertion: 'Every completed budget booking equals its unsaturated income-minus-expenses ledger; cashFlow equals the signed-short-clamped booking.' },
   gate, minimumFunds, firstEmpty, runtimeFailure,
   completedAnnualSamples: annual.length, completedMonthlySamples: monthly.length,
   failedBuilds: buildEvents.filter(r => r.failed), buildEvents,
   unemploymentMonths: monthly.filter(r => Number(r.unemploymentRate) > 0 && Number(r.resPop) > 0).length,
   annual, monthly, ledger, experimentsStarted: false,
   nextAction: gate.passed ? 'Baseline passes; coordinator may authorize B–E with the fixed common controls.'
    : 'STOP. No B–E experiments, no base changes, no further tuning.' };
  mkdirSync('docs\\results', { recursive: true });
  const stem = 'docs\\results\\v3-pods-stromkrise-welfare1-ai30-baseline' + outputSuffix;
  writeFileSync(stem + '.json', JSON.stringify(result, null, 2) + '\n');
  writeFileSync(stem + '-annual.csv', csv(annual.map(({ before, after, builds, ...row }) => row)));
  writeFileSync(stem + '-monthly.csv', csv(monthly.map(({ report, ...row }) => row)));
  writeFileSync(stem + '-5year.csv', csv(annual.filter(r => Number(r.year) % 5 === 0)
   .map(({ before, after, builds, ...row }) => row)));
  console.log(JSON.stringify({ engineId: measuredEngineId, gate, minimumFunds,
   firstEmpty: firstEmpty && { year: firstEmpty.year, month: firstEmpty.month, funds: firstEmpty.funds },
   runtimeFailure,
   finance: result.finance, unemploymentMonths: result.unemploymentMonths,
   failedBuilds: result.failedBuilds.length, experimentsStarted: false }));
  return result;
 } finally { session.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const result = await measureBaseline(process.argv.includes('--complete') ? '-complete' : '');
 if (!result.gate.passed) process.exitCode = 1;
}
