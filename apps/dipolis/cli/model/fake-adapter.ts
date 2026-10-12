import type { ChatAdapter, ChatRequest, ChatResponse, ToolCall } from './adapter';
import type { YearContext } from './runner';

/** S266's decisions, not its outcomes; no model endpoint or credentials are used. */
export class S266Adapter implements ChatAdapter {
 readonly model = 'fake-s266';
 /** Optional artificial latency per request, e.g. to exercise live viewers. */
 constructor(private readonly delayMs = 0) {}
 async chat(request: ChatRequest): Promise<ChatResponse> {
  if (this.delayMs > 0) await new Promise<void>((resolve, reject) => {
   const signal = request.signal;
   const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(signal?.reason); };
   const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, this.delayMs);
   signal?.addEventListener('abort', onAbort, { once: true });
   if (signal?.aborted) onAbort();
  });
  request.signal?.throwIfAborted();
  const last = request.messages.at(-1);
  if (last?.role === 'tool') return { content: 'Die Maßnahmen für dieses Jahr sind abgeschlossen.', toolCalls: [] };
  const user = request.messages.find(m => m.role === 'user');
  if (!user) throw new Error('Missing year context');
  const { year, report } = JSON.parse(user.content) as YearContext;
  const calls: ToolCall[] = [];
  const call = (name: string, args: Record<string, unknown>) => calls.push({
   id: `year${year}-call${calls.length + 1}`, name, arguments: args,
  });
  call('tax.set', { rate: 7 });
  call('welfare.set-level', { level: 1 });
  call('power.set-priority', { priority: 0 });
    call('budget.set-funding', { roadFundingPercent: 100, policeFundingPercent: 70, fireFundingPercent: 70 });
  call('food.set-import', { enabled: true });
  if (year === 1) call('build.farms', { count: 10 });
  if (report.cashFlow < 0) call('build.ai-zones', { count: 30 });
  if (report.powerReserve < 0.1) call('build.power-plant', { type: 'coal' });
  return { content: 'Ich übernehme die festen Haushalts- und Versorgungswerte. Die Baumaßnahmen folgen den festgelegten jährlichen Bedingungen.', toolCalls: calls };
 }
}