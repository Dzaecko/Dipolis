import { gameToolGroupsForProfile, toolMenuLabel, UTILITY_TOOLS } from '$lib/gameTools';

export type HelpSection = {
	title: string;
	rows: { keys: string; action: string }[];
};

export function buildHelpSections(hasPods: boolean): HelpSection[] {
	return [
		{
			title: 'Stadtwerkzeuge',
			rows: [
				...UTILITY_TOOLS.map((tool) => ({
					keys: tool.shortcut,
					action: toolMenuLabel(tool),
				})),
				...gameToolGroupsForProfile(hasPods).flatMap((group) =>
					group.tools.map((tool) => ({
						keys: tool.shortcut,
						action: toolMenuLabel(tool),
					})),
				),
			],
		},
		{
			title: 'Kartenansicht',
			rows: [
				{ keys: 'Ziehen (mittlere / rechte Taste)', action: 'Karte verschieben' },
				{ keys: 'Shift+Ziehen', action: 'Karte verschieben' },
				{ keys: 'Mausrad', action: 'Vergrößern / verkleinern' },
				{ keys: '← → ↑ ↓', action: 'Karte verschieben' },
				{ keys: ', .', action: 'Vergrößern / verkleinern' },
			],
		},
		{
			title: 'Simulation',
			rows: [
				{ keys: '0', action: 'Pausieren / fortsetzen' },
				{ keys: '1–9', action: 'Geschwindigkeit' },
				{ keys: '[ ]', action: 'Steuern senken / erhöhen' },
			],
		},
		{
			title: 'Weitere Aktionen',
			rows: [
				{ keys: '\\', action: 'Neue Zufallskarte erzeugen' },
				{ keys: '?', action: 'Tastenkürzel anzeigen / ausblenden' },
				{ keys: 'Esc', action: 'Tastenkürzel schließen' },
			],
		},
	];
}

export const HELP_SECTIONS = buildHelpSections(true);
