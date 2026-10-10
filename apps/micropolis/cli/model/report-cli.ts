#!/usr/bin/env tsx
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { generateCityReport, generateReportIndex } from './city-report';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const args = await yargs(hideBin(process.argv)).scriptName('city-report')
	.usage('$0 [protocol.jsonl ...] | --all')
	.option('all', { type: 'boolean', default: false, description: 'Generate reports for all protocols in the directory' })
	.option('directory', { type: 'string', default: path.join(root, 'docs/results/model-runs'), description: 'Results directory' })
	.strict().help().parseAsync();
const directory = path.resolve(args.directory);
const files = args.all
	? readdirSync(directory).filter((file) => file.endsWith('.jsonl')).map((file) => path.join(directory, file))
	: args._.map((file) => path.resolve(String(file)));
if (!files.length) {
	console.error('Keine Protokolldatei angegeben. --all oder einen Pfad verwenden.');
	process.exit(1);
}
const relative = (file: string) => path.relative(root, file).replaceAll('\\', '/');
let failed = 0;
for (const file of files) {
	try {
		const { htmlPath, complete, years } = generateCityReport(file, { root });
		console.log(`${relative(htmlPath)} (${years.length} Jahre${complete ? '' : ', unvollständig'})`);
	} catch (error) {
		failed++;
		console.error(`${path.basename(file)}: ${error instanceof Error ? error.message : 'Fehler'}`);
	}
}
const index = generateReportIndex(args.all ? directory : path.dirname(files[0]!), { root });
console.log(`Übersicht: ${relative(index.htmlPath)}`);
if (failed) process.exitCode = 1;
