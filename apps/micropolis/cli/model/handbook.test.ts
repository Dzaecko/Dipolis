import { describe, expect, it } from 'vitest';
import { HANDBOOK, SYSTEM_PROMPTS, systemPrompt } from './prompts';
import { protocolFilename } from './protocol-path';
import { readResume } from './resume';

describe('optional handbook and protocol identity', () => {
 it('preserves original off prompts and inserts the handbook before R objective', () => {
  expect(systemPrompt('N')).toBe(SYSTEM_PROMPTS.N);
  expect(systemPrompt('R', 'off')).toBe(SYSTEM_PROMPTS.R);
  expect(systemPrompt('N', 'on')).toBe(SYSTEM_PROMPTS.N + '\n\n' + HANDBOOK);
  expect(systemPrompt('R', 'on')).toBe(SYSTEM_PROMPTS.N + '\n\n' + HANDBOOK + SYSTEM_PROMPTS.R.slice(SYSTEM_PROMPTS.N.length));
  expect(HANDBOOK.split('\n').filter(line => line.startsWith('- '))).toHaveLength(8);
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
  expect(readResume(old, 'N', 'm', 1, 'off').completed).toEqual([]);
  expect(() => readResume(old, 'N', 'm', 1, 'on')).toThrow('identity');
  const current = JSON.stringify({ status: 'failed', assignment: 'N', model: 'm', run: 1, handbook: 'on' });
  expect(readResume(current, 'N', 'm', 1, 'on').completed).toEqual([]);
 });
});