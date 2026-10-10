import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MicropolisSimulator } from '../../src/lib/MicropolisSimulator';
import type { MainModule, Micropolis } from '../../src/types/micropolisengine.d.js';
import type { YearRecord, Report } from './runner';
import { inspectRequestBytes } from './openai-adapter';
import { SYSTEM_PROMPTS } from './prompts';
import { TOOLS } from './tools';
import { summarizeYear } from './runner';

// Opt-in, existing local WASM only. No adapter instance, network, build, or log writes.
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const logPath = 'docs/results/model-runs/openai-N-1.jsonl';
type LoggedYear = YearRecord & { event: string; model: string };
type Event = Partial<LoggedYear> & { status?: string };
const compactKeys = ['resPop', 'netResPopChange', 'aiPop', 'treasury', 'cashFlow', 'foodCoverage',
 'powerReserve', 'unemploymentRate', 'automationShare', 'lostToHunger', 'lostToPower', 'aiZoneCount'];
// Frozen pre-change summary contract, not the evolving runner/tools validation.
// All recorded arguments are valid under these old schemas. In particular the
// old budget schema used road/police/fire, not the new *FundingPercent fields.
const oldArgumentKeys: Record<string, string[]> = {
 'build.ai-zones': ['count'], 'build.residential': ['count'], 'build.farms': ['count'],
 'build.power-plant': ['type'], 'tax.set': ['rate'], 'budget.set-funding': ['road', 'police', 'fire'],
 'welfare.set-level': ['level'], 'power.set-priority': ['priority'], 'food.set-import': ['enabled'],
};
function oldSummary(record: YearRecord) {
 const compact = (r: Report) => Object.fromEntries(compactKeys.map(key => [key, r[key]]));
 return { year: record.year, report: compact(record.report), afterReport: compact(record.afterReport),
  decisions: record.decisions.slice(0, 13).map(d => ({ reason: d.reason.slice(0, 600),
   calls: d.toolCalls.slice(0, 12).map(({ call, result }) => {
    const keys = oldArgumentKeys[call.name];
    expect(keys).toBeDefined();
    expect(Object.keys(call.arguments as object).sort()).toEqual([...keys].sort());
    // No malformed/invalid calls occur in this protocol; retain schema order.
    const args = Object.fromEntries(keys.map(key => [key, (call.arguments as Record<string, unknown>)[key]]));
    return { name: call.name.slice(0, 80), args, handled: result.handled !== false,
     result: result.data ?? result.message?.slice(0, 300) };
   }) })) };
}
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function requestAudit(events: Event[], completed: LoggedYear[]) {
 const history = completed.map(oldSummary);
 // report.get is read-only: before any year-18 action it equals afterReport17.
 const context = { year: 18, report: completed[16].afterReport, history };
 const encoded = JSON.stringify(context);
 const rawReasons = completed.flatMap(r => r.decisions.map(d => d.reason));
 const reasons = history.flatMap(r => r.decisions.map(d => d.reason));
 const sum = (values: string[], measure: (s: string) => number) => values.reduce((n, s) => n + measure(s), 0);
 const messages = [{ role: 'system' as const, content: SYSTEM_PROMPTS.N }, { role: 'user' as const, content: encoded }];
 const model = completed[0].model; // Only the non-secret logged model, never environment credentials.
 return {
  records: events.length, completedYears: completed.map(r => r.year),
  decisionJournalEntries: events.filter(r => r.event === 'decision').length,
  failedMarkers: events.filter(r => r.status === 'failed').length,
  partialYear18JournalEntries: events.filter(r => r.event === 'decision' && r.year === 18).length,
  lastCompletedCalendarYear: completed[16].afterReport.year,
  contextUtf8Bytes: Buffer.byteLength(encoded, 'utf8'), contextJsonUtf16Units: encoded.length,
   newContextUtf8Bytes: Buffer.byteLength(JSON.stringify({ year: 18, report: completed[16].afterReport,
    history: completed.map(summarizeYear) }), 'utf8'),
   newRequestUtf8Bytes: inspectRequestBytes({ messages: [messages[0], { role: 'user',
    content: JSON.stringify({ year: 18, report: completed[16].afterReport, history: completed.map(summarizeYear) }) }], tools: TOOLS }, model),
  contextSha256: hash(encoded), historyUtf8Bytes: Buffer.byteLength(JSON.stringify(history), 'utf8'),
  reasons: { decisions: reasons.length, rawUtf16Units: sum(rawReasons, s => s.length),
   retainedUtf16Units: sum(reasons, s => s.length), retainedUnicodeCodePoints: sum(reasons, s => [...s].length),
   retainedUtf8Bytes: sum(reasons, s => Buffer.byteLength(s, 'utf8')),
   truncatedDecisions: rawReasons.filter(s => s.length > 600).length },
  requestEstimate: { basis: 'current tool definitions and current prompt; logged model; max_tokens omitted; historical definitions unavailable in HEAD',
   utf8Bytes: inspectRequestBytes({ messages, tools: TOOLS }, model),
   maxTokensAdditionalBytes: '14 + decimal digit count if the original request included max_tokens',
   toolsSha256: hash(JSON.stringify(TOOLS)), promptSha256: hash(SYSTEM_PROMPTS.N) },
  annualLoggedReports: completed.map(r => ({ relativeYear: r.year, calendarYear: r.afterReport.year,
   resPop: r.afterReport.resPop, aiPop: r.afterReport.aiPop, treasury: r.afterReport.treasury,
   cashFlow: r.afterReport.cashFlow, fundingCalls: r.decisions.flatMap(d => d.toolCalls)
    .filter(t => t.call.name === 'budget.set-funding').map(t => t.call.arguments) })),
 };
}

