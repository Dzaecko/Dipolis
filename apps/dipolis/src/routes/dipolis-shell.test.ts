import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('Dipolis shell', () => {
	it('offers the four working entry routes without legacy navigation', () => {
		const home = read('./+page.svelte');
		for (const label of ['Live-Lauf starten', 'Läufe wiedergeben', 'Ergebnisse', 'Freie Stadt']) {
			expect(home).toContain(label);
		}
		for (const route of ['replay', 'results', 'city', 'about']) {
			expect(existsSync(fileURLToPath(new URL(`./${route}/+page.svelte`, import.meta.url)))).toBe(true);
		}
		expect(home).toContain('Eine Stadt, in der Menschen und KI-Bewohner zusammenleben, geführt von einer KI-Verwaltung.');
		expect(home + read('./+layout.svelte')).not.toContain('navigationTree');
	});

	it('preserves exact attribution and documents the original commit', () => {
		const about = read('./about/+page.svelte');
		expect(about).toContain('Micropolis is a registered trademark of Micropolis Corporation (Micropolis GmbH) and is licensed here as a courtesy of the owner under the Micropolis Public Name License.');
		expect(about).toContain('f9ae6a57bbe5f5ff94c149bccb3015757f18241d');
		expect(about).toContain('GPL-3');
	});

	it('uses a new favicon and matching human/AI colors', () => {
		expect(read('./+layout.svelte')).toContain('/favicon.svg');
		expect(read('../../static/favicon.svg')).toContain('<svg');
		const css = read('./styles.css');
		expect(css).toContain('--human-color: #fbbf24');
		expect(css).toContain('--ai-color: #22d3ee');
		expect(read('./replay/+page.svelte')).toContain("label: '● Menschen', color: '#fbbf24'");
		expect(read('./replay/+page.svelte')).toContain("label: '◆ KI-Bewohner', color: '#22d3ee'");
	});
});
