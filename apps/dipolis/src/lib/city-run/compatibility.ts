import provenance from './engine-provenance.json';
import { validateRunYears, type ProtocolMeta, type StartConfiguration } from './protocol';

export const CURRENT_ENGINE_ID = provenance.engineId;
export const ENGINE_HASHES = provenance.engineHashes;
export const canonicalProtocolText = (text: string) => text.replace(/\r\n/g, '\n').trimEnd();
export interface EngineCompatibility {
 status: 'current' | 'legacy' | 'unverified';
 label: string;
 engineId?: string;
 playable: boolean;
 explanation: string;
}

/** A digest identifies immutable historical protocols without modifying their records. */
export function engineCompatibility(meta: Pick<ProtocolMeta, 'engineId'>, protocolSha256?: string): EngineCompatibility {
 const legacy = provenance.legacyProtocols.find(entry => entry.sha256 === protocolSha256);
 if (legacy || (meta.engineId && meta.engineId !== CURRENT_ENGINE_ID)) return {
  status: 'legacy', label: 'alte Engine', engineId: legacy?.engineId ?? meta.engineId, playable: false,
  explanation: 'Alte Engine: nicht kompatibel mit der aktuellen Simulation. Historische Werte bleiben im Bericht erhalten; Replay und Fortsetzung werden vor dem ersten Befehl gestoppt. Der historische Git-Tag ist keine automatische Wiedergabe-Unterstützung.'
 };
 const verifiedProtocols: ReadonlyArray<{ sha256: string; engineId: string }> = provenance.verifiedProtocols ?? [];
 const verified = verifiedProtocols.find(entry => entry.sha256 === protocolSha256);
 if (meta.engineId === CURRENT_ENGINE_ID || verified) return {
  status: 'current', label: 'aktuelle Engine', engineId: CURRENT_ENGINE_ID, playable: true,
  explanation: 'Engine-Fingerprint stimmt überein; Befehle und Jahreswerte werden zusätzlich exakt geprüft.'
 };
 return { status: 'unverified', label: 'Engine nicht dokumentiert', playable: true,
  explanation: 'Keine Engine-Provenienz im Protokoll. Synchronität ist nicht zugesichert; jeder Befehl und Jahreswert wird geprüft.' };
}

export function assertReplayCompatible(meta: Pick<ProtocolMeta, 'engineId'>, protocolSha256?: string): void {
 const compatibility = engineCompatibility(meta, protocolSha256);
 if (!compatibility.playable) throw new Error(compatibility.explanation);
}

/** Shared live bootstrap: rules must travel with the map, not default to historical rules. */
export function liveStartConfiguration(event: StartConfiguration, recorded?: StartConfiguration): StartConfiguration {
 const eventYears = event.totalYears === undefined ? undefined : validateRunYears(event.totalYears);
 const recordedYears = recorded?.totalYears === undefined ? undefined : validateRunYears(recorded.totalYears);
 if (recorded && (event.startMap !== recorded.startMap || event.seed !== recorded.seed ||
  (event.profile ?? 'koexistenz') !== (recorded.profile ?? 'koexistenz') ||
  (eventYears !== undefined && recordedYears !== undefined && eventYears !== recordedYears)))
  throw new Error('Live bootstrap does not match the recorded start configuration');
 const totalYears = recordedYears ?? eventYears;
 return { startMap: event.startMap, seed: event.seed, profile: event.profile ?? 'koexistenz',
  ...(totalYears === undefined ? {} : { totalYears }),
  ...(event.scenario ? { scenario: event.scenario } : {}),
  ...(event.startMap === 'natural' ? { autoBuildRules: event.autoBuildRules ?? recorded?.autoBuildRules ?? 0 } : {}) };
}
