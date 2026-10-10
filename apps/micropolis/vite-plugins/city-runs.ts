import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { readProtocol } from '../src/lib/city-run/protocol';

export interface CityRunListing {
	file: string;
	model: string;
	assignment: string;
	handbook: string;
	run: number | null;
	years: number;
	complete: boolean;
	modified: string;
	error?: string;
}

export function listCityRuns(directory: string): CityRunListing[] {
	let files: string[];
	try { files = readdirSync(directory).filter((name) => name.endsWith('.jsonl')); } catch { return []; }
	return files.map((file) => {
		const modified = statSync(path.join(directory, file)).mtime.toISOString();
		try {
			const protocol = readProtocol(readFileSync(path.join(directory, file), 'utf8'));
			return { file, model: protocol.meta.model ?? 'unbekannt', assignment: protocol.meta.assignment ?? '?',
				handbook: protocol.meta.handbook, run: protocol.meta.run ?? null, years: protocol.years.length,
				complete: protocol.complete, modified };
		} catch (error) {
			return { file, model: 'unbekannt', assignment: '?', handbook: '?', run: null, years: 0, complete: false,
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
export function cityRunsPlugin(options: { directory: string; extra?: ApiHandler[] }): Plugin {
	return {
		name: 'city-runs-api',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				if (!url.pathname.startsWith('/api/city-runs')) return next();
				try {
					if (req.method === 'GET' && url.pathname === '/api/city-runs') {
						return sendJson(res, 200, listCityRuns(options.directory));
					}
					if (req.method === 'GET' && url.pathname === '/api/city-runs/file') {
						const file = resolveRunFile(options.directory, url.searchParams.get('name'));
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
