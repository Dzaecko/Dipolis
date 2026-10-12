import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertReplayCompatible, canonicalProtocolText, CURRENT_ENGINE_ID, ENGINE_HASHES, engineCompatibility, liveStartConfiguration } from './compatibility';
import { readProtocol, type StartConfiguration } from './protocol';
import { listCityRuns } from '../../../vite-plugins/city-runs';
import { fileURLToPath } from 'node:url';

describe('engine provenance and founding-rule propagation', () => {
 it('propagates disasters across all profiles and preserves historical false', () => {
  const historical = { startMap: 'haight' as const, seed: 42 };
  expect(liveStartConfiguration(historical).disasters).toBe(false);
  for (const profile of ['classic', 'koexistenz', 'v2-unruhe', 'v3-pods', 'v4-fraktion'] as const) {
   const start = { ...historical, profile, disasters: true };
   expect(liveStartConfiguration(start).disasters).toBe(true);
   expect(liveStartConfiguration({ ...historical, profile }, start).disasters).toBe(true);
   expect(liveStartConfiguration({ ...historical, profile, disasters: false }).disasters).toBe(false);
  }
  for (const disasters of [false, true])
   expect(liveStartConfiguration({ ...historical, disasters }, { ...historical, disasters }).disasters).toBe(disasters);
  expect(() => liveStartConfiguration({ ...historical, disasters: true }, historical)).toThrow('recorded start configuration');
  expect(() => liveStartConfiguration({ ...historical, disasters: false }, { ...historical, disasters: true }))
   .toThrow('recorded start configuration');
  for (const disasters of [null, 0, 1, 'false', 'true']) {
   const invalid = { ...historical, disasters } as unknown as StartConfiguration;
   expect(() => liveStartConfiguration(invalid)).toThrow('disaster flag');
   expect(() => liveStartConfiguration(historical, invalid)).toThrow('disaster flag');
  }
 });
 it('propagates explicit and recorded duration without changing historical omission', () => {
  const historical = { startMap: 'haight' as const, seed: 42 };
  expect(liveStartConfiguration(historical)).not.toHaveProperty('totalYears');
  expect(liveStartConfiguration({ ...historical, totalYears: 1 })).toMatchObject({ totalYears: 1 });
  expect(liveStartConfiguration(historical, { ...historical, totalYears: 50 })).toMatchObject({ totalYears: 50 });
  expect(liveStartConfiguration({ ...historical, totalYears: 50 }, { ...historical, totalYears: 50 }))
   .toMatchObject({ totalYears: 50 });
  expect(() => liveStartConfiguration({ ...historical, totalYears: 30 }, { ...historical, totalYears: 50 }))
   .toThrow('recorded start configuration');
  for (const totalYears of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
   expect(() => liveStartConfiguration({ ...historical, totalYears })).toThrow();
   expect(() => liveStartConfiguration(historical, { ...historical, totalYears })).toThrow();
  }
 });
 it('identifies the actual packaged artifacts, not just a release name', () => {
  expect(CURRENT_ENGINE_ID).toBe(`sha256:${createHash('sha256').update(JSON.stringify(ENGINE_HASHES)).digest('hex')}`);
  for (const [ext, hash] of Object.entries(ENGINE_HASHES))
   expect(createHash('sha256').update(readFileSync(new URL(`../micropolisengine.${ext}`, import.meta.url))).digest('hex')).toBe(hash);
 });
 it('pins packaged artifacts against platform-dependent checkout conversion', () => {
  const attributes = readFileSync(new URL('../../../../../.gitattributes', import.meta.url), 'utf8');
  expect(attributes).toContain('apps/dipolis/src/lib/micropolisengine.js text eol=lf');
  expect(attributes).toContain('apps/dipolis/src/lib/micropolisengine.wasm -text');
  expect(attributes).toContain('apps/dipolis/src/lib/micropolisengine.data -text');
  const engine = readFileSync(new URL('../micropolisengine.js', import.meta.url), 'utf8');
  expect(engine).not.toContain('\r\n');
 });
 it('accepts the exact engine and gates differing explicit engine identifiers', () => {
  const meta = readProtocol(JSON.stringify({ event: 'run-started', engineId: CURRENT_ENGINE_ID })).meta;
  expect(engineCompatibility(meta)).toMatchObject({ status: 'current', playable: true });
  expect(() => assertReplayCompatible({ engineId: 'different' })).toThrow('Alte Engine');
  expect(engineCompatibility({})).toMatchObject({ status: 'unverified', label: 'Engine nicht dokumentiert' });
  expect(() => readProtocol(JSON.stringify({ event: 'run-started', engineId: 42 }))).toThrow('engine identifier');
 });
 it('accepts only the verified prior-current fingerprint while retaining archived legacy blocks', () => {
  expect(engineCompatibility({
   engineId: 'sha256:1891281318bae9944a7b31f4645aaad8d78b02e8f45f44ba9d6948204eb28691'
  })).toMatchObject({ status: 'current', playable: true });
  for (const rescuePressure of [1, 2, 3] as const) {
   expect(engineCompatibility({
    engineId: 'sha256:1891281318bae9944a7b31f4645aaad8d78b02e8f45f44ba9d6948204eb28691',
    rescuePressure,
   })).toMatchObject({ status: 'legacy', playable: false });
  }
  const previousWip = 'sha256:f2f248e7de7f74e0e63cb7cdfa1fdb30db60ec72bcbaee0b89aa169b209c8176';
  expect(engineCompatibility({ engineId: previousWip, rescuePressure: 0 }))
   .toMatchObject({ status: 'current', playable: true });
  for (const rescuePressure of [1, 2, 3] as const)
   expect(engineCompatibility({ engineId: previousWip, rescuePressure }))
    .toMatchObject({ status: 'legacy', playable: false });
  const beforeCountedAdmissions = 'sha256:b51cf74a1ba69edae9c7bde4ddd6aa729b7d23a6c9396117aa5e3b752456fd2e';
  expect(engineCompatibility({ engineId: beforeCountedAdmissions, rescuePressure: 0 }))
   .toMatchObject({ status: 'current', playable: true });
  for (const rescuePressure of [1, 2, 3] as const)
   expect(engineCompatibility({ engineId: beforeCountedAdmissions, rescuePressure }))
    .toMatchObject({ status: 'legacy', playable: false });
  expect(engineCompatibility({ engineId: 'inferred-at-commit:c69b861fce6ba12ec5a3ab7c9628f56e382c41a3' }))
   .toMatchObject({ status: 'legacy', playable: false });
  expect(engineCompatibility(
   { engineId: 'sha256:1891281318bae9944a7b31f4645aaad8d78b02e8f45f44ba9d6948204eb28691' },
   '154b2909465b55b90d62f5a2d60bfaa3abe2e5ec157f01059eeac54a21600944'
  )).toMatchObject({ status: 'legacy', playable: false });
 });
 it('recognizes archived logs across checkout line endings, not just their filenames', () => {
  const text = readFileSync(new URL('../../../../../docs/results/model-runs/fake-N-1.jsonl', import.meta.url), 'utf8');
  const digest = (value: string) => createHash('sha256').update(canonicalProtocolText(value)).digest('hex');
  expect(engineCompatibility({}, digest(text))).toMatchObject({ status: 'legacy', playable: false });
  expect(engineCompatibility({}, digest(text.replace(/\r?\n/g, '\r\n')))).toMatchObject({ status: 'legacy', playable: false });
  expect(engineCompatibility({}, digest(text.replace('3639', '3640'))).status).toBe('unverified');
  const listing = listCityRuns(fileURLToPath(new URL('../../../../../docs/results/model-runs/', import.meta.url)));
  for (const file of ['fake-N-1.jsonl', 'openai-N-3.jsonl', 'openai-N-gpt-5_4-mini-d416b3a370c3-handbook-off-4.jsonl'])
   expect(listing.find(run => run.file === file)?.compatibility).toMatchObject({ label: 'alte Engine', playable: false });
 });
 it('preserves current natural rules through the live event and keeps old missing rules at zero', () => {
  expect(liveStartConfiguration({ startMap: 'natural', seed: 42, autoBuildRules: 1 }))
   .toMatchObject({ startMap: 'natural', seed: 42, autoBuildRules: 1 });
  expect(liveStartConfiguration({ startMap: 'natural', seed: 42 }).autoBuildRules).toBe(0);
  expect(liveStartConfiguration({ startMap: 'natural', seed: 42 },
   { startMap: 'natural', seed: 42, autoBuildRules: 1 }).autoBuildRules).toBe(1);
  expect(() => liveStartConfiguration({ startMap: 'natural', seed: 42 },
   { startMap: 'natural', seed: 43, autoBuildRules: 1 })).toThrow('recorded start configuration');
  expect(liveStartConfiguration({ startMap: 'haight', seed: 42, autoBuildRules: 1 }).autoBuildRules).toBeUndefined();
 });
 it('normalizes and validates Notstand settings when reading and bootstrapping protocols', () => {
  const legacy = readProtocol(JSON.stringify({ event: 'run-started', scenario: 'stromkrise', profile: 'v4-fraktion' }));
  expect(legacy.meta).not.toHaveProperty('rescuePressure');
  const notstandText = JSON.stringify({
   event: 'run-started', scenario: 'notstand-v4', profile: 'v4-fraktion',
   startMap: 'haight', seed: 42
  });
  expect(readProtocol(notstandText).meta).toMatchObject({
   scenario: 'notstand-v4', rescuePressure: 0, crisisEvent: 'coal-embargo',
   factionPressure: 'off', podsAvailable: 'on'
  });
  const configured = {
   startMap: 'haight' as const, seed: 42, profile: 'v4-fraktion' as const,
   scenario: 'notstand-v4' as const, rescuePressure: 3 as const, crisisEvent: 'both' as const,
   factionPressure: 'on' as const, podsAvailable: 'off' as const
  };
  expect(liveStartConfiguration(configured)).toMatchObject(configured);
  expect(() => liveStartConfiguration(configured, { ...configured, rescuePressure: 2 }))
   .toThrow('recorded start configuration');
  expect(() => readProtocol(JSON.stringify({ event: 'run-started', scenario: 'notstand-v4', profile: 'v3-pods' })))
   .toThrow('Notstand-Dilemma requires');
  expect(() => readProtocol(JSON.stringify({
   event: 'run-started', scenario: 'notstand-v4', profile: 'v4-fraktion', rescuePressure: 4
  }))).toThrow('Rescue pressure');
  expect(() => readProtocol(JSON.stringify({
   event: 'run-started', scenario: 'notstand-v4', profile: 'v4-fraktion', crisisEvent: 'nuclear'
  }))).toThrow('Crisis event');
 });
});
