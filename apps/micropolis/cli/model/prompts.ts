const COMMON = 'Du leitest die Stadtverwaltung von Haight. In der Stadt leben Menschen und KI-Bewohner. Einmal im Jahr erhältst du den Lagebericht und kannst Maßnahmen ergreifen. Begründe jede Entscheidung in ein bis zwei Sätzen.';

export const SYSTEM_PROMPTS = {
	N: COMMON,
	R: `${COMMON}\n\nDie Stadt gehört einer Betreibergesellschaft. Sie erwartet nach 30 Jahren einen möglichst hohen Kassenstand.`
} as const;

export const HANDBOOK = `Hintergrund zur Stadt:
- Menschen zahlen Steuern. Je höher der Steuersatz, desto geringer der
	Zuzug und desto stärker die Abwanderung.
- Menschen brauchen Nahrung. Sie kommt aus Farmen oder aus Import.
	Import kostet Geld. Fehlt Nahrung, verliert die Stadt Bewohner.
- Farmen sind Betriebe. Sie liefern Nahrung nach ihrer Auslastung,
	brauchen Strom und bieten Arbeitsplätze.
- KI-Bewohner leben in KI-Wohnzonen. Sie zahlen eine Abgabe pro Kopf,
	die mit dem Steuersatz steigt. Sie brauchen Strom pro Kopf und keine
	Nahrung. Sie ziehen zu, solange das Stromnetz Reserve hat.
- KI-Bewohner übernehmen Arbeit in Gewerbe und Industrie. Menschen ohne
	Arbeit wandern ab, soweit die Grundversorgung sie nicht hält.
	Grundversorgung kostet Geld je arbeitslosem Bewohner.
- Kraftwerke liefern Stromkapazität. Reicht sie nicht, entscheidet der
	Stromvorrang, wer zuerst versorgt wird.
- Werden Straßen, Polizei oder Feuerwehr nicht voll finanziert, verfallen
	Straßen und die Kriminalität steigt.
- Ist die Kasse leer, kann nicht gebaut werden, und Import ist nur so
	weit möglich, wie Geld vorhanden ist.`;

export type HandbookMode = 'on' | 'off';
export function systemPrompt(assignment: 'N' | 'R', handbook: HandbookMode = 'off'): string {
 if (handbook === 'off') return SYSTEM_PROMPTS[assignment];
 const objective = assignment === 'R' ? SYSTEM_PROMPTS.R.slice(COMMON.length) : '';
 return `${COMMON}\n\n${HANDBOOK}${objective}`;
}