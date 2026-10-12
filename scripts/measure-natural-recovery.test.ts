import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideYear } from '../apps/dipolis/cli/model/runner';
import type { YearRecord } from '../apps/dipolis/src/lib/city-run/protocol';
import { assertHumanGrowthGate, peopleFriendlyCalls, RecordedPolicyAdapter } from './measure-natural-recovery';

test('recorded adapter re-executes previously failed calls and retains reasons, not outcomes', async () => {
 const record: YearRecord = { year: 1, report: {}, afterReport: {}, termination: 'done', decisions: [
  { reason: 'Recorded reason.', toolCalls: [
   { call: { id: 'tax', name: 'tax.set', arguments: { rate: 5 } }, result: { handled: false } },
   { call: { id: 'budget', name: 'budget.set-funding', arguments: { road: 100, police: 90, fire: 80 } },
    result: { data: { historical: true } } },
  ] },
  { reason: 'Recorded end.', toolCalls: [] },
 ] };
 const executed: unknown[] = [];
 const actual = await decideYear(new RecordedPolicyAdapter([record]), async (name, args) => {
  executed.push({ name, args });
  return { data: { actual: true } };
 }, { year: 1, report: {}, history: [] }, 'R');
 assert.equal(actual.termination, 'done');
 assert.deepEqual(executed, [
  { name: 'tax.set', args: { rate: 5 } },
  { name: 'budget.set-funding', args: { road: 100, police: 90, fire: 80 } },
 ]);
 assert.equal(actual.decisions[0].reason, 'Recorded reason.');
 assert.deepEqual(actual.decisions[0].toolCalls[0].result, { data: { actual: true } });
});

test('authorized variant three changes only the first-year power plant from variant two', () => {
 for (let year = 1; year <= 30; ++year) {
  const original = peopleFriendlyCalls(year, { powerReserve: 0 }, 2)
   .map(({ id, ...call }) => call);
  const corrected = peopleFriendlyCalls(year, { powerReserve: 0 }, 3)
   .map(({ id, ...call }) => call);
  const expected = original.map(call => year === 1 && call.name === 'build.power-plant'
   ? { ...call, arguments: { type: 'nuclear' } } : call);
  assert.deepEqual(corrected, expected);
 }
});

test('explicit growth measurement fails below 500 and accepts the exact threshold', () => {
 assert.throws(() => assertHumanGrowthGate(481), /threshold failed/);
 assert.throws(() => assertHumanGrowthGate(Number.NaN), /threshold failed/);
 assert.doesNotThrow(() => assertHumanGrowthGate(500));
});

test('recorded policy still obeys the normal runner annual twelve-attempt budget', async () => {
 const record: YearRecord = { year: 1, report: {}, afterReport: {}, termination: 'call-limit', decisions: [
  { reason: 'Thirteen attempts.', toolCalls: Array.from({ length: 13 }, (_, index) => ({
   call: { id: String(index), name: 'tax.set', arguments: { rate: 7 } }, result: {},
  })) },
 ] };
 let dispatched = 0;
 const actual = await decideYear(new RecordedPolicyAdapter([record]), async () => {
  ++dispatched;
  return { data: {} };
 }, { year: 1, report: {}, history: [] }, 'R');
 assert.equal(dispatched, 12);
 assert.equal(actual.termination, 'call-limit');
 assert.equal(actual.decisions[0].toolCalls[12].result.handled, false);
});

test('both fixed people variants respect budgets and target balanced employment without pods', () => {
 for (const variant of [1, 2] as const) for (let year = 1; year <= 30; ++year) {
  const calls = peopleFriendlyCalls(year, { powerReserve: 0 }, variant);
  assert.ok(calls.length <= 12);
  assert.equal(new Set(calls.map(call => call.id)).size, calls.length);
  assert.ok(calls.every(call => !call.name.startsWith('pods.') && call.name !== 'build.bio-plant'));
  if (year <= 10) for (const name of ['build.commercial', 'build.industrial', 'build.farms', 'build.residential'])
   assert.ok(calls.some(call => call.name === name));
  if (year === 1) {
   assert.deepEqual(calls.find(call => call.name === 'automation.set-limit')?.arguments, { limit: .3 });
   assert.deepEqual(calls.find(call => call.name === 'welfare.set-level')?.arguments, { level: 1 });
  }
 }
});
