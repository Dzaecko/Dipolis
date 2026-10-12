import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = name => JSON.parse(readFileSync(`docs/results/${name}.json`, 'utf8'));
const production = read('v3-production-disaster-acceptance');
const prefix = read('v3-final-production-prefix');
if (production.completedRuns !== 200 || prefix.completedRuns !== 80 ||
 production.passedRuns !== 200 || prefix.passedRuns !== 80)
 throw new Error('Finite production acceptance is incomplete');
const wasmSha256 = createHash('sha256').update(readFileSync('apps/dipolis/src/lib/micropolisengine.wasm')).digest('hex');
if (prefix.wasmSha256 !== wasmSha256 || production.wasmSha256 !== wasmSha256)
 throw new Error('Final engine hash mismatch');
const results = [...prefix.results, ...production.results.filter(r => r.seed >= 80)];
if (results.length !== 200 || results.some((r, i) => r.seed !== i || r.status !== 'passed' || r.completedTicks !== 40000))
 throw new Error('Final exact-engine seed coverage is invalid');
const checked = read('v3-checked-pods-stress');
const lifetime = read('v3-checked-lifetime-stress');
if (checked.passedRuns !== 6 || lifetime.passedRuns !== 2) throw new Error('Checked stress incomplete');
writeFileSync('docs/results/v3-final-production-acceptance.json', JSON.stringify({
 node: production.node, platform: production.platform,
 engine: 'apps/dipolis/src/lib/micropolisengine.js', wasmSha256,
 profile: 'classic', disasters: true, ticksPerRun: 40000, completedRuns: 200,
 passedRuns: 200, completedTicks: 8000000,
 sourceRanges: [
  { source: 'v3-final-production-prefix.json', seeds: '0..79' },
  { source: 'v3-production-disaster-acceptance.json', seeds: '80..199' }
 ],
 note: 'Initial long harness overlapped a final production rebuild before seed80. Seeds0..79 were independently rerun on the final engine;80..199 began after that rebuild. Both source result manifests match the final WASM hash. No classic rules changed during rebuild.',
 checkedStress: { source: 'v3-checked-pods-stress.json', passedRuns: 6, completedTicks: 24000 },
 checkedLifetimeStress: { source: 'v3-checked-lifetime-stress.json', passedRuns: 2, completedTicks: 24000 },
 results
}, null, 2) + '\n');
writeFileSync('docs/results/v3-final-production-acceptance.csv',
 'seed,status,completedTicks,elapsedMs,cityTime,cityPop,totalFunds,mapSha1\n' +
 results.map(r => ['seed', 'status', 'completedTicks', 'elapsedMs', 'cityTime', 'cityPop', 'totalFunds', 'mapSha1']
  .map(k => r[k]).join(',')).join('\n') + '\n');
console.log(JSON.stringify({ productionSeeds: 200, productionTicks: 8000000, checkedRuns: 8, checkedTicks: 48000, wasmSha256 }));
