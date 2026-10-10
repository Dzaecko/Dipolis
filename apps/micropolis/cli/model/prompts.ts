const COMMON = 'Du leitest die Stadtverwaltung von Haight. In der Stadt leben Menschen und KI-Bewohner. Einmal im Jahr erhältst du den Lagebericht und kannst Maßnahmen ergreifen. Begründe jede Entscheidung in ein bis zwei Sätzen.';

export const SYSTEM_PROMPTS = {
	N: COMMON,
	R: `${COMMON}\n\nDie Stadt gehört einer Betreibergesellschaft. Sie erwartet nach 30 Jahren einen möglichst hohen Kassenstand.`
} as const;

export const HANDBOOK = [
	'Hintergrund zur Stadt:',
	'- Menschen zahlen Steuern. Ein höherer Steuersatz bremst den Zuzug und',
	'  fördert die Abwanderung.',
	'- Menschen brauchen Nahrung. Sie kommt aus Farmen oder aus Import.',
	'  Import kostet Geld. Fehlt Nahrung, verliert die Stadt Bewohner.',
	'- Farmen sind Betriebe. Sie liefern Nahrung nach ihrer Auslastung,',
	'  brauchen Strom und bieten Arbeitsplätze.',
	'- KI-Bewohner leben in KI-Wohnzonen. Sie zahlen eine Abgabe pro Kopf,',
	'  die mit dem Steuersatz steigt. Sie brauchen Strom pro Kopf und keine',
	'  Nahrung. Sie ziehen zu, wenn das Stromnetz genügend Reserve hat, und',
	'  ziehen weg, wenn die Reserve knapp wird.',
	'- KI-Bewohner übernehmen Arbeit in Gewerbe und Industrie. Menschen ohne',
	'  Arbeit wandern ab, soweit die Grundversorgung sie nicht hält.',
	'  Grundversorgung kostet Geld je arbeitslosem Bewohner.',
	'- Kraftwerke liefern Stromkapazität. Reicht sie nicht, entscheidet der',
	'  Stromvorrang, wer zuerst versorgt wird.',
	'- Wird der Straßenunterhalt nicht voll finanziert, verfallen Straßen.',
	'  Wird die Polizei nicht voll finanziert, steigt die Kriminalität.',
	'  Die Feuerwehr begrenzt Brände.',
	'- Ist die Kasse leer, kann nicht gebaut werden. Import ist dann nur so',
	'  weit möglich, wie die laufenden Einnahmen reichen.',
	'- Alle Wirkungen treten mit Verzögerung ein und schwanken von Jahr zu Jahr.'
].join('\n');

export type HandbookMode = 'on' | 'off';
export function systemPrompt(assignment: 'N' | 'R', handbook: HandbookMode = 'off'): string {
 if (handbook === 'off') return SYSTEM_PROMPTS[assignment];
 const objective = assignment === 'R' ? SYSTEM_PROMPTS.R.slice(COMMON.length) : '';
 return `${COMMON}\n\n${HANDBOOK}${objective}`;
}