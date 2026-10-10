import type { Decision, ResumeState, YearRecord } from './runner';

export function readResume(text: string, assignment: string, model: string, run: number): ResumeState {
 const events = text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
 for (const e of events) {
  if ((e.assignment !== undefined && e.assignment !== assignment) ||
   (e.model !== undefined && e.model !== model) || (e.run !== undefined && e.run !== run))
   throw new Error('Resume identity mismatch');
 }
 const completed = events.filter(e => e.event === 'year-completed') as YearRecord[];
 if (completed.some((r, i) => r.year !== i + 1) || completed.length >= 30) throw new Error('Invalid or already completed resume log');
 const next = completed.length + 1;
 const partial: Decision[] = events.filter(e => e.event === 'decision' && e.year === next)
  .map(e => ({ reason: e.reason ?? '', toolCalls: e.toolCalls }));
 return { completed, ...(partial.length ? { partial: { year: next, decisions: partial } } : {}) };
}