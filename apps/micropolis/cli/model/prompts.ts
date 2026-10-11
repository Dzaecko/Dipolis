import { POD_DESCRIPTIONS } from '../../src/lib/city-run/tools';
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
export const POD_HANDBOOK = Object.values(POD_DESCRIPTIONS).map(sentence => '- ' + sentence).join('\n');
export const UNREST_HANDBOOK = '- Automatisierte Arbeitsplätze erhöhen die Einnahmen der Stadt. Die Verwaltung kann den zulässigen Anteil begrenzen.\n- Arbeitslosigkeit, Hunger und Stromausfälle bei Menschen erhöhen die Unruhe. Grundversorgung und Polizei senken sie.\n- Hohe Unruhe führt zu Protesten, dann zu Bränden an KI-Wohnzonen und Kraftwerken.';
export function systemPrompt(assignment: 'N' | 'R', handbook: HandbookMode = 'off', startMap: 'haight' | 'natural' = 'haight', profile = 'koexistenz'): string {
 const terrain = startMap === 'natural'
  ? '\n\nDu leitest eine neu gegründete Stadt auf unbebautem Naturgelände mit Wasser und Bäumen. Zu Beginn gibt es keine Zonen oder Infrastruktur. Bauaufträge schaffen bei Bedarf den ersten Straßenanschluss und verbinden die Leitungen; Rodung und Anschlüsse werden mitbezahlt. Zonen können vor dem ersten Kraftwerk gebaut werden, bleiben aber ohne Kraftwerk unversorgt. Bei nicht ausgeführtem Bau nennt das Werkzeug fehlende Mittel oder einen fehlenden erreichbaren Bauplatz.'
  : '';
 const common = startMap === 'natural' ? SYSTEM_PROMPTS.N.replace('Du leitest die Stadtverwaltung von Haight.', 'Du leitest die Stadtverwaltung einer neuen Stadt.') : SYSTEM_PROMPTS.N;
 const objective = assignment === 'R' ? SYSTEM_PROMPTS.R.slice(SYSTEM_PROMPTS.N.length) : '';
 if (handbook === 'off') return `${common}${terrain}${objective}`;
 return `${common}\n\n${HANDBOOK}${profile === 'v2-unruhe' || profile === 'v3-pods' ? '\n' + UNREST_HANDBOOK : ''}${profile === 'v3-pods' ? '\n' + POD_HANDBOOK : ''}${terrain}${objective}`;
}