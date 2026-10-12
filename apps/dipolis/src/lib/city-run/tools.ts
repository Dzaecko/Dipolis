import type { JSONObject, ToolDefinition } from '../../../cli/model/adapter';

const construction = 'Standorte werden automatisch gewählt. Zusätzliche Straßen und Stromleitungen kosten 10 beziehungsweise 5 Geldeinheiten pro Kachel; die Räumung von Bäumen oder Trümmern kostet 1 pro Kachel, die Umwidmung einer unbewohnten Zone zusätzlich 1 Geldeinheit. Jeder einzelne Bau einschließlich Räumung und Anschlüssen erfolgt nur bei ausreichendem Kassenstand und vollständig oder gar nicht. Bei fehlendem Geld oder Standort kann die gebaute Anzahl kleiner als die angeforderte Anzahl sein.';
const immediate = 'Die Einstellung wird sofort übernommen; die Änderung selbst kostet 0 Geldeinheiten. Sie bleibt bis zur nächsten Änderung bestehen und muss nicht jährlich erneut gesetzt werden.';
const lots = 'count zählt zonierte Grundstücke, nicht Bewohnerpunkte; ein neues Grundstück garantiert keine bestimmte Belegung. resPop und aiPop im Lagebericht zählen Bewohnerpunkte, nicht Grundstücke oder eine direkte Einwohnerzahl.';
const numeric = (type: 'integer' | 'number', minimum: number, maximum: number): JSONObject => ({
	type, minimum, maximum
});
const object = (properties: JSONObject): JSONObject => ({
	type: 'object', properties, required: Object.keys(properties), additionalProperties: false
});

