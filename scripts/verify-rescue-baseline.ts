import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createCitySession } from '../apps/dipolis/cli/model/city-session';
import { S266Adapter } from '../apps/dipolis/cli/model/fake-adapter';
import { runCity } from '../apps/dipolis/cli/model/runner';
import type { YearRecord } from '../apps/dipolis/src/lib/city-run/protocol';

async function measure(disasters: boolean) {
 const session = await createCitySession();
 const years: YearRecord[] = [];
 try {
  const metrics = await runCity(new S266Adapter(), 'N', session.dispatch, row => years.push(row), undefined, {
   startConfiguration: { startMap: 'haight', profile: 'v4-fraktion', scenario: 'stromkrise', seed: 42, totalYears: 30, disasters }
  });
  const m = session.micropolis;
  const hash = (address: number, size: number) => createHash('sha256')
   .update(new Uint8Array(session.engine.wasmMemory.buffer, address, size)).digest('hex');
  return { disasters, metrics,
   years: years.map(row => ({ year: row.year, report: row.report, afterReport: row.afterReport,
    commands: row.decisions.flatMap(decision => decision.toolCalls) })),
   mapHash: hash(m.getMapAddress(), m.getMapSize()),
   ownerHash: hash(m.getOwnerMapAddress(), m.getOwnerMapSize()) };
 } finally { session.close(); }
}

async function main() {
 const mode = process.argv[2], file = process.argv[3];
 if (!file || !['capture', 'verify'].includes(mode))
  throw new Error('Usage: tsx scripts/verify-rescue-baseline.ts capture|verify <baseline.json>');
 const observed = [await measure(false), await measure(true)];
 const text = JSON.stringify(observed);
 if (mode === 'capture') {
  writeFileSync(file, text + '\n', { flag: 'wx' });
  console.log('Captured pre-rescue v4 baseline with disasters off and on.');
 } else {
  const expected = JSON.parse(readFileSync(file, 'utf8'));
  if (JSON.stringify(expected) !== text) throw new Error('Pressure-zero v4 baseline mismatch');
  console.log('Pressure-zero v4 reports, commands, aggregates and map bytes match both pre-rescue baselines.');
 }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
