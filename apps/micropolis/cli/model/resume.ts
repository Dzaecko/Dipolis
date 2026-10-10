import { readProtocol } from '../../src/lib/city-run/protocol';
import type { ResumeState } from './runner';

export function readResume(text: string, assignment: string, model: string, run: number, handbook: 'on' | 'off' = 'off'): ResumeState {
 const protocol = readProtocol(text);
 for (const e of protocol.events) {
  if ((e.assignment !== undefined && e.assignment !== assignment) ||
  (e.model !== undefined && e.model !== model) || (e.run !== undefined && e.run !== run) ||
  (e.handbook ?? 'off') !== handbook)
   throw new Error('Resume identity mismatch');
 }
 if (protocol.complete) throw new Error('Invalid or already completed resume log');
 return { completed: protocol.years, ...(protocol.partial ? { partial: protocol.partial } : {}) };
}