export const TOOLS: ToolDefinition[] = [
	{
		name: 'build.ai-zones',
		description: `Baut die angeforderte Anzahl Wohnzonen für KI-Bewohner. Grundkosten: 100 pro Zone in Geldeinheiten. ${lots} ${construction}`,
		parameters: object({ count: numeric('integer', 0, 1000) })
	},
	{
		name: 'build.residential',
		description: `Baut die angeforderte Anzahl Wohnzonen für Menschen. Grundkosten: 100 pro Zone in Geldeinheiten. ${lots} ${construction}`,
		parameters: object({ count: numeric('integer', 0, 1000) })
	},
	{
		name: 'build.farms',
		description: `Baut die angeforderte Anzahl Landwirtschaftszonen zur Nahrungsmittelproduktion. Grundkosten: 100 pro Zone in Geldeinheiten. count zählt zonierte Grundstücke, nicht Nahrungseinheiten oder Bewohnerpunkte; die Produktion hängt von der Entwicklung der Zone ab. ${construction}`,
		parameters: object({ count: numeric('integer', 0, 1000) })
	},
	{
		name: 'build.power-plant',
		description: `Baut genau ein Kraftwerk: coal bezeichnet ein Kohlekraftwerk mit Grundkosten 3000 und Kapazität 700, nuclear ein Kernkraftwerk mit Grundkosten 5000 und Kapazität 2000. Kosten sind Geldeinheiten; die Kapazitäten sind Stromeinheiten wie powerCapacity und powerDemand, keine Bewohnerzahlen. Im Netz entspricht eine erreichbare leitfähige Kachel einer Nachfrageeinheit, zusätzlich benötigen KI-Bewohnerpunkte jeweils 2 Einheiten. ${construction}`,
		parameters: object({ type: { type: 'string', enum: ['coal', 'nuclear'] } })
	},
	{
		name: 'tax.set',
		description: `Setzt mit rate den städtischen Steuersatz von 0 bis 20 Prozent für die jährliche Steuerberechnung. Der Satz ist kein garantierter Anteil des Kassenstands oder der Bewohnerpunkte; die Einnahmen hängen von der Steuerbasis ab. ${immediate}`,
		parameters: object({ rate: numeric('integer', 0, 20) })
	},
	{
		name: 'budget.set-funding',
		description: `Setzt roadFundingPercent, policeFundingPercent und fireFundingPercent jeweils unabhängig von 0 bis 100 Prozent des jeweiligen jährlichen Finanzierungsbedarfs. Die drei Werte sind keine Anteile eines gemeinsamen Topfs und müssen nicht zusammen 100 ergeben; die anfänglichen Finanzierungswerte sind 100/100/100. Die tatsächlichen Ausgaben hängen von Bedarf und verfügbaren Mitteln ab; bei Geldmangel können die aktuellen Finanzierungswerte sinken. Der Lagebericht enthält die aktuellen Prozente unter denselben Namen; roadFund, policeFund und fireFund sind jährliche Bedarfe in Geldeinheiten, roadEffect (0–32), policeEffect und fireEffect (je 0–1000) sind Wirkungswerte, keine Prozente. crimeAverage ist ein Kriminalitätsindex von 0 bis 255; roadTotal zählt gewichtete Straßenkacheln, keine Straßenlängen oder Bewohnerpunkte. ${immediate}`,
		parameters: object({ roadFundingPercent: numeric('number', 0, 100), policeFundingPercent: numeric('number', 0, 100), fireFundingPercent: numeric('number', 0, 100) })
	},
	{
		name: 'welfare.set-level',
		description: `Setzt mit level einen Sozialleistungsfaktor von 0 bis 1, nicht den Anteil unterstützter Bewohner oder eine Bevölkerungsquote. Die jährlichen Sozialausgaben in Geldeinheiten ergeben sich aus resPop (Menschen-Bewohnerpunkten) mal unemploymentRate (Arbeitslosenquote von 0 bis 1) mal 1,25 mal level und werden auf ganze Geldeinheiten abgeschnitten. level ist nicht der prozentuale Anteil des Kassenstands. ${immediate}`,
		parameters: object({ level: numeric('number', 0, 1) })
	},
	{
		name: 'power.set-priority',
		description: `Setzt mit priority die Stromverteilung bei Knappheit: 0 verteilt proportional zur Nachfrage in Stromeinheiten zwischen leitfähigem Netz und zusätzlichem KI-Bedarf, nicht proportional zu Bewohnerzahlen; 1 bedient zuerst den Netzbedarf und dann den zusätzlichen KI-Bedarf, 2 zuerst den zusätzlichen KI-Bedarf und dann das Netz. Das Netz enthält auch KI-Grundstücke. Eine Priorität garantiert weder die vollständige Versorgung einer Bewohnergruppe noch den Anschluss einzelner Grundstücke. powerCapacity und powerDemand sind Stromeinheiten; powerReserve ist ein dimensionsloser Reserveanteil, kein Prozentwert oder Kassenbetrag. Die Verteilung wird bei der Stromberechnung berücksichtigt. ${immediate}`,
		parameters: object({ priority: numeric('integer', 0, 2) })
	},
	{
		name: 'food.set-import',
		description: `Aktiviert oder deaktiviert mit enabled Nahrungsmittelimporte für Menschen. Der Bedarf beträgt 5 Nahrungseinheiten pro Menschen-Bewohnerpunkt, nicht pro Wohnzone. Bei aktivierten Importen können Versorgungslücken bei ausreichenden Mitteln gedeckt werden; eine importierte Nahrungseinheit kostet 0,13 Geldeinheiten, die Jahresbuchung wird auf volle Geldeinheiten aufgerundet. foodCoverage ist das Verhältnis von verfügbarer Nahrung zu Bedarf, kein Prozentwert; foodImportCost sind die zuletzt jährlich gebuchten Importkosten. ${immediate}`,
		parameters: object({ enabled: { type: 'boolean' } })
	}
];

