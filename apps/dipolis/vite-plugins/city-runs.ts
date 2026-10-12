import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { PROTOCOL_YEARS, readProtocol } from '../src/lib/city-run/protocol';
import { createHash } from 'node:crypto';
import { canonicalProtocolText, engineCompatibility, type EngineCompatibility } from '../src/lib/city-run/compatibility';

export interface CityRunListing {
	file: string;
	model: string;
	assignment: string;
	handbook: string;
	run: number | null;
	years: number;
	totalYears: number;
	complete: boolean;
	modified: string;
	error?: string;
	compatibility?: EngineCompatibility;
}

export function listCityRuns(directory: string): CityRunListing[] {
	let files: string[];
	try { files = readdirSync(directory).filter((name) => name.endsWith('.jsonl')); } catch { return []; }
	return files.map((file) => {
		const modified = statSync(path.join(directory, file)).mtime.toISOString();
		try {
			const text = readFileSync(path.join(directory, file), 'utf8');
			const protocol = readProtocol(text);
			const compatibility = engineCompatibility(protocol.meta, createHash('sha256').update(canonicalProtocolText(text)).digest('hex'));
			return { file, model: protocol.meta.model ?? 'unbekannt', assignment: protocol.meta.assignment ?? '?',
				handbook: protocol.meta.handbook, run: protocol.meta.run ?? null, years: protocol.years.length, totalYears: protocol.meta.totalYears,
				complete: protocol.complete, modified, compatibility };
		} catch (error) {
			return { file, model: 'unbekannt', assignment: '?', handbook: '?', run: null, years: 0, totalYears: PROTOCOL_YEARS, complete: false,
				modified, error: error instanceof Error ? error.message : 'unlesbar' };
		}
	}).sort((a, b) => b.modified.localeCompare(a.modified));
}

export function sendJson(res: ServerResponse, status: number, value: unknown) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Cache-Control', 'no-store');
	res.end(JSON.stringify(value));
}

/** Only names that currently exist in the listing are served; no path components. */
export function resolveRunFile(directory: string, name: string | null): string | null {
	if (!name || name !== path.basename(name) || !name.endsWith('.jsonl')) return null;
	try { return readdirSync(directory).includes(name) ? path.join(directory, name) : null; } catch { return null; }
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>;

/** Dev-server only: excluded from `vite build`, so no API ships with the static site. */
export function cityRunsPlugin(options: { directory: string; archives?: Record<string, string>; extra?: ApiHandler[]; onClose?: () => void }): Plugin {
	return {
		name: 'city-runs-api',
		apply: 'serve',
		configureServer(server) {
			server.httpServer?.once('close', () => options.onClose?.());
			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				if (!url.pathname.startsWith('/api/city-runs')) return next();
				try {
					if (req.method === 'GET' && url.pathname === '/api/city-runs') {
						const archives = Object.entries(options.archives ?? {}).flatMap(([prefix, directory]) =>
							listCityRuns(directory).map(run => ({ ...run, file: `${prefix}:${run.file}` })));
						return sendJson(res, 200, [...listCityRuns(options.directory), ...archives]);
					}
					if (req.method === 'GET' && url.pathname === '/api/city-runs/file') {
						const name = url.searchParams.get('name');
						const prefix = name?.split(':')[0];
						const archive = prefix && options.archives?.[prefix];
						const file = archive && name ? resolveRunFile(archive, name.slice(prefix!.length + 1))
							: resolveRunFile(options.directory, name);
						if (!file) return sendJson(res, 404, { error: 'Protokoll nicht gefunden' });
						res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
						res.setHeader('Cache-Control', 'no-store');
						return res.end(readFileSync(file, 'utf8'));
					}
					for (const handler of options.extra ?? []) if (await handler(req, res, url)) return;
					return sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
				} catch (error) {
					return sendJson(res, 500, { error: error instanceof Error ? error.message : 'Serverfehler' });
				}
			});
		}
	};
}
