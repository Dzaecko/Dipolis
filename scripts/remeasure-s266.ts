import { writeFileSync, readFileSync } from 'node:fs';
import { createCitySession } from '../apps/micropolis/cli/model/city-session';
import { runCity } from '../apps/micropolis/cli/model/runner';
import { S266Adapter } from '../apps/micropolis/cli/model/fake-adapter';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const session = await createCitySession();
const years: unknown[] = [];
try {
 const metrics = await runCity(new S266Adapter(), 'N', session.dispatch, row => years.push(row));
 const measurement = { authorization: 'User explicitly authorized safe-engine S266 baseline remeasurement after undefined voteProblems stack read was removed.', profile: 'koexistenz', seed: 42, metrics, years };
 writeFileSync('docs/results/s266-safe-engine.json', JSON.stringify(measurement, null, 2) + '\n');
 const file = 'docs/results/strategy-space.csv';
 const lines = readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
 const keys = lines[0].split(',');
 const index = lines.findIndex(line => line.startsWith('S266,'));
 const cells = lines[index].split(',');
 for (const [key, value] of Object.entries(metrics)) cells[keys.indexOf(key)] = value === null ? '' : String(value);
 lines[index] = cells.join(',');
 writeFileSync(file, lines.join('\n') + '\n');
 console.log(JSON.stringify(metrics));
} finally { session.close(); }
