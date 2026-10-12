import { describe, expect, it } from 'vitest';
import {
	GAME_TOOLS,
	GAME_TOOL_GROUPS,
	gameToolGroupsForProfile,
	isGameToolAvailable,
	resolveEditingTool,
	toolFootprintAtCenter,
} from './gameTools';
import { buildHelpSections } from './helpShortcuts';

describe('toolFootprintAtCenter', () => {
	it('1×1 tools sit on the hovered tile', () => {
		expect(toolFootprintAtCenter(10, 20, 'road')).toEqual({ x: 10, y: 20, w: 1, h: 1 });
	});

	it('3×3 zones anchor top-left at center − (1, 1)', () => {
		expect(toolFootprintAtCenter(10, 20, 'res')).toEqual({ x: 9, y: 19, w: 3, h: 3 });
		expect(toolFootprintAtCenter(10, 20, 'res-ai')).toEqual({ x: 9, y: 19, w: 3, h: 3 });
		expect(toolFootprintAtCenter(10, 20, 'farm')).toEqual({ x: 9, y: 19, w: 3, h: 3 });
	});

	it('Farm remains available as a human zone tool', () => {
		expect(GAME_TOOLS.find((tool) => tool.id === 'farm')).toMatchObject({
			label: 'Landwirtschaft',
			shortcut: 'G',
			cost: 100,
		});
		expect(resolveEditingTool({ EditingTool: { TOOL_INDUSTRIAL: 3 } } as never, 'farm')).toBe(3);
	});

	it('KI-Wohnkomplex is available beside residential zones', () => {
		expect(GAME_TOOLS.find((tool) => tool.id === 'res-ai')).toMatchObject({
			label: 'KI-Wohnkomplex',
			shortcut: 'M',
			cost: 100,
		});
		expect(resolveEditingTool({ EditingTool: { TOOL_RESIDENTIAL: 0 } } as never, 'res-ai')).toBe(0);
	});

	it('4×4 buildings anchor top-left at center − (1, 1)', () => {
		expect(toolFootprintAtCenter(10, 20, 'seaport')).toEqual({ x: 9, y: 19, w: 4, h: 4 });
		expect(toolFootprintAtCenter(10, 20, 'solar')).toEqual({ x: 9, y: 19, w: 4, h: 4 });
	});

	it('Solar field is available as an $8,000 power tool on V', () => {
		expect(GAME_TOOLS.find((tool) => tool.id === 'solar')).toMatchObject({
			label: 'Solarfeld',
			shortcut: 'V',
			cost: 8000,
		});
		expect(resolveEditingTool({ EditingTool: { TOOL_SOLARPOWER: 20 } } as never, 'solar')).toBe(20);
	});

	it('6×6 airport anchors top-left at center − (1, 1)', () => {
		expect(toolFootprintAtCenter(10, 20, 'airport')).toEqual({ x: 9, y: 19, w: 6, h: 6 });
	});

	it('groups human, AI, and infrastructure tools separately and gates facilities to v3+', () => {
		expect(GAME_TOOL_GROUPS.map(({ label }) => label)).toEqual([
			'Menschen',
			'KI',
			'Infrastruktur',
			'Anlagen',
		]);
		expect(GAME_TOOL_GROUPS[0].tools.map(({ id }) => id)).toEqual(['res', 'com', 'ind', 'farm']);
		expect(GAME_TOOL_GROUPS[1].tools.map(({ id }) => id)).toEqual(['res-ai']);
		expect(GAME_TOOL_GROUPS[2].tools.map(({ id }) => id)).toEqual([
			'road',
			'wire',
			'coal',
			'solar',
			'nuclear',
			'police',
			'fire',
		]);
		expect(gameToolGroupsForProfile(false).map(({ label }) => label)).not.toContain('Anlagen');
		expect(gameToolGroupsForProfile(true).map(({ label }) => label)).toContain('Anlagen');
		expect(isGameToolAvailable('airport', false)).toBe(false);
		expect(isGameToolAvailable('airport', true)).toBe(false);
		expect(isGameToolAvailable('police', false)).toBe(true);
		expect(isGameToolAvailable('fire', false)).toBe(true);
		expect(GAME_TOOL_GROUPS[3].tools).toEqual([]);
		expect(isGameToolAvailable('road', false)).toBe(true);
	});

	it('keeps shortcuts aligned with profile-visible tools and omits the tileset switch', () => {
		const classicShortcuts = buildHelpSections(false).flatMap(({ rows }) => rows.map(({ keys }) => keys));
		const v3Shortcuts = buildHelpSections(true).flatMap(({ rows }) => rows.map(({ keys }) => keys));

		expect(classicShortcuts).not.toContain('H');
		expect(classicShortcuts).not.toContain('=');
		expect(classicShortcuts).not.toContain('-');
		expect(v3Shortcuts).not.toContain('H');
		expect(v3Shortcuts).toContain('Q');
		expect(v3Shortcuts).toContain('B');
	});
});
