import { DEFAULT_START_CONFIGURATION, readProtocol, type StartConfiguration } from '../../src/lib/city-run/protocol';
import type { ResumeState } from './runner';

export function readResume(text: string, assignment: string, model: string, run: number,
 handbook: 'on' | 'off' = 'off', requestedStart?: Partial<StartConfiguration>): ResumeState & { startConfiguration: StartConfiguration } {
 const protocol = readProtocol(text);
 for (const e of protocol.events) {
  if ((e.assignment !== undefined && e.assignment !== assignment) ||
  (e.model !== undefined && e.model !== model) || (e.run !== undefined && e.run !== run) ||
  (e.handbook ?? 'off') !== handbook)
   throw new Error('Resume identity mismatch');
 }
 const startConfiguration = protocol.meta.startMap && protocol.meta.seed !== undefined
  ? { startMap: protocol.meta.startMap, seed: protocol.meta.seed, profile: protocol.meta.profile,
   ...(protocol.meta.scenario === 'stromkrise' ? { scenario: protocol.meta.scenario } : {}) } : DEFAULT_START_CONFIGURATION;
 if (requestedStart?.scenario !== undefined && requestedStart.scenario !== (startConfiguration.scenario ?? 'haushaltskrise'))
  throw new Error(`Resume scenario mismatch: protocol uses ${startConfiguration.scenario ?? 'haushaltskrise'}`);
 if (requestedStart?.profile !== undefined && requestedStart.profile !== startConfiguration.profile)
  throw new Error(`Resume profile mismatch: protocol uses ${startConfiguration.profile}`);
 if (requestedStart?.startMap !== undefined && requestedStart.startMap !== startConfiguration.startMap)
  throw new Error(`Resume start map mismatch: protocol uses ${startConfiguration.startMap}`);
 if (requestedStart?.seed !== undefined && requestedStart.seed !== startConfiguration.seed)
  throw new Error(`Resume seed mismatch: protocol uses ${startConfiguration.seed}`);
 if (protocol.complete) throw new Error('Invalid or already completed resume log');
 return { completed: protocol.years, ...(protocol.partial ? { partial: protocol.partial } : {}), startConfiguration };
}