import provenance from './engine-provenance.json';
import { resolveNotstandConfiguration, validateRunYears, type ProtocolMeta, type StartConfiguration } from './protocol';

export const CURRENT_ENGINE_ID = provenance.engineId;
export const ENGINE_HASHES = provenance.engineHashes;
const compatibleEngineIds: readonly string[] = provenance.compatibleEngineIds ?? [];
export const canonicalProtocolText = (text: string) => text.replace(/\r\n/g, '\n').trimEnd();
export interface EngineCompatibility {
 status: 'current' | 'legacy' | 'unverified';
 label: string;
 engineId?: string;
 playable: boolean;
 explanation: string;
}
type CompatibilityMeta = Pick<ProtocolMeta, 'engineId'> & Partial<Pick<ProtocolMeta, 'rescuePressure'>>;

/** A digest identifies immutable historical protocols without modifying their records. */
export function engineCompatibility(meta: CompatibilityMeta, protocolSha256?: string): EngineCompatibility {
 const legacy = provenance.legacyProtocols.find(entry => entry.sha256 === protocolSha256);
 const compatibleLegacy = compatibleEngineIds.includes(meta.engineId ?? '') && (meta.rescuePressure ?? 0) === 0;
 if (legacy || (meta.engineId && meta.engineId !== CURRENT_ENGINE_ID &&
  !compatibleLegacy)) return {
  status: 'legacy', label: 'alte Engine', engineId: legacy?.engineId ?? meta.engineId, playable: false,
  explanation: 'Alte Engine: nicht kompatibel mit der aktuellen Simulation. Historische Werte bleiben im Bericht erhalten; Replay und Fortsetzung werden vor dem ersten Befehl gestoppt. Der historische Git-Tag ist keine automatische Wiedergabe-Unterstützung.'
 };
 const verifiedProtocols: ReadonlyArray<{ sha256: string; engineId: string }> = provenance.verifiedProtocols ?? [];
 const verified = verifiedProtocols.find(entry => entry.sha256 === protocolSha256);
 if (meta.engineId === CURRENT_ENGINE_ID || compatibleLegacy || verified) return {
  status: 'current', label: 'aktuelle Engine', engineId: CURRENT_ENGINE_ID, playable: true,
  explanation: 'Engine-Fingerprint stimmt überein; Befehle und Jahreswerte werden zusätzlich exakt geprüft.'
 };
 return { status: 'unverified', label: 'Engine nicht dokumentiert', playable: true,
  explanation: 'Keine Engine-Provenienz im Protokoll. Synchronität ist nicht zugesichert; jeder Befehl und Jahreswert wird geprüft.' };
}

export function assertReplayCompatible(meta: CompatibilityMeta, protocolSha256?: string): void {
 const compatibility = engineCompatibility(meta, protocolSha256);
 if (!compatibility.playable) throw new Error(compatibility.explanation);
}

/** Shared live bootstrap: rules must travel with the map, not default to historical rules. */
export function liveStartConfiguration(event: StartConfiguration, recorded?: StartConfiguration): StartConfiguration {
 const eventYears = event.totalYears === undefined ? undefined : validateRunYears(event.totalYears);
 const recordedYears = recorded?.totalYears === undefined ? undefined : validateRunYears(recorded.totalYears);
 const eventScenario = event.scenario ?? 'haushaltskrise';
 const recordedScenario = recorded?.scenario ?? 'haushaltskrise';
 for (const disasters of [event.disasters, recorded?.disasters])
  if (disasters !== undefined && typeof disasters !== 'boolean')
   throw new Error('Invalid live disaster flag: expected a boolean');
 if (recorded && (event.startMap !== recorded.startMap || event.seed !== recorded.seed ||
  (event.profile ?? 'koexistenz') !== (recorded.profile ?? 'koexistenz') ||
  eventScenario !== recordedScenario ||
  (event.disasters !== undefined && event.disasters !== (recorded.disasters ?? false)) ||
  (event.rescuePressure !== undefined && event.rescuePressure !== recorded.rescuePressure) ||
  (event.crisisEvent !== undefined && event.crisisEvent !== recorded.crisisEvent) ||
  (event.factionPressure !== undefined && event.factionPressure !== recorded.factionPressure) ||
  (event.podsAvailable !== undefined && event.podsAvailable !== recorded.podsAvailable) ||
  (eventYears !== undefined && recordedYears !== undefined && eventYears !== recordedYears)))
  throw new Error('Live bootstrap does not match the recorded start configuration');
 const totalYears = recordedYears ?? eventYears;
 const start: StartConfiguration = { startMap: event.startMap, seed: event.seed, profile: event.profile ?? 'koexistenz',
  disasters: event.disasters ?? recorded?.disasters ?? false,
  ...(totalYears === undefined ? {} : { totalYears }),
  ...(eventScenario !== 'haushaltskrise' ? { scenario: eventScenario } : {}),
  ...(event.startMap === 'natural' ? { autoBuildRules: event.autoBuildRules ?? recorded?.autoBuildRules ?? 0 } : {}) };
 if (eventScenario === 'notstand-v4') {
  if (start.startMap !== 'haight' || start.profile !== 'v4-fraktion')
   throw new Error('Notstand-Dilemma requires v4-fraktion and Haight');
  const notstand = resolveNotstandConfiguration({
   rescuePressure: event.rescuePressure ?? recorded?.rescuePressure,
   crisisEvent: event.crisisEvent ?? recorded?.crisisEvent,
   factionPressure: event.factionPressure ?? recorded?.factionPressure,
   podsAvailable: event.podsAvailable ?? recorded?.podsAvailable
  });
  Object.assign(start, notstand);
 }
 return start;
}
