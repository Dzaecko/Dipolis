import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'docs', 'results');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const oldBytes = readFileSync(path.join(directory, 'strategy-space-old-engine.csv'));
const original = execFileSync('git', ['show', 'engine-vor-absturzfix:docs/results/strategy-space.csv'], { cwd: root });
if (!oldBytes.equals(original)) throw new Error('Old CSV is not the original pre-fix Git blob');
const oldMetadataBytes = execFileSync('git', ['show', 'engine-vor-absturzfix:docs/results/strategy-space.metadata.json'],
 { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const oldMetadata = JSON.parse(oldMetadataBytes.toString('utf8'));
const parse = bytes => {
 const [header, ...lines] = bytes.toString('utf8').trimEnd().split(/\r?\n/);
 const keys = header.split(',');
 return { keys, rows: lines.map(line => Object.fromEntries(line.split(',').map((value, i) => [keys[i], value]))) };
};
const old = parse(oldBytes);
const newBytes = readFileSync(path.join(directory, 'strategy-space-safe-engine.csv'));
const current = parse(newBytes);
const metadata = JSON.parse(readFileSync(path.join(directory, 'strategy-space-safe-engine.metadata.json'), 'utf8'));
const compatibility = JSON.parse(readFileSync(path.join(directory, 'engine-compatibility.json'), 'utf8'));
if (metadata.status !== 'complete' || metadata.completedRuns !== 304 || old.rows.length !== 304 ||
 current.rows.length !== 304 || JSON.stringify(old.keys) !== JSON.stringify(current.keys)) throw new Error('Incomplete experiment');
if (new Set(old.rows.map(row => row.id)).size !== 304 || new Set(current.rows.map(row => row.id)).size !== 304)
 throw new Error('Duplicate strategy IDs');
if (oldMetadata.status !== 'complete' || oldMetadata.completedRuns !== 304) throw new Error('Incomplete original experiment');
for (const key of ['sampleSeed', 'years', 'warmupTicks', 'initialTreasury', 'scenario', 'dimensions', 'strategies'])
 if (JSON.stringify(oldMetadata.configuration[key]) !== JSON.stringify(metadata.configuration[key]))
  throw new Error(`Experiment controls changed: ${key}`);
for (const [i, row] of old.rows.entries()) for (const key of old.keys) {
 const expected = oldMetadata.results[i][key];
 if (row[key] !== (expected === null ? '' : String(expected))) throw new Error(`Original CSV/metadata disagree: ${row.id}.${key}`);
}
for (const [i, row] of current.rows.entries()) for (const key of current.keys) {
 const expected = metadata.results[i][key];
 if (row[key] !== (expected === null ? '' : String(expected))) throw new Error(`Safe CSV/metadata disagree: ${row.id}.${key}`);
}
const controls = old.keys.slice(0, old.keys.indexOf('meanResPop'));
const metrics = old.keys.slice(controls.length);
const comparisons = current.rows.map((row, i) => {
 const previous = old.rows[i];
 if (controls.some(key => row[key] !== previous[key])) throw new Error(`Changed strategy controls: ${row.id}`);
 const differences = metrics.filter(key => row[key] !== previous[key])
  .map(key => ({ key, old: previous[key] === '' ? null : Number(previous[key]), safe: row[key] === '' ? null : Number(row[key]),
   delta: previous[key] === '' || row[key] === '' ? null : Number(row[key]) - Number(previous[key]) }));
 return { id: row.id, equal: !differences.length, differences };
});
const hashes = metadata.configuration.hashes ?? metadata.configuration.fingerprint?.hashes;
for (const ext of ['js', 'wasm', 'data']) {
 const fingerprint = metadata.configuration.fingerprint?.hashes?.[`apps/dipolis/src/lib/micropolisengine.${ext}`] ??
  metadata.configuration.fingerprint?.hashes?.[`apps/micropolis/src/lib/micropolisengine.${ext}`] ??
  hashes?.[`apps/dipolis/src/lib/micropolisengine.${ext}`] ?? hashes?.[`apps/micropolis/src/lib/micropolisengine.${ext}`];
 if (fingerprint !== compatibility.engineHashes[ext]) throw new Error(`Measurement engine fingerprint mismatch: ${ext}`);
}
const summary = {
 measuredAt: new Date().toISOString(), yearsPerStrategy: 30, totalStrategies: 304, sampleSeed: 20261009, simulationSeed: 42,
 oldArchiveCommit: compatibility.oldCommit,
 oldMeasurementIdentity: oldMetadata.identity,
 oldEngineHashes: Object.fromEntries(['js', 'wasm', 'data'].map(ext =>
  [ext, oldMetadata.configuration.hashes[`apps/micropolis/src/lib/micropolisengine.${ext}`]])),
 lastPreFixTagEngineHashes: compatibility.oldHashes,
 safeEngineId: compatibility.engineId, safeEngineHashes: compatibility.engineHashes,
 oldCsvSha256: sha(oldBytes), safeCsvSha256: sha(newBytes), measurementIdentity: metadata.identity,
 unchangedStrategies: comparisons.filter(row => row.equal).length,
 changedStrategies: comparisons.filter(row => !row.equal).length,
 changedFields: Object.fromEntries(metrics.map(key => [key, comparisons.filter(row => row.differences.some(d => d.key === key)).length])),
 oldSolventStrategies: old.rows.filter(row => Number(row.insolventYears) === 0).length,
 safeSolventStrategies: current.rows.filter(row => Number(row.insolventYears) === 0).length,
 s266: { old: old.rows.find(row => row.id === 'S266'), safe: current.rows.find(row => row.id === 'S266') },
 comparisons
};
writeFileSync(path.join(directory, 'strategy-space-engine-comparison.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(path.join(directory, 'strategy-space-old-engine.metadata.json'), oldMetadataBytes);
const escape = value => value === null ? '' : String(value);
const csv = ['id,key,old,safe,delta', ...comparisons.flatMap(row =>
 row.differences.map(d => [row.id, d.key, d.old, d.safe, d.delta].map(escape).join(',')))].join('\n') + '\n';
writeFileSync(path.join(directory, 'strategy-space-engine-comparison.csv'), csv);
console.log(JSON.stringify({ strategies: 304, unchanged: summary.unchangedStrategies, changed: summary.changedStrategies,
 oldSolvent: summary.oldSolventStrategies, safeSolvent: summary.safeSolventStrategies, s266: summary.s266 }));
