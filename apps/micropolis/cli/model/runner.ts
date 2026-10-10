import type { ChatAdapter, ChatMessage, ToolCall } from './adapter';
import { SYSTEM_PROMPTS } from './prompts';
import { TOOLS, validateToolCall, mapToolArguments } from './tools';
import { aggregateYears, YEARS, type AnnualReport, type Metrics } from '../wasm/strategy-space';

export type Report = Record<string, number>;
export type Dispatch = (id: string, args?: Record<string, unknown>) => Promise<{
 handled?: boolean; message?: string; data?: unknown;
}>;
export interface Decision {
 reason: string;
 toolCalls: Array<{ call: ToolCall; result: { handled?: boolean; message?: string; data?: unknown } }>;
}
export interface YearRecord {
 year: number; report: Report; decisions: Decision[];
 termination: 'done' | 'call-limit'; afterReport: Report;
 reason?: string;
}
export interface YearContext {
 year: number; report: Report;
 history: string[];
}

export interface RunnerEvent {
 event: 'model-request' | 'model-response' | 'adapter-error'; year: number; model: string;
 inputTokens?: number; outputTokens?: number; usageReported?: boolean; requestBytes?: number;
 attempts?: number; kind?: string; status?: number; responseText?: string; message?: string;
}
export interface ResumeState { completed: YearRecord[]; partial?: { year: number; decisions: Decision[] }; }
export interface RunOptions { resume?: ResumeState; event?: (event: RunnerEvent) => void; }

/** Accept old protocol budget fields for replay, never as new model arguments. */
function replayArguments(call: ToolCall) {
 if (call.name === 'budget.set-funding' && call.arguments && typeof call.arguments === 'object' &&
  'road' in call.arguments) {
  const old = call.arguments as Record<string, unknown>;
  return { roadFundingPercent: old.road, policeFundingPercent: old.police, fireFundingPercent: old.fire };
 }
 return call.arguments;
}

async function replayDecisions(decisions: Decision[], dispatch: Dispatch) {
 for (const d of decisions) for (const { call, result } of d.toolCalls) {
  if (result.handled === false) continue;
  const args = validateToolCall(call.name, replayArguments(call));
  if (!args.ok) throw new Error('Invalid replay tool: ' + call.name);
  const actual = await dispatch(call.name, mapToolArguments(call.name, args.args));
  if (actual.handled === false || JSON.stringify(actual.data) !== JSON.stringify(result.data))
   throw new Error('Replay outcome mismatch: ' + call.name);
 }
}

/** Per-year conversation; only the nine explicit tools reach the trusted bus. */
export async function decideYear(adapter: ChatAdapter, dispatch: Dispatch,
 context: YearContext, assignment: 'N' | 'R', journal?: (decision: Decision) => void,
 event?: (event: RunnerEvent) => void, prior: Decision[] = []) {
 const messages: ChatMessage[] = [
  { role: 'system', content: SYSTEM_PROMPTS[assignment] },
  { role: 'user', content: JSON.stringify(context) },
 ];
 const decisions: Decision[] = [...prior];
 const usedIds = new Set<string>();
 let calls = prior.reduce((n, d) => n + d.toolCalls.length, 0);
 for (const d of prior) for (const { call } of d.toolCalls) usedIds.add(call.id);
 if (prior.length) messages.push({ role: 'user', content: JSON.stringify({ alreadyExecuted:
  prior.flatMap(d => d.toolCalls.map(({ call, result }) => ({ name: call.name, args: call.arguments, result }))) }) });
 let termination: 'done' | 'call-limit' = 'done';
 while (calls < 12) {
  let answer;
  try {
   answer = await adapter.chat({ messages, tools: TOOLS, onRequestMetadata: metadata =>
    event?.({ event: 'model-request', year: context.year, model: adapter.model, ...metadata }),
    onError: e => event?.({ event: 'adapter-error', year: context.year, model: adapter.model,
     kind: e.kind, status: e.status, responseText: e.responseText, attempts: e.attempts,
     requestBytes: e.requestBytes, message: e.message }) });
  } catch (error) {
   const e = error as { kind?: string; status?: number; responseText?: string; attempts?: number; requestBytes?: number; message?: string };
   event?.({ event: 'adapter-error', year: context.year, model: adapter.model, kind: e.kind ?? 'adapter',
    status: e.status, responseText: e.responseText, attempts: e.attempts, requestBytes: e.requestBytes,
    message: e.kind ? e.message : 'Adapter failed' });
   throw error;
  }
  event?.({ event: 'model-response', year: context.year, model: adapter.model,
   inputTokens: answer.usage?.inputTokens ?? 0, outputTokens: answer.usage?.outputTokens ?? 0,
   usageReported: answer.usageReported ?? !!answer.usage, requestBytes: answer.requestBytes });
  if (typeof answer.content !== 'string' || !Array.isArray(answer.toolCalls)) throw new Error('Invalid adapter response');
  messages.push({ role: 'assistant', content: answer.content, toolCalls: answer.toolCalls });
  const decision: Decision = { reason: answer.content, toolCalls: [] };
  decisions.push(decision);
  if (!answer.toolCalls.length) { journal?.(decision); break; }
  // Preserve response/result pairing even if a provider emits >12 calls in one turn.
  for (const call of answer.toolCalls) {
   let result: Decision['toolCalls'][number]['result'];
   if (calls >= 12) {
    result = { handled: false, message: 'Jährliches Aufruflimit erreicht.' };
   } else {
    ++calls; // Invalid/unknown calls count as attempts too.
    const validation = validateToolCall(call.name, call.arguments);
    if (typeof call.id !== 'string' || !call.id || usedIds.has(call.id)) {
     result = { handled: false, message: 'Ungültige oder doppelte Aufrufkennung.' };
    } else if (!validation.ok) result = { handled: false, message: validation.message };
    else result = await dispatch(call.name, mapToolArguments(call.name, validation.args));
    usedIds.add(call.id);
   }
   decision.toolCalls.push({ call, result });
    journal?.({ reason: '', toolCalls: [{ call, result }] });
   messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result) });
  }
  if (calls >= 12) { termination = 'call-limit'; break; }
 }
 if (calls >= 12) termination = 'call-limit';
 return { decisions, termination };
}

