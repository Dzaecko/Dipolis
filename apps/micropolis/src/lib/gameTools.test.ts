import { describe, expect, it } from 'vitest';
import { GAME_TOOLS, resolveEditingTool, toolFootprintAtCenter } from './gameTools';

describe('toolFootprintAtCenter', () => {
	it('1×1 tools sit on the hovered tile', () => {
		expect(toolFootprintAtCenter(10, 20, 'road')).toEqual({ x: 10, y: 20, w: 1, h: 1 });
	});

	it('3×3 zones anchor top-left at center − (1, 1)', () => {
		expect(toolFootprintAtCenter(10, 20, 'res')).toEqual({ x: 9, y: 19, w: 3, h: 3 });
		expect(toolFootprintAtCenter(10, 20, 'res-ai')).toEqual({ x: 9, y: 19, w: 3, h: 3 });
		expect(toolFootprintAtCenter(10, 20, 'farm')).toEqual({ x: 9, y: 19, w: 3, h: 3 });
	});

	it('Farm is available as a marked industrial zone tool', () => {
		expect(GAME_TOOLS.find((tool) => tool.id === 'farm')).toMatchObject({ label: 'Farm', shortcut: 'G', cost: 100 });
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

	it('Solar Farm is available as an $8,000 power tool on V', () => {
		expect(GAME_TOOLS.find((tool) => tool.id === 'solar')).toMatchObject({
			label: 'Solar Farm',
			shortcut: 'V',
			cost: 8000,
		});
		expect(resolveEditingTool({ EditingTool: { TOOL_SOLARPOWER: 20 } } as never, 'solar')).toBe(20);
	});

	it('6×6 airport anchors top-left at center − (1, 1)', () => {
		expect(toolFootprintAtCenter(10, 20, 'airport')).toEqual({ x: 9, y: 19, w: 6, h: 6 });
	});
});
