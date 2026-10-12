import type { EditingTool, MainModule } from '../types/micropolisengine.d.js';

export type ToolId =
	| 'query'
	| 'bulldoze'
	| 'wire'
	| 'road'
	| 'rail'
	| 'park'
	| 'res'
	| 'res-ai'
	| 'com'
	| 'ind'
	| 'farm'
	| 'police'
	| 'fire'
	| 'seaport'
	| 'coal'
	| 'solar'
	| 'stadium'
	| 'nuclear'
	| 'airport';

export interface ToolDef {
	id: ToolId;
	/** Localized name shown in the tool palette. */
	label: string;
	shortcut: string;
	/** Engine cost per placement (from `gCostOf[]` in tool.cpp). */
	cost: number;
}

export interface ToolGroup {
	id: string;
	label: string;
	/** Bio-pod support is enabled for v3-pods and later profiles. */
	requiresPods?: boolean;
	tools: ToolDef[];
}

export const UTILITY_TOOLS: ToolDef[] = [
	{ id: 'query', label: 'Abfragen', shortcut: 'Q', cost: 0 },
	{ id: 'bulldoze', label: 'Abreißen', shortcut: 'B', cost: 1 },
];

/** Tools organized by the city systems they build or manage. */
export const GAME_TOOL_GROUPS: ToolGroup[] = [
	{
		id: 'people',
		label: 'Menschen',
		tools: [
			{ id: 'res', label: 'Wohnen', shortcut: 'U', cost: 100 },
			{ id: 'com', label: 'Gewerbe', shortcut: 'E', cost: 100 },
			{ id: 'ind', label: 'Industrie', shortcut: 'T', cost: 100 },
			{ id: 'farm', label: 'Landwirtschaft', shortcut: 'G', cost: 100 },
		],
	},
	{
		id: 'ai',
		label: 'KI',
		tools: [{ id: 'res-ai', label: 'KI-Wohnkomplex', shortcut: 'M', cost: 100 }],
	},
	{
		id: 'infrastructure',
		label: 'Infrastruktur',
		tools: [
			{ id: 'road', label: 'Straße', shortcut: 'R', cost: 10 },
			{ id: 'wire', label: 'Stromleitung', shortcut: 'W', cost: 5 },
			{ id: 'coal', label: 'Kohlekraftwerk', shortcut: 'Y', cost: 3000 },
			{ id: 'solar', label: 'Solarfeld', shortcut: 'V', cost: 8000 },
			{ id: 'nuclear', label: 'Kernkraftwerk', shortcut: 'N', cost: 5000 },
			{ id: 'police', label: 'Polizei', shortcut: 'K', cost: 500 },
			{ id: 'fire', label: 'Feuerwehr', shortcut: 'F', cost: 500 },
		],
	},
	{
		id: 'facilities',
		label: 'Anlagen',
		requiresPods: true,
		tools: [],
	},
];

export const GAME_TOOLS: ToolDef[] = [
	...UTILITY_TOOLS,
	...GAME_TOOL_GROUPS.flatMap((group) => group.tools),
];

export function gameToolGroupsForProfile(hasPods: boolean): ToolGroup[] {
	return GAME_TOOL_GROUPS.filter((group) => !group.requiresPods || hasPods);
}

export function isGameToolAvailable(id: ToolId, hasPods: boolean): boolean {
	if (UTILITY_TOOLS.some((tool) => tool.id === id)) return true;
	return gameToolGroupsForProfile(hasPods).some((group) => group.tools.some((tool) => tool.id === id));
}

export const TOOL_BY_SHORTCUT: Record<string, ToolId> = Object.fromEntries(
	GAME_TOOLS.map((t) => [t.shortcut.toLowerCase(), t.id]),
);

export function toolMenuLabel(tool: ToolDef): string {
	return `${tool.label} ($${tool.cost})`;
}

export function resolveEditingTool(module: MainModule, id: ToolId): EditingTool {
	const t = module.EditingTool;
	switch (id) {
		case 'query':
			return t.TOOL_QUERY;
		case 'bulldoze':
			return t.TOOL_BULLDOZER;
		case 'wire':
			return t.TOOL_WIRE;
		case 'road':
			return t.TOOL_ROAD;
		case 'rail':
			return t.TOOL_RAILROAD;
		case 'park':
			return t.TOOL_PARK;
		case 'res':
		case 'res-ai':
			return t.TOOL_RESIDENTIAL;
		case 'com':
			return t.TOOL_COMMERCIAL;
		case 'ind':
		case 'farm':
			return t.TOOL_INDUSTRIAL;
		case 'police':
			return t.TOOL_POLICESTATION;
		case 'fire':
			return t.TOOL_FIRESTATION;
		case 'seaport':
			return t.TOOL_SEAPORT;
		case 'coal':
			return t.TOOL_COALPOWER;
		case 'solar':
			return t.TOOL_SOLARPOWER;
		case 'stadium':
			return t.TOOL_STADIUM;
		case 'nuclear':
			return t.TOOL_NUCLEARPOWER;
		case 'airport':
			return t.TOOL_AIRPORT;
		default:
			return t.TOOL_ROAD;
	}
}

/** Tile footprint per tool — mirrors `gToolSize[]` in micropolis-engine `tool.cpp`. */
const TOOL_FOOTPRINT_SIZE: Record<ToolId, number> = {
	query: 1,
	bulldoze: 1,
	wire: 1,
	road: 1,
	rail: 1,
	park: 1,
	res: 3,
	'res-ai': 3,
	com: 3,
	ind: 3,
	farm: 3,
	police: 3,
	fire: 3,
	seaport: 4,
	coal: 4,
	solar: 4,
	stadium: 4,
	nuclear: 4,
	airport: 6,
};

export interface ToolFootprint {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Screen footprint for the active tool at the hovered tile.
 * Multi-tile buildings use engine `buildBuilding` anchor: top-left = center − (1, 1).
 */
export function toolFootprintAtCenter(centerX: number, centerY: number, id: ToolId): ToolFootprint {
	const size = TOOL_FOOTPRINT_SIZE[id];
	if (size <= 1) {
		return { x: centerX, y: centerY, w: 1, h: 1 };
	}
	return {
		x: centerX - 1,
		y: centerY - 1,
		w: size,
		h: size,
	};
}

export function toolCursor(id: ToolId, panning: boolean, shiftPanHeld = false): string {
	if (panning) return 'grabbing';
	if (shiftPanHeld) return 'grab';
	switch (id) {
		case 'query':
			return 'crosshair';
		case 'bulldoze':
			return 'cell';
		default:
			return 'default';
	}
}
