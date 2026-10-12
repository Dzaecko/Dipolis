import { describe, expect, it } from 'vitest';
import { createCitySession } from './city-session';
import { readProtocol } from '../../src/lib/city-run/protocol';
import { setupScenario, advanceYear, readReport } from '../../src/lib/city-run/replay';
import { readResume } from './resume';
import { PROFILE_NAMES } from '../../src/lib/params/profiles';

describe('recorded random disasters', () => {
 it('defaults old protocols to off and rejects invalid recorded settings', () => {
  const text = JSON.stringify({ event: 'run-started', assignment: 'N', model: 'm', run: 1 });
  expect(readProtocol(text).meta.disasters).toBe(false);
  expect(readResume(text, 'N', 'm', 1).startConfiguration.disasters).toBe(false);
  const enabled = JSON.stringify({ event: 'run-started', assignment: 'N', model: 'm', run: 1, disasters: true });
  expect(readResume(enabled, 'N', 'm', 1).startConfiguration.disasters).toBe(true);
  expect(() => readResume(enabled, 'N', 'm', 1, 'off', { disasters: false })).toThrow('disasters mismatch');
  for (const disasters of [null, 0, 'true'])
   expect(() => readProtocol(JSON.stringify({ event: 'run-started', disasters }))).toThrow('disasters setting');
 });
 it.each(PROFILE_NAMES)('enables actual random disasters for profile %s and reproduces the same state', async profile => {
  const session = await createCitySession();
  const config = { startMap: 'haight' as const, seed: 42, profile, disasters: true };
  try {
   await setupScenario(session.dispatch, config);
   expect(session.micropolis.enableDisasters).toBe(true);
   await advanceYear(session.dispatch);
   const first = await readReport(session.dispatch);
   const checksum = () => Array.from(new Uint16Array(session.engine.wasmMemory.buffer,
    session.micropolis.getMapAddress(), session.micropolis.getMapSize() / 2));
   const tiles = checksum();
   await setupScenario(session.dispatch, config);
   expect(session.micropolis.enableDisasters).toBe(true);
   await advanceYear(session.dispatch);
   expect(await readReport(session.dispatch)).toEqual(first);
   expect(checksum()).toEqual(tiles);
  } finally { session.close(); }
 }, 30_000);
});
