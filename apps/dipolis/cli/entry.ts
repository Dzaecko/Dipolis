#!/usr/bin/env tsx

/**
 * Dipolis CLI entrypoint.
 *
 * API: registers `about`, `api`, `city`, `visualize`, `sim`, and `bus` commands.
 * Use `--help` on any command for parameters, types, defaults, and examples.
 */

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { extendBusCommands } from './bus/index.js';
import { extendCityCommands } from './city/register.js';
import { extendVisualizeCommands } from './city/visualize.js';
import { extendMetaCommands } from './meta/index.js';
import { extendSimCommands } from './wasm/sim.js';

let cli = yargs(hideBin(process.argv))
	.scriptName('dipolis')
	.usage('$0 <command> [subcommand] [options]')
	.example('$0 about --format yaml', 'Show CLI purpose and module map')
	.example('$0 api --format yaml', 'Show command and module API paths')
	.example('$0 city info CITY.cty --format yaml', 'Inspect a city save')
	.example('$0 city export CITY.cty --include-map --format csv', 'Export a tile grid')
	.example('$0 sim smoke --ticks 10 --format yaml', 'Run the WASM engine headlessly')
	.example('$0 sim run --seed 42 --ticks 30000 --speed 3 --no-disasters', 'Run a reproducible headless simulation')
	.example('$0 sim series --scenario notstand-v4 --levels 0,1,2,3 --adapter fake', 'Run a sequential, offline Notstand-Dilemma model series')
	.option('verbose', {
		alias: 'v',
		type: 'boolean',
		describe: 'Print additional diagnostic information'
	});

cli = extendMetaCommands(cli);
cli = extendCityCommands(cli);
cli = extendVisualizeCommands(cli);
cli = extendSimCommands(cli);
cli = extendBusCommands(cli);

await cli
	.demandCommand(1, 'Specify a command. Try `dipolis about --format yaml` or `dipolis --help`.')
	.help()
	.alias('help', 'h')
	.version()
	.strict()
	.parseAsync();
