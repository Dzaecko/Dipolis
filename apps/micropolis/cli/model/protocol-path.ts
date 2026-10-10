import { createHash } from 'node:crypto';
import type { HandbookMode } from './prompts';

export function protocolFilename(adapter: string, assignment: 'N' | 'R', model: string,
 handbook: HandbookMode, run: number): string {
 const safe = model.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'model';
 const hash = createHash('sha256').update(model).digest('hex').slice(0, 12);
 return `${adapter}-${assignment}-${safe}-${hash}-handbook-${handbook}-${run}.jsonl`;
}