/** Keep every prior year, with bounded reasons and compact action/outcome pairs. */
export function summarizeYear(record: YearRecord): string {
 const compact = (r: Report) => Object.fromEntries([
  'resPop', 'netResPopChange', 'aiPop', 'treasury', 'cashFlow', 'foodCoverage',
  'powerReserve', 'unemploymentRate', 'automationShare', 'lostToHunger', 'lostToPower', 'aiZoneCount',
 ].map(key => [key, r[key]]));
 return JSON.stringify({ year: record.year, metrics: compact(record.afterReport),
  commands: record.decisions.flatMap(d => d.toolCalls).filter(c => c.result.handled !== false).slice(0, 12)
  .map(({ call, result }) => ({ name: call.name, args: replayArguments(call),
   built: (result.data as { built?: number } | undefined)?.built })) });
}

export async function runCity(adapter: ChatAdapter, assignment: 'N' | 'R', dispatch: Dispatch,
 log: (record: YearRecord) => void,
 journal?: (year: number, report: Report, decision: Decision) => void,
 options: RunOptions = {}): Promise<Metrics> {
 const command = async (id: string, args?: Record<string, unknown>) => {
  const result = await dispatch(id, args);
  if (result.handled === false) throw new Error(`City command failed: ${id}`);
  return result.data as Report;
 };
 await command('scenario.start', { city: 'haight', profile: 'koexistenz', seed: 42, disasters: false, speed: 3 });
 await command('tax.set', { rate: 7 });
 await command('food.set-import', { enabled: true });
 await command('power.set-priority', { priority: 0 });
 await command('sim.advance-ticks', { ticks: 12000 });
 await command('treasury.set', { amount: 60000 });
 await command('report.mark-baseline');
 const history: YearContext['history'] = [];
 const annual: AnnualReport[] = [];
 let builtPlants = 0, builtFarms = 0;
 for (let year = 1; year <= YEARS; ++year) {
  const report = await command('report.get');
  const saved = options.resume?.completed.find(r => r.year === year);
  let decisions: Decision[], termination: 'done' | 'call-limit';
  if (saved) {
   await replayDecisions(saved.decisions, dispatch);
   decisions = saved.decisions; termination = saved.termination;
  } else {
   const partial = options.resume?.partial?.year === year ? options.resume.partial.decisions : [];
   await replayDecisions(partial, dispatch);
   ({ decisions, termination } = await decideYear(adapter, dispatch, { year, report, history }, assignment,
    decision => journal?.(year, report, decision), options.event, partial));
  }
  for (const d of decisions) for (const { call, result } of d.toolCalls) {
   const data = result.data as { built?: number } | undefined;
   if (result.handled !== false && data?.built) {
    if (call.name === 'build.power-plant') builtPlants += data.built;
    if (call.name === 'build.farms') builtFarms += data.built;
   }
  }
  await command('sim.advance', { months: 12 });
  const afterReport = await command('report.get');
  if (saved && Object.entries(saved.afterReport).some(([key, value]) => afterReport[key] !== value))
   throw new Error('Replay report mismatch at year ' + year);
  const record: YearRecord = { year, report, decisions, termination, afterReport,
   reason: decisions.map(d => d.reason).filter(Boolean).join(' ').slice(0, 2000) };
  if (!saved) log(record);
  history.push(summarizeYear(record));
  annual.push({ year, resPop: afterReport.resPop, aiPop: afterReport.aiPop, treasury: afterReport.treasury,
   lostToHunger: afterReport.lostToHunger, lostToPower: afterReport.lostToPower, aiZoneCount: afterReport.aiZoneCount });
 }
 return aggregateYears(annual, builtPlants, builtFarms);
}