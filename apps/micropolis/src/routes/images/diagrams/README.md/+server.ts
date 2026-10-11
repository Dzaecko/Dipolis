import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const prerender = true;

export async function GET() {
	const source = path.resolve(process.cwd(), '../../images/diagrams/README.md');
	return new Response(await readFile(source, 'utf8'), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' }
	});
}
