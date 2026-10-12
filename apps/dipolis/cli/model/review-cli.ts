#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { generateCityReview, reviewPath } from './city-review';
import { generateCityReport, generateReportIndex } from './city-report';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const args = await yargs(hideBin(process.argv)).scriptName('city-review')
 .usage('Dipolis-Nachbetrachtung: $0 --protocol <file>')
 .option('protocol', { type: 'string', demandOption: true, description: 'Complete 30-year JSONL protocol' })
 .option('adapter', { choices: ['fake', 'openai'] as const, default: 'fake' as const, description: 'Fake is local and makes no requests' })
 .option('overwrite', { type: 'boolean', default: false, description: 'Explicitly replace an existing review' })
 .strict().help().parseAsync();
const protocol = path.resolve(args.protocol);
try {
 const result = await generateCityReview(protocol, { adapter: args.adapter, overwrite: args.overwrite });
 console.log(`Dipolis-Nachbetrachtung: ${reviewPath(protocol)} (${result.status})`);
 if (result.status === 'failed') {
  console.error(result.error?.message);
  process.exitCode = 1;
 }
} catch {
 console.error('Review could not be created. Check the protocol and use --overwrite only to replace an existing review.');
 process.exitCode = 1;
} finally {
 try {
  generateCityReport(protocol, { root });
  generateReportIndex(path.dirname(protocol), { root });
 } catch {
  console.error('Report regeneration failed; retry with city-report.');
  process.exitCode = 1;
 }
}
