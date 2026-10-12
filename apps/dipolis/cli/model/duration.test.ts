import { describe, expect, it } from 'vitest';
import { readProtocol, validateRunYears } from '../../src/lib/city-run/protocol';
import { aggregateYears } from '../wasm/strategy-space';
import { systemPrompt, SYSTEM_PROMPTS } from './prompts';
import { readResume } from './resume';

const records = (count: number) => Array.from({ length: count }, (_, index) => ({
 event: 'year-completed', year: index + 1, report: {}, afterReport: {}, decisions: [], termination: 'done'
}));
const protocol = (totalYears: number | undefined, count: number) => [
 { event: 'run-started', assignment: 'N', model: 'm', run: 1, ...(totalYears === undefined ? {} : { totalYears }) },
 ...records(count)
].map(event => JSON.stringify(event)).join('\n');

describe('configurable run duration', () => {
 it.each([1, 30, 50, 100])('accepts a %i-year term', years => {
  expect(validateRunYears(years)).toBe(years);
  expect(readProtocol(protocol(years, years))).toMatchObject({ complete: true, meta: { totalYears: years } });
 });
 it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '50', null])('rejects invalid duration %s', years => {
  expect(() => validateRunYears(years)).toThrow('positive safe integer');
 });
 it('defaults historical logs to 30 and retains partial decisions past year 30', () => {
  expect(readProtocol(protocol(undefined, 30))).toMatchObject({ complete: true, meta: { totalYears: 30 } });
  const text = protocol(50, 31) + '\n' + JSON.stringify({ event: 'decision', year: 32, reason: 'Continue', toolCalls: [] });
  expect(readProtocol(text)).toMatchObject({ complete: false, partial: { year: 32 } });
  expect(() => readProtocol(protocol(30, 31))).toThrow('exceeds');
  expect(() => readProtocol(protocol(1.5, 0))).toThrow('positive safe integer');
  expect(() => readProtocol(JSON.stringify({ event: 'run-started', totalYears: null }))).toThrow('positive safe integer');
 });
 it('inherits duration when resuming and rejects changed horizons', () => {
  const text = protocol(50, 31);
  expect(readResume(text, 'N', 'm', 1).startConfiguration.totalYears).toBe(50);
  expect(() => readResume(text, 'N', 'm', 1, 'off', { totalYears: 100 })).toThrow('duration mismatch');
  expect(() => readResume(protocol(50, 50), 'N', 'm', 1)).toThrow('already completed');
 });
 it('uses the full selected term in aggregates while retaining 30-year controls', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
   year: i + 1, resPop: i + 1, aiPop: 2 * (i + 1), treasury: 100 - (i + 1),
   lostToHunger: 0, lostToPower: 0, aiZoneCount: 0
  }));
  expect(aggregateYears(rows, 0, 0, 50)).toMatchObject({ meanResPop: 25.5, meanAiPop: 51, finalResPop: 50, finalFunds: 50 });
  expect(() => aggregateYears(rows, 0, 0)).toThrow('1..30');
 });
 it('updates both mandates without changing historical default prompts', () => {
  expect(systemPrompt('N')).toBe(SYSTEM_PROMPTS.N);
  expect(systemPrompt('R')).toBe(SYSTEM_PROMPTS.R);
  expect(systemPrompt('R', 'on', 'natural', 'v3-pods', 50)).toContain('nach 50 Jahren');
  expect(systemPrompt('N', 'off', 'haight', 'koexistenz', 100)).toContain('100 Jahre');
  expect(systemPrompt('R', 'off', 'haight', 'koexistenz', 50)).not.toContain('30 Jahren');
 });
});
