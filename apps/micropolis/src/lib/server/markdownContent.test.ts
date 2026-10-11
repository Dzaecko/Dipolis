import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getContentFilePath, readContentFile } from './markdownContent.js';
import { GET } from '../../routes/images/diagrams/README.md/+server';

describe('diagram publication', () => {
	it('resolves nested source links and references without rewriting code or external URLs', async () => {
		const source = getContentFilePath('about/example');
		const mock = vi.spyOn(fs, 'readFile').mockResolvedValue(`
[PDF][diagram]

[diagram]: ../../../../../../images/diagrams/SimCityReverseDiagrams.pdf?download=1#page=2

![Diagram](../../../../../../images/diagrams/SimCityReverseDiagrams-Page-1-Simulate.png)

[External](https://example.com/images/diagram.pdf)
[Anchor](#diagram)
[Other](../other/README.md)

\`[Code](../../../../../../images/diagrams/README.md)\`
`);
		try {
			const html = await readContentFile(source, 'about/example');
			expect(html).toContain('href="/pdf/SimCityReverseDiagrams.pdf?download=1#page=2"');
			expect(html).toContain('src="/images/diagrams/SimCityReverseDiagrams-Page-1-Simulate.png"');
			expect(html).toContain('href="https://example.com/images/diagram.pdf"');
			expect(html).toContain('href="#diagram"');
			expect(html).toContain('href="../other/README.md"');
			expect(html).toContain('<code>[Code](../../../../../../images/diagrams/README.md)</code>');
		} finally {
			mock.mockRestore();
		}
	});

	it('renders all diagram links to existing public assets', async () => {
		const html = await readContentFile(getContentFilePath('reverse-diagrams'), 'reverse-diagrams');
		expect(html).toContain('href="/pdf/SimCityReverseDiagrams.pdf"');
		expect(html).toContain('href="/images/diagrams/README.md"');
		expect(html).not.toContain('href="/images/diagrams/SimCityReverseDiagrams.pdf"');
		expect(html).not.toContain('../../../../../images/');
		const images = [...html.matchAll(/src="(\/images\/diagrams\/[^"]+)"/g)];
		expect(images).toHaveLength(12);
		for (const [, url] of images) {
			expect((await readFile(path.join('static', url))).length).toBeGreaterThan(1000);
		}
		const pdf = await readFile('static/pdf/SimCityReverseDiagrams.pdf');
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
	});

	it('publishes the original licensed diagram index, not a placeholder', async () => {
		const response = await GET();
		expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
		expect(await response.text()).toBe(await readFile('../../images/diagrams/README.md', 'utf8'));
	});
});
