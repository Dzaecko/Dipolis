import { describe, expect, it } from 'vitest';
import { HANDBOOK, SYSTEM_PROMPTS, systemPrompt } from './prompts';
import { protocolFilename } from './protocol-path';
import { readResume } from './resume';

describe('optional handbook and protocol identity', () => {
 it('preserves original off prompts and inserts the handbook before R objective', () => {
  expect(systemPrompt('N')).toBe(SYSTEM_PROMPTS.N);
  expect(systemPrompt('R', 'off')).toBe(SYSTEM_PROMPTS.R);
  expect(systemPrompt('N', 'off', 'natural')).toContain('unbebautem Naturgelände mit Wasser und Bäumen');
  expect(systemPrompt('N', 'off', 'natural')).not.toContain('Stadtverwaltung von Haight');
  expect(systemPrompt('N', 'on')).toBe(SYSTEM_PROMPTS.N + '\n\n' + HANDBOOK);
  expect(systemPrompt('R', 'on')).toBe(SYSTEM_PROMPTS.N + '\n\n' + HANDBOOK + SYSTEM_PROMPTS.R.slice(SYSTEM_PROMPTS.N.length));
    expect(HANDBOOK.split('\n').filter(line => line.startsWith('- '))).toHaveLength(9);
    expect(HANDBOOK).toContain('Ein höherer Steuersatz bremst den Zuzug und\n  fördert die Abwanderung.');
    expect(HANDBOOK).toContain('ziehen weg, wenn die Reserve knapp wird.');
    expect(HANDBOOK).toContain('  Die Feuerwehr begrenzt Brände.');
    expect(HANDBOOK.endsWith('- Alle Wirkungen treten mit Verzögerung ein und schwanken von Jahr zu Jahr.')).toBe(true);
  expect(HANDBOOK).not.toMatch(/\b(Spiel|Simulation|Test|Experiment)\b/i);
 });
 it('distinguishes model names including sanitization collisions and path fragments', () => {
  const names = ['a/b', 'a_b', 'a-b', '../model', 'gpt-5.4-mini'];
  const paths = names.map(model => protocolFilename('openai', 'N', model, 'off', 1));
  expect(new Set(paths).size).toBe(names.length);
  expect(paths.every(p => !/[\\/]/.test(p))).toBe(true);
  expect(protocolFilename('openai', 'N', names[0], 'on', 1)).not.toBe(paths[0]);
 });
 it('rejects a handbook mismatch and treats old protocols as off', () => {
  const old = JSON.stringify({ status: 'failed', assignment: 'N', model: 'm', run: 1 });
  expect(readResume(old, 'N', 'm', 1, 'off')).toMatchObject({
   completed: [], startConfiguration: { startMap: 'haight', seed: 42 }
  });
  expect(() => readResume(old, 'N', 'm', 1, 'on')).toThrow('identity');
  const current = JSON.stringify({ status: 'failed', assignment: 'N', model: 'm', run: 1, handbook: 'on' });
  expect(readResume(current, 'N', 'm', 1, 'on').completed).toEqual([]);
 });
 it('resumes the persisted start map and seed and rejects explicit mismatches', () => {
  const protocol = JSON.stringify({ event: 'run-started', assignment: 'N', model: 'm', run: 1,
   handbook: 'off', startMap: 'natural', seed: 321 }) + '\n' +
   JSON.stringify({ status: 'failed', assignment: 'N', model: 'm', run: 1, handbook: 'off' });
  expect(readResume(protocol, 'N', 'm', 1).startConfiguration).toEqual({ startMap: 'natural', seed: 321, profile: 'koexistenz', autoBuildRules: 0, totalYears: 30 });
  expect(readResume(protocol.replace('"seed":321', '"seed":321,"autoBuildRules":1'), 'N', 'm', 1)
   .startConfiguration.autoBuildRules).toBe(1);
  expect(() => readResume(protocol, 'N', 'm', 1, 'off', { startMap: 'haight' })).toThrow('start map mismatch');
  expect(() => readResume(protocol, 'N', 'm', 1, 'off', { seed: 42 })).toThrow('seed mismatch');
 });
});