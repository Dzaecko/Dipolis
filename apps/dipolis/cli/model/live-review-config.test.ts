import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseStartRequest, readModelConfig } from '../../vite-plugins/live-runs';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function config(extra: string) {
 const directory = mkdtempSync(path.join(tmpdir(), 'live-review-')); directories.push(directory);
 const file = path.join(directory, '.env.city-model');
 writeFileSync(file, 'CITY_MODEL_ENDPOINT=https://unused.invalid/openai/v1/responses\nCITY_MODEL_AUTH=azure-cli\n' + extra);
 return file;
}
describe('review settings coexist with browser live configuration', () => {
 it('accepts independent judge settings without returning them in start parameters', () => {
  const settings = readModelConfig(config('CITY_MODEL_MODEL=self\nCITY_MODEL_PROFILE=v4-fraktion\nCITY_JUDGE_MODEL=judge\nCITY_JUDGE_ENDPOINT=https://unused.invalid/other\nCITY_JUDGE_AUTH=azure-cli\n'));
  expect(settings.CITY_MODEL_NAME).toBe('self');
  expect(settings.CITY_JUDGE_MODEL).toBe('judge');
  const request = parseStartRequest({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1,
   startMap: 'haight', profile: 'v4-fraktion', scenario: 'stromkrise' });
  expect(request.profile).toBe('v4-fraktion');
  expect(JSON.stringify(request)).not.toContain('CITY_JUDGE');
 });
 it('rejects conflicting self aliases and invalid v4 Stromkrise terrain', () => {
  expect(() => readModelConfig(config('CITY_MODEL_MODEL=self\nCITY_MODEL_NAME=other\n'))).toThrow('übereinstimmen');
  expect(() => parseStartRequest({ adapter: 'fake', assignment: 'N', handbook: 'off', run: 1,
   startMap: 'natural', profile: 'v4-fraktion', scenario: 'stromkrise' })).toThrow('Haight');
 });
});