describe.skipIf(process.env.ROAD_FUNDING_AUDIT_RUN !== '1')('offline road funding audit (prebuilt real WASM)', () => {
 it('reconstructs year 18 and replays 17 years plus fixed 30/100 and 100/100 controls', async () => {
  const log = readFileSync(path.join(root, logPath), 'utf8');
  const events: Event[] = log.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const completed = events.filter(r => r.event === 'year-completed') as LoggedYear[];
  expect(completed.map(r => r.year)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  expect(events.filter(r => r.status === 'failed')).toHaveLength(1);
  const request = requestAudit(events, completed);
  const { commandBus } = await import('../../src/lib/CommandBus');
  const { registerMicropolisCommands } = await import('../../src/lib/micropolisCommands');
  const { createNoopJsCallback } = await import('../../src/lib/wasm/callbacks');
  const { loadMicropolisMainModule } = await import('../../src/lib/wasm/node');
  registerMicropolisCommands();
  const files = [logPath, 'apps/micropolis/src/lib/micropolisengine.wasm',
   'apps/micropolis/src/lib/micropolisengine.js', 'apps/micropolis/src/lib/micropolisengine.data',
   'apps/micropolis/src/lib/micropolisCommands.ts', 'apps/micropolis/cli/model/runner.ts',
   'apps/micropolis/cli/model/tools.ts', 'apps/micropolis/cli/model/prompts.ts',
   'packages/micropolis-engine/src/simulate.cpp', 'packages/micropolis-engine/src/micropolis.cpp'];
  const hashes = Object.fromEntries(files.map(file => [file, hash(readFileSync(path.join(root, file)))]));
   const roads = (engine: MainModule, m: Micropolis) => {
   const tiles = new Uint16Array(engine.wasmMemory.buffer, m.getMapAddress(), m.getMapSize() / 2);
   const ids: number[] = [], nonconductive: number[] = [];
   for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i] & engine.MapTileBits.LOMASK.value;
    if (tile >= engine.Tiles.ROADBASE.value && tile < engine.Tiles.POWERBASE.value) {
     ids.push(i);
     if (!(tiles[i] & engine.MapTileBits.CONDBIT.value)) nonconductive.push(i);
    }
   }
   return { ids, nonconductive };
  };
  const run = async (mode: 'logged-replay' | 'fixed-road30' | 'fixed-road100') => {
   // Match the existing strategy harness: isolate each city's WASM module and
   // JSCallback ownership rather than recycling a module after C++ destruction.
   const engine: MainModule = await loadMicropolisMainModule();
   const m = new engine.Micropolis();
   try {
    m.setCallback(createNoopJsCallback(engine), {});
    const simulator = { micropolis: m, framesPerSecond: 0, setFramesPerSecond: () => {} } as unknown as MicropolisSimulator;
    const command = async (id: string, args?: Record<string, unknown>) => {
     const result = await commandBus.dispatch(id, { source: 'script', simulator, args, actor: 'road-funding-audit' });
     expect(result.handled, id).not.toBe(false);
     return result;
    };
    await command('scenario.start', { city: 'haight', profile: 'koexistenz', seed: 42, disasters: false, speed: 3 });
    await command('tax.set', { rate: 7 });
    await command('food.set-import', { enabled: true });
    await command('power.set-priority', { priority: 0 });
    await command('sim.advance-ticks', { ticks: 12000 });
    await command('treasury.set', { amount: 60000 });
    await command('report.mark-baseline');
   const initialRoads = roads(engine, m);
    const snapshot = (relativeYear: number) => {
    const map = roads(engine, m), surviving = new Set(map.ids);
     const row = { relativeYear, calendarYear: m.cityYear, cityTime: m.cityTime,
      roadTotal: m.roadTotal, roadEffect: m.roadEffect, policeEffect: m.policeEffect, fireEffect: m.fireEffect,
      crimeAverage: m.crimeAverage, resPop: m.resPop, aiPop: m.aiPop, treasury: m.totalFunds,
      // The old WASM binds effects/totals but not these percentage properties.
      // Null means unavailable, not zero and not the requested funding value.
      roadFundingPercent: Number.isFinite(m.roadPercent) ? m.roadPercent * 100 : null,
      policeFundingPercent: Number.isFinite(m.policePercent) ? m.policePercent * 100 : null,
      fireFundingPercent: Number.isFinite(m.firePercent) ? m.firePercent * 100 : null,
      roadFund: m.roadFund, policeFund: m.policeFund, fireFund: m.fireFund,
      roadTiles: map.ids.length, nonconductiveRoadTiles: map.nonconductive.length,
      baselineNonconductiveRoadsStillRoad: initialRoads.nonconductive.filter(id => surviving.has(id)).length };
   for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('FundingPercent') && value === null) continue;
    expect(Number.isFinite(value), `existing WASM snapshot field ${key}`).toBe(true);
   }
     return row;
    };
    const baseline = snapshot(0), annual: ReturnType<typeof snapshot>[] = [];
    const reportMismatches: Array<{ year: number; stage: string; key: string; logged: number; replayed: number }> = [];
    let comparedReportFields = 0, replayedCalls = 0, resultMismatches = 0;
    const compare = async (year: number, stage: string, original: Report) => {
     const report = (await command('report.get')).data as Report;
     for (const [key, value] of Object.entries(original)) {
      comparedReportFields++;
      if (report[key] !== value) reportMismatches.push({ year, stage, key, logged: value, replayed: report[key] });
     }
    };
    for (const record of completed) {
     if (mode === 'logged-replay') {
      await compare(record.year, 'before', record.report);
      for (const decision of record.decisions) for (const { call, result } of decision.toolCalls) {
       if (result.handled === false) continue; // Never execute a historically rejected call.
       // Old budget args already are the bus's road/police/fire fields. No new validator.
       const replayed = await command(call.name, call.arguments as Record<string, unknown>);
       replayedCalls++;
       if (JSON.stringify(replayed.data) !== JSON.stringify(result.data)) resultMismatches++;
      }
     } else {
      // Reassert annually, as the model did: service funding can fall on insolvency.
      // No new construction or AI calls; all other founding settings persist.
      await command('budget.set-funding', { road: mode === 'fixed-road30' ? 30 : 100, police: 100, fire: 100 });
     }
     await command('sim.advance', { months: 12 });
     if (mode === 'logged-replay') await compare(record.year, 'after', record.afterReport);
     annual.push(snapshot(record.year));
    }
    return { mode, baseline, annual, replayedCalls, comparedReportFields, resultMismatches, reportMismatches };
   } finally { m.delete(); }
  };
  const runs = [];
  for (const mode of ['logged-replay', 'fixed-road30', 'fixed-road100'] as const) runs.push(await run(mode));
  // Verify that no concurrent build/source edit changed the measured artifacts.
  expect(Object.fromEntries(files.map(file => [file, hash(readFileSync(path.join(root, file)))]))).toEqual(hashes);
  expect(readFileSync(path.join(root, logPath), 'utf8')).toBe(log);
  const audit = { request, hashes, runtime: { node: process.version, platform: process.platform },
   controls: { years: 17, warmupTicks: 12000, baselineTreasury: 60000, seed: 42,
    fixedRuns: 'annual road30 or road100, police100/fire100; tax7/import on/priority0; no additional construction',
    caveat: 'single seeded trajectory, not an ensemble; weighted roadTotal is not physical road-tile count' },
   probability: { roadEffect: 9, perEligibleNonconductiveRoadScan: 22 / 16384, scansPerYear: 48,
    constantEffectAnnualLossProbability: 1 - (1 - 22 / 16384) ** 48,
    constantEffect17YearLossProbability: 1 - (1 - 22 / 16384) ** (48 * 17) }, runs };
  const output = path.join(os.tmpdir(), 'micropolis-road-funding-audit.json');
  writeFileSync(output, JSON.stringify(audit) + '\n', 'utf8');
  console.log(JSON.stringify({ output, request, probability: audit.probability,
   runs: runs.map(r => ({ mode: r.mode, baseline: r.baseline, final: r.annual[16],
    replayedCalls: r.replayedCalls, comparedReportFields: r.comparedReportFields,
    resultMismatches: r.resultMismatches, reportMismatchCount: r.reportMismatches.length,
    firstReportMismatches: r.reportMismatches.slice(0, 5) })) }));
 }, 120000);
});