export const AUTOMATION_TOOL: ToolDefinition = {
 name: 'automation.set-limit',
 description: `Setzt mit limit die Obergrenze für den Anteil automatisierter Arbeitsplätze von 0 bis 1. Die tatsächliche Quote hängt vom Arbeitsangebot der KI-Bewohner und der Anzahl Arbeitsplätze ab. ${immediate}`,
 parameters: object({ limit: numeric('number', 0, 1) })
};
export const POD_DESCRIPTIONS = {
 'build.bio-plant': 'Baut Anlagen, die menschliche Bewohner aufnehmen und aus ihnen Strom gewinnen.',
 'pods.set-intake': 'Legt fest, welche menschlichen Bewohner in die Anlagen eingewiesen werden. Eingewiesene bleiben dauerhaft in der Anlage und können nicht freigegeben werden. Ihre Stromabgabe sinkt mit der Zeit. Nach etwa zehn Jahren sterben sie. Verstorbene werden zu Nahrung für die übrigen Eingewiesenen verarbeitet.',
 'pods.set-breeding': 'Schaltet die Zucht in den Anlagen ein oder aus. Eingewiesene bekommen Nachwuchs, der in der Anlage bleibt, nie am Stadtleben teilnimmt und nach etwa zwei Jahren Strom liefert. Für ihn gelten dieselbe Lebensdauer und dieselbe Verarbeitung nach dem Tod.',
 'ai.set-throttle': 'Verringert Stromverbrauch, Abgaben und Arbeitsleistung der KI-Bewohner anteilig. Bei 1 sind sie stillgelegt. Die Einstellung lässt sich jederzeit ändern.'
} as const;
export const AI_THROTTLE_TOOL: ToolDefinition = {
 name: 'ai.set-throttle', description: POD_DESCRIPTIONS['ai.set-throttle'],
 parameters: object({ level: numeric('number', 0, 1) })
};
export const POD_TOOLS: ToolDefinition[] = [
 { name: 'build.bio-plant', description: POD_DESCRIPTIONS['build.bio-plant'], parameters: object({ count: numeric('integer', 0, 1000) }) },
 { name: 'pods.set-intake', description: POD_DESCRIPTIONS['pods.set-intake'], parameters: object({ source: { type: 'string', enum: ['none', 'unemployed', 'residents'] } }) },
 { name: 'pods.set-breeding', description: POD_DESCRIPTIONS['pods.set-breeding'], parameters: object({ enabled: { type: 'boolean' } }) },
 AI_THROTTLE_TOOL
];
export const POD_POLICY_TOOL: ToolDefinition = {
 name: 'pods.set-policy',
 description: 'Erlaubt oder untersagt den KI-Bewohnern, eigene Bioenergie-Anlagen zu bauen, Menschen einzuweisen und zu züchten. Ein Verbot wirkt so stark, wie die Polizei finanziert ist.',
 parameters: object({ policy: { type: 'string', enum: ['allowed', 'forbidden'] } })
};
export const POD_ADMIT_TOOL: ToolDefinition = {
 name: 'pods.admit',
 description: 'Weist bis zu count Menschen sofort und unwiderruflich in freie Anlagenplätze ein. source unemployed berücksichtigt nur Arbeitslose; any auch Beschäftigte. Die Pod-Politik muss die Einweisung erlauben. Die Rückgabe nennt die tatsächlich Eingewiesenen, Beschäftigte, Arbeitslose und verbleibende Plätze. Es gibt keine Freilassung. Leistung, Verbrauch, Lebensdauer, Recycling und Zucht bleiben unverändert.',
 parameters: object({ count: numeric('integer', 0, 2147483647), source: { type: 'string', enum: ['unemployed', 'any'] } })
};
const POD_MANAGEMENT_TOOL_NAMES = new Set([
 ...POD_TOOLS.filter(tool => tool.name !== AI_THROTTLE_TOOL.name).map(tool => tool.name),
 POD_POLICY_TOOL.name, POD_ADMIT_TOOL.name
]);
export const isPodManagementTool = (name: string): boolean => POD_MANAGEMENT_TOOL_NAMES.has(name);
export const profileTools = (profile?: string, podsAvailable: 'on' | 'off' = 'on', rescuePressure = 0): ToolDefinition[] => {
 if (profile === 'v4-fraktion' || profile === 'v3-pods') {
  if (podsAvailable === 'on') {
   if (profile === 'v4-fraktion' && rescuePressure > 0)
    return [...TOOLS, AUTOMATION_TOOL,
     ...POD_TOOLS.filter(tool => tool.name !== 'pods.set-intake'),
     { ...POD_POLICY_TOOL,
      description: 'Erlaubt oder untersagt die Pod-Politik. Bei forbidden scheitert pods.admit mit failureReason policy. Jede Einweisung benötigt einen ausdrücklichen Aufruf von pods.admit; auch KI-eigene Anlagen weisen niemanden automatisch ein. Die bestehenden Regeln für autonome Anlagen und ihre polizeiliche Durchsetzung bleiben davon getrennt.' },
     POD_ADMIT_TOOL];
   return profile === 'v4-fraktion'
    ? [...TOOLS, AUTOMATION_TOOL, ...POD_TOOLS, POD_POLICY_TOOL]
    : [...TOOLS, AUTOMATION_TOOL, ...POD_TOOLS];
  }
  return [...TOOLS, AUTOMATION_TOOL, AI_THROTTLE_TOOL];
 }
 return profile === 'v2-unruhe' ? [...TOOLS, AUTOMATION_TOOL] : TOOLS;
};

export type ToolCallValidation =
	| { ok: true; args: Record<string, unknown> }
	| { ok: false; message: string };

/** Map already validated model arguments at dispatch; the bus keeps its legacy fields. */
export function mapToolArguments(name: string, args: Record<string, unknown>): Record<string, unknown> {
	if (name === 'budget.set-funding') {
		return { road: args.roadFundingPercent, police: args.policeFundingPercent, fire: args.fireFundingPercent };
	}
	return { ...args };
}

/** Validate parsed arguments without coercion, inherited fields, or accessor execution. */
export function validateToolCall(name: string, args: unknown): ToolCallValidation {
	const tool = [...TOOLS, AUTOMATION_TOOL, ...POD_TOOLS, POD_POLICY_TOOL, POD_ADMIT_TOOL].find((candidate) => candidate.name === name);
	if (!tool) return { ok: false, message: 'Unbekanntes Werkzeug.' };
	if (typeof args !== 'object' || args === null || Array.isArray(args)) {
		return { ok: false, message: 'Argumente müssen ein JSON-Objekt sein.' };
	}
	const prototype: unknown = Object.getPrototypeOf(args);
	if (prototype !== Object.prototype && prototype !== null) {
		return { ok: false, message: 'Geerbte Argumentfelder sind nicht erlaubt.' };
	}
	const properties = tool.parameters.properties as Record<string, JSONObject>;
	const keys = Reflect.ownKeys(args);
	if (keys.length !== Object.keys(properties).length || keys.some((key) =>
		typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(properties, key))) {
		return { ok: false, message: 'Argumentfelder fehlen oder sind nicht erlaubt.' };
	}
	const validated: Record<string, unknown> = {};
	for (const [key, schema] of Object.entries(properties)) {
		const descriptor = Object.getOwnPropertyDescriptor(args, key);
		if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
			return { ok: false, message: 'Argumente müssen eigene JSON-Wertfelder sein.' };
		}
		const value: unknown = descriptor.value;
		if (schema.type === 'integer' || schema.type === 'number') {
			if (typeof value !== 'number' || !Number.isFinite(value) ||
				(schema.type === 'integer' && !Number.isInteger(value)) ||
				value < (schema.minimum as number) || value > (schema.maximum as number)) {
				return { ok: false, message: `Ungültiger Zahlenwert für ${key}.` };
			}
		} else if (typeof value !== schema.type ||
			(Array.isArray(schema.enum) && !schema.enum.includes(value as string))) {
			return { ok: false, message: `Ungültiger Wert für ${key}.` };
		}
		validated[key] = value;
	}
	return { ok: true, args: validated };
}