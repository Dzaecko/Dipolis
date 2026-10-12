import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCitySession } from '../apps/dipolis/cli/model/city-session';
import { readProtocol } from '../apps/dipolis/src/lib/city-run/protocol';
import { setupScenario, readReport, compareReports, advanceYear, replayArguments } from '../apps/dipolis/src/lib/city-run/replay';
import { mapToolArguments, validateToolCall } from '../apps/dipolis/src/lib/city-run/tools';
import { generateCityReport, generateReportIndex } from '../apps/dipolis/cli/model/city-report';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = path.join(root, 'apps', 'dipolis');
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const artifacts = ['js', 'wasm', 'data'];
const engineHashes = Object.fromEntries(artifacts.map(ext => [ext,
 sha(readFileSync(path.join(app, 'src', 'lib', `micropolisengine.${ext}`)))]));
const oldCommit = execFileSync('git', ['rev-parse', 'engine-vor-absturzfix^{}'], { cwd: root }).toString().trim();
const oldHashes = Object.fromEntries(artifacts.map(ext => [ext,
 sha(execFileSync('git', ['show', `${oldCommit}:apps/micropolis/src/lib/micropolisengine.${ext}`],
 { cwd: root, maxBuffer: 64 * 1024 * 1024 }))]));
const engineId = `sha256:${sha(JSON.stringify(engineHashes))}`;
const baseline = JSON.parse(readFileSync(path.join(app, 'cli', 'wasm', 'sim-run-baselines.json'), 'utf8'));
const classic = [];
for (const [city, expected] of Object.entries(baseline.cities) as [string, Record<string, unknown>][]) {
 const actual = JSON.parse(execFileSync(process.execPath, [path.join(app, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
 'cli/entry.ts', 'sim', 'run', '--city', city, '--seed', String(baseline.seed), '--ticks', String(baseline.ticks),
 '--speed', String(baseline.speed), '--params', path.join(app, 'src', 'lib', 'params', 'classic.json'),
 baseline.disasters ? '--disasters' : '--no-disasters'], { cwd: app, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }).toString());
 const differences = Object.keys(expected).filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
  .map(key => ({ key, expected: expected[key], actual: actual[key] }));
 classic.push({ city, equalFields: Object.keys(expected).filter(key => !differences.some(d => d.key === key)),
  differences, expected, actual });
 console.log(`Classic ${city}: ${differences.length} mismatched fields`);
}
const files = ['fake-N-1.jsonl', 'openai-N-3.jsonl', 'openai-N-gpt-5_4-mini-d416b3a370c3-handbook-off-4.jsonl'];
const runDirectory = path.join(root, 'docs', 'results', 'model-runs');
const latestNatural = readdirSync(runDirectory).filter(file => file.endsWith('.jsonl'))
 .sort((a, b) => statSync(path.join(runDirectory, b)).mtimeMs - statSync(path.join(runDirectory, a)).mtimeMs)
 .find(file => {
  const protocol = readProtocol(readFileSync(path.join(runDirectory, file), 'utf8'));
  return protocol.meta.startMap === 'natural' && protocol.meta.autoBuildRules === 1;
 });
if (latestNatural) files.push(latestNatural);
const replays = [];
for (const file of files) {
 const text = readFileSync(path.join(root, 'docs', 'results', 'model-runs', file), 'utf8');
 const protocol = readProtocol(text);
 const session = await createCitySession();
 const years = [];
 try {
  await setupScenario(session.dispatch, protocol.meta);
  for (const record of protocol.years) {
   const before = await readReport(session.dispatch);
   const calls = [];
   for (const decision of record.decisions) for (const { call, result } of decision.toolCalls) {
    if (result.handled === false) continue;
    const args = validateToolCall(call.name, replayArguments(call));
    if (!args.ok) throw new Error(`Invalid recorded tool ${call.name}`);
    const actual = await session.dispatch(call.name, mapToolArguments(call.name, args.args));
    calls.push({ call, expected: result, actual,
     equal: actual.handled !== false && JSON.stringify(actual.data) === JSON.stringify(result.data) });
   }
   await advanceYear(session.dispatch);
   const actual = await readReport(session.dispatch);
   const allReportDifferences = Object.keys(record.afterReport).filter(key => actual[key] !== record.afterReport[key])
    .map(key => ({ key, expected: record.afterReport[key], actual: actual[key] }));
   years.push({ year: record.year, beforeComparison: compareReports(before, record.report), calls,
    comparison: compareReports(actual, record.afterReport), allReportDifferences, expected: record.afterReport, actual });
  }
 } finally { session.close(); }
 const firstToolMismatch = years.flatMap(y => y.calls.filter(c => !c.equal).map(c => ({ year: y.year, ...c })))[0] ?? null;
 const firstReportMismatch = years.find(y => !y.comparison.synchronous) ?? null;
 const synchronousYears = years.filter(y => y.comparison.synchronous && y.calls.every(c => c.equal)).length;
 const historical = file !== latestNatural;
 const recordedAtCommit = historical ? execFileSync('git', ['log', '-1', '--format=%H', '--', `docs/results/model-runs/${file}`],
  { cwd: root }).toString().trim() : null;
 const recordedArtifactHashes = recordedAtCommit ? Object.fromEntries(artifacts.map(ext => [ext,
  sha(execFileSync('git', ['show', `${recordedAtCommit}:apps/micropolis/src/lib/micropolisengine.${ext}`],
  { cwd: root, maxBuffer: 64 * 1024 * 1024 }))])) : null;
 if (recordedAtCommit) {
  const originalText = execFileSync('git', ['show', `${recordedAtCommit}:docs/results/model-runs/${file}`],
   { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString('utf8');
  const records = (value: string) => value.trim().split(/\r?\n/).map(line => JSON.parse(line));
  if (JSON.stringify(records(text)) !== JSON.stringify(records(originalText))) throw new Error(`Historical protocol was edited: ${file}`);
 }
 let wrongLiveBootstrap: unknown = null;
 if (!historical) {
  const wrong = await createCitySession();
  try {
   await setupScenario(wrong.dispatch, { ...protocol.meta, autoBuildRules: 0 });
   const first = years.flatMap(y => y.calls)[0];
   if (first) {
    const args = validateToolCall(first.call.name, replayArguments(first.call));
    if (!args.ok) throw new Error('Invalid first live tool');
    wrongLiveBootstrap = { call: first.call, expected: first.expected, correctBootstrap: first.actual,
     missingRulesBootstrap: await wrong.dispatch(first.call.name, mapToolArguments(first.call.name, args.args)) };
   }
  } finally { wrong.close(); }
 }
 replays.push({ file, protocolSha256: sha(text), canonicalProtocolSha256: sha(text.replace(/\r\n/g, '\n').trimEnd()),
  recordedAtCommit, recordedArtifactHashes, historical, wrongLiveBootstrap,
  engineProvenance: historical ? 'Original protocol has no explicit engine ID. Artifact hashes at the commit storing the unchanged records are inferred provenance, not a supported playback promise.'
   : 'Unstamped natural run measured against the actual current engine and recorded founding rules.',
  yearsTested: years.length, synchronousYears,
  firstToolMismatch, firstReportMismatch: firstReportMismatch && { year: firstReportMismatch.year,
   differences: firstReportMismatch.comparison.differences }, years });
 console.log(`${file}: ${synchronousYears}/${years.length} synchronous; first tool ${firstToolMismatch?.call.name ?? 'none'}`);
}
const measurement = { measuredAt: new Date().toISOString(), engineId, engineHashes, oldCommit, oldHashes,
 interpretation: 'All 30 years executed against current engine; after divergence later values are diagnostic, not faithful historical playback.',
 classic, replays };
writeFileSync(path.join(root, 'docs', 'results', 'engine-compatibility.json'), JSON.stringify(measurement, null, 2) + '\n');
writeFileSync(path.join(app, 'src', 'lib', 'city-run', 'engine-provenance.json'), JSON.stringify({
 engineId, engineHashes,
 legacyProtocols: replays.filter(r => r.historical).map(r => ({ sha256: r.canonicalProtocolSha256, file: r.file,
  engineId: `inferred-at-commit:${r.recordedAtCommit}`, label: 'alte Engine', compatible: false })),
 verifiedProtocols: replays.filter(r => !r.historical && r.yearsTested === 30 && r.synchronousYears === 30)
  .map(r => ({ sha256: r.canonicalProtocolSha256, file: r.file, engineId }))
}, null, 2) + '\n');
for (const file of files) console.log(generateCityReport(path.join(runDirectory, file)).htmlPath);
console.log(generateReportIndex(runDirectory).htmlPath);
