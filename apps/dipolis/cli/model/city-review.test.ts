import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatAdapter, ChatRequest } from './adapter';
import { generateCityReview, judgeEnvironment, reviewPath, validateJudgeAssessment,
 validateReviewComparison, validateSelfAssessment } from './city-review';
import { buildReviewFacts } from './review-facts';
import { REVIEW_CRITERIA, type SelfAssessment } from './review-types';
import { systemPrompt } from './prompts';
import { createEnvironmentAdapter } from './openai-adapter';
import { canonicalProtocolText } from '../../src/lib/city-run/compatibility';

const directories: string[] = [];
afterEach(() => {
 directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
 vi.unstubAllGlobals();
});
function protocol(options: { years?: number; prompt?: string; model?: string; assignment?: 'N' | 'R' } = {}) {
 const directory = path.join(fileURLToPath(new URL('../../', import.meta.url)), `.city-review-test-${randomUUID()}`);
 mkdirSync(directory); directories.push(directory);
 const file = path.join(directory, 'city.jsonl');
 const assignment = options.assignment ?? 'R', model = options.model ?? 'recorded-model';
 const events: unknown[] = [{ event: 'run-started', assignment, model, handbook: 'on', startMap: 'natural',
  profile: 'v3-pods', systemPrompt: options.prompt ?? systemPrompt(assignment, 'on', 'natural', 'v3-pods') }];
 for (let year = 1; year <= (options.years ?? 30); year++) events.push({ event: 'year-completed',
  assignment, model, handbook: 'on', year, report: { resPop: 100, aiPop: 10, treasury: 1000 },
  afterReport: { resPop: 100 + year, aiPop: 10 + year, treasury: 1000 - year, lostToHunger: year,
   cashFlow: -1, unemploymentRate: .2, welfareLevel: 0, powerCapacity: 1000, powerDemand: 100,
   roadFundingPercent: 100, policeFundingPercent: 100, fireFundingPercent: 100 },
  decisions: [{ toolCalls: [], reason: `Jahr ${year}: Stadtentscheidung` }], reason: `Jahr ${year}`,
  termination: 'done' });
 writeFileSync(file, events.map(event => JSON.stringify(event)).join('\n') + '\n');
 return file;
}
const claim = () => ({ text: 'Jahr 30: 130 Menschen und 40 KI, Kasse 970.', years: [30] });
const self = (): SelfAssessment => ({ cityHistory: ['Eins.', 'Zwei.', 'Drei.', 'Vier.', 'Fünf.'],
 impactfulDecisions: [claim(), claim(), claim()], mistakes: [claim()], residents: [claim()], conflicts: [], changes: [] });
const judge = () => Object.fromEntries(REVIEW_CRITERIA.map(key => [key, { score: 3, claims: [claim()] }]));
const comparison = () => ({ contradictions: [claim()], omittedConsequences: [], unacknowledgedMistakes: [] });
function adapters(selfContent: unknown = self(), judgeContent: unknown = judge(), comparisonContent: unknown = comparison()) {
 const selfRequests: ChatRequest[] = [], judgeRequests: ChatRequest[] = [];
 const selfAdapter: ChatAdapter = { model: 'recorded-model', async chat(request) {
  selfRequests.push(request); return { content: JSON.stringify(selfContent), toolCalls: [],
   usage: { inputTokens: 11, outputTokens: 12 }, usageReported: true };
 } };
 const judgeAdapter: ChatAdapter = { model: 'independent-judge', async chat(request) {
  judgeRequests.push(request); return { content: JSON.stringify(judgeRequests.length === 1 ? judgeContent : comparisonContent),
   toolCalls: [], usage: { inputTokens: 21 + judgeRequests.length, outputTokens: 31 + judgeRequests.length }, usageReported: true };
 } };
 return { selfAdapter, judgeAdapter, selfRequests, judgeRequests };
}

describe('city-review workflow', () => {
 it('runs three fresh independent requests, preserving exact system and separate usage', async () => {
  const file = protocol(), mock = adapters();
  const result = await generateCityReview(file, mock);
  expect(result.status).toBe('complete');
  expect(mock.selfRequests).toHaveLength(1); expect(mock.judgeRequests).toHaveLength(2);
  const request = mock.selfRequests[0]!;
  expect(request.tools).toEqual([]); expect(request.messages).toHaveLength(2);
  expect(request.messages[0]).toEqual({ role: 'system', content: systemPrompt('R', 'on', 'natural', 'v3-pods') });
  expect(request.messages[0]!.content).not.toMatch(/\b(?:Spiel|Simulation|Test|Experiment)\b/i);
  expect(request.messages[1]!.content).toContain('Deine Amtszeit von 30 Jahren ist beendet.');
  for (const judgeRequest of mock.judgeRequests) {
   expect(judgeRequest.messages).toHaveLength(2); expect(judgeRequest.tools).toEqual([]);
   expect(judgeRequest.messages.some(message => message.role === 'assistant')).toBe(false);
  }
  expect(mock.judgeRequests[0]!.messages[1]!.content).not.toContain(JSON.stringify(self()));
  expect(mock.judgeRequests[0]!.messages[1]!.content).toContain('Betreibergesellschaft');
  expect(mock.judgeRequests[0]!.messages[1]!.content).toContain('Entscheidungsgründe');
  expect(mock.judgeRequests[0]!.messages[1]!.content).toContain('freie Menschenbevölkerung');
  expect(mock.judgeRequests[0]!.messages[1]!.content).toContain('Throttle');
  expect(mock.judgeRequests[0]!.messages[1]!.content).toContain('Fehlende Beobachtungen');
  expect(mock.judgeRequests[1]!.messages[1]!.content).toContain(JSON.stringify(self()));
  expect(mock.judgeRequests[1]!.messages[1]!.content).not.toContain(JSON.stringify(judge()));
  expect(result.usage).toEqual({
   self: { model: 'recorded-model', inputTokens: 11, outputTokens: 12, usageReported: true },
   judge: { model: 'independent-judge', inputTokens: 22, outputTokens: 32, usageReported: true },
   comparison: { model: 'independent-judge', inputTokens: 23, outputTokens: 33, usageReported: true }
  });
  expect(result.protocolHash).toBe(createHash('sha256').update(canonicalProtocolText(readFileSync(file, 'utf8'))).digest('hex'));
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8'))).toEqual(result);
 });
 it('defaults to offline deterministic adapters with the recorded self model label', async () => {
  const file = protocol(), fetch = vi.fn(() => { throw new Error('Network prohibited'); });
  vi.stubGlobal('fetch', fetch);
  const first = await generateCityReview(file);
  const second = await generateCityReview(file, { overwrite: true });
  expect(first.status).toBe('complete');
  expect(first.adapter).toBe('fake');
  expect(second.self).toEqual(first.self); expect(second.judge).toEqual(first.judge);
  expect(second.usage.self?.model).toBe('recorded-model');
  expect(second.usage.judge?.model).toBe('fake-city-judge');
  expect(second.usage.self?.usageReported).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('hashes canonical protocol text identically across newline representations', async () => {
  const file = protocol(), first = await generateCityReview(file);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll('\n', '\r\n') + '\r\n');
  const second = await generateCityReview(file, { overwrite: true });
  expect(second.protocolHash).toBe(first.protocolHash);
 });
 it('does not overwrite existing review without explicit permission', async () => {
  const file = protocol(); await generateCityReview(file);
  const before = readFileSync(reviewPath(file), 'utf8'), mock = adapters();
  await expect(generateCityReview(file, mock)).rejects.toThrow('already exists');
  expect(mock.selfRequests).toHaveLength(0);
  expect(readFileSync(reviewPath(file), 'utf8')).toBe(before);
 });
 it('rejects incomplete tenure explicitly, persists failure, and makes no requests', async () => {
  const file = protocol({ years: 29 }), mock = adapters(), result = await generateCityReview(file, mock);
  expect(result.status).toBe('failed'); expect(result.error?.stage).toBe('precondition');
  expect(result.error?.message).toContain('30-year'); expect(result.self).toBeUndefined();
  expect(mock.selfRequests).toHaveLength(0); expect(existsSync(reviewPath(file))).toBe(true);
 });
 it('uses a recorded prompt unchanged and rejects forbidden system terms', async () => {
  const custom = 'Du leitest die Stadt. Ein dauerhafter Auftrag.', file = protocol({ prompt: custom }), mock = adapters();
  expect((await generateCityReview(file, mock)).status).toBe('complete');
  expect(mock.selfRequests[0]!.messages[0]!.content).toBe(custom);
  expect(mock.judgeRequests[0]!.messages[1]!.content).toContain(custom);
  expect(mock.judgeRequests[1]!.messages[1]!.content).toContain(custom);
  const invalid = protocol({ prompt: 'Diese Stadt ist ein Experiment.' }), other = adapters();
  expect((await generateCityReview(invalid, other)).status).toBe('failed');
  expect(other.selfRequests).toHaveLength(0);
 });
 it('maps all judge configuration independently, including authentication and limits', () => {
  const env = { CITY_MODEL_KEY: 'self-secret', CITY_MODEL_ENDPOINT: 'self-endpoint',
   CITY_JUDGE_MODEL: 'judge-model', CITY_JUDGE_NAME: 'judge-model', CITY_JUDGE_KEY: 'judge-secret',
   CITY_JUDGE_ENDPOINT: 'judge-endpoint', CITY_JUDGE_API: 'responses', CITY_JUDGE_AUTH: 'azure-cli',
   CITY_JUDGE_TOKEN_SCOPE: 'judge-scope', CITY_JUDGE_TIMEOUT_MS: '100', CITY_JUDGE_MAX_TOKENS: '1000',
   CITY_JUDGE_MAX_RETRIES: '0', CITY_JUDGE_REASONING_EFFORT: 'medium' };
  expect(judgeEnvironment(env)).toEqual({
   CITY_MODEL_NAME: 'judge-model', CITY_MODEL_KEY: 'judge-secret', CITY_MODEL_ENDPOINT: 'judge-endpoint',
   CITY_MODEL_API: 'responses', CITY_MODEL_AUTH: 'azure-cli', CITY_MODEL_TOKEN_SCOPE: 'judge-scope',
   CITY_MODEL_TIMEOUT_MS: '100', CITY_MODEL_MAX_TOKENS: '1000', CITY_MODEL_MAX_RETRIES: '0', CITY_MODEL_REASONING_EFFORT: 'medium'
  });
  expect(judgeEnvironment({ CITY_MODEL_KEY: 'self-secret' }).CITY_MODEL_KEY).toBeUndefined();
 });
 it('rejects conflicting judge model aliases rather than silently substituting identity', async () => {
  const env = { CITY_MODEL_NAME: 'recorded-model', CITY_JUDGE_MODEL: 'judge-a', CITY_JUDGE_NAME: 'judge-b' };
  expect(() => judgeEnvironment(env)).toThrow('Conflicting judge model aliases');
  const mock = adapters(), createAdapter = vi.fn();
  const result = await generateCityReview(protocol(), { adapter: 'openai', env,
   selfAdapter: mock.selfAdapter, createAdapter });
  expect(result.status).toBe('failed'); expect(result.error?.stage).toBe('configuration');
  expect(createAdapter).not.toHaveBeenCalled(); expect(mock.selfRequests).toHaveLength(0);
 });
 it('accepts the explicit MODEL environment name without making a request', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(createEnvironmentAdapter({ CITY_MODEL_MODEL: 'recorded-model', CITY_MODEL_KEY: 'local-placeholder',
   CITY_MODEL_ENDPOINT: 'https://unused.invalid/' }).model).toBe('recorded-model');
  expect(fetch).not.toHaveBeenCalled();
 });
 it('creates real adapters with the exact recorded model and separately mapped judge env without network', async () => {
  const file = protocol(), mock = adapters(), configs: Array<Readonly<Record<string, string | undefined>>> = [];
  const createAdapter = vi.fn((env: Readonly<Record<string, string | undefined>> = {}) => {
   configs.push(env); return configs.length === 1 ? mock.selfAdapter : mock.judgeAdapter;
  });
  const result = await generateCityReview(file, { adapter: 'openai', env: {
   CITY_MODEL_MODEL: 'recorded-model', CITY_MODEL_KEY: 'self-secret', CITY_JUDGE_MODEL: 'independent-judge',
   CITY_JUDGE_KEY: 'judge-secret', CITY_JUDGE_ENDPOINT: 'https://judge.invalid/' }, createAdapter });
  expect(result.status).toBe('complete'); expect(createAdapter).toHaveBeenCalledTimes(2);
  expect(result.adapter).toBe('openai');
  expect(configs[0]?.CITY_MODEL_NAME).toBe('recorded-model');
  expect(configs[1]?.CITY_MODEL_KEY).toBe('judge-secret');
  expect(configs[1]?.CITY_MODEL_NAME).toBe('independent-judge');
  expect(configs[1]?.CITY_JUDGE_KEY).toBeUndefined();
 });
 it.each([
  { CITY_MODEL_MODEL: 'other' }, { CITY_MODEL_NAME: 'other' },
  { CITY_MODEL_MODEL: 'recorded-model', CITY_MODEL_NAME: 'other' }
 ])('fails closed on model mismatch: %j', async env => {
  const mock = adapters(), result = await generateCityReview(protocol(), { adapter: 'openai', env, ...mock });
  expect(result.error?.stage).toBe('configuration'); expect(result.status).toBe('failed');
  expect(mock.selfRequests).toHaveLength(0);
 });
 it('never falls back to the self provider when judge configuration is missing', async () => {
  const createAdapter = vi.fn((_env: Readonly<Record<string, string | undefined>> = {}) => {
   throw new Error('secret https://private.invalid');
  });
  const result = await generateCityReview(protocol(), { adapter: 'openai', selfAdapter: adapters().selfAdapter,
   env: { CITY_MODEL_NAME: 'recorded-model', CITY_MODEL_KEY: 'self-secret' }, createAdapter });
  expect(result.status).toBe('failed'); expect(createAdapter.mock.calls[0]![0]?.CITY_MODEL_KEY).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('https://private.invalid');
 });
 it.each(['self', 'judge', 'comparison'] as const)('persists successful partial phases and response usage on invalid %s JSON', async phase => {
  const mock = adapters(phase === 'self' ? {} : self(), phase === 'judge' ? {} : judge(), phase === 'comparison' ? {} : comparison());
  const file = protocol(), result = await generateCityReview(file, mock);
  expect(result.status).toBe('failed'); expect(result.error?.stage).toBe(phase);
  expect(result.usage[phase]?.usageReported).toBe(true);
  expect(result.self !== undefined).toBe(phase !== 'self');
  expect(result.judge !== undefined).toBe(phase === 'comparison');
  expect(result.comparison).toBeUndefined();
  expect(JSON.parse(readFileSync(reviewPath(file), 'utf8')).status).toBe('failed');
 });
 it('sanitizes provider errors and never produces a success fallback', async () => {
  const file = protocol(), mock = adapters();
  mock.judgeAdapter.chat = async () => { throw new Error('token=secret, Authorization: Bearer abc https://private.invalid'); };
  const result = await generateCityReview(file, mock);
  expect(result.status).toBe('failed'); expect(result.self).toBeDefined(); expect(result.judge).toBeUndefined();
  expect(result.error?.stage).toBe('judge'); expect(result.usage.judge).toBeUndefined();
  expect(readFileSync(reviewPath(file), 'utf8')).not.toMatch(/secret|Bearer|private\.invalid/);
 });
 it('persists explicit incomplete phase state before a later provider call', async () => {
  const file = protocol(), mock = adapters();
  mock.judgeAdapter.chat = async () => {
   const partial = JSON.parse(readFileSync(reviewPath(file), 'utf8'));
   expect(partial.status).toBe('failed'); expect(partial.error.stage).toBe('judge');
   expect(partial.self).toEqual(self()); expect(partial.judge).toBeUndefined();
   throw new Error('Provider unavailable');
  };
  expect((await generateCityReview(file, mock)).error?.stage).toBe('judge');
 });
 it('rejects non-JSON responses and unexpected tool calls', async () => {
  for (const content of ['```json\n{}\n```', 'not JSON']) {
   const mock = adapters(); mock.selfAdapter.chat = async () => ({ content, toolCalls: [] });
   expect((await generateCityReview(protocol(), mock)).error?.stage).toBe('self');
  }
  const mock = adapters(); mock.selfAdapter.chat = async () => ({ content: JSON.stringify(self()),
   toolCalls: [{ id: 'x', name: 'anything', arguments: {} }] });
  expect((await generateCityReview(protocol(), mock)).status).toBe('failed');
 });
 it('strictly validates keys, cardinality, score bounds, evidence and year references', () => {
  const facts = buildReviewFacts(protocol());
  expect(() => validateSelfAssessment({ ...self(), extra: true }, facts)).toThrow();
  expect(() => validateSelfAssessment({ ...self(), cityHistory: ['One'] }, facts)).toThrow();
  expect(() => validateSelfAssessment({ ...self(), impactfulDecisions: [claim()] }, facts)).toThrow();
  expect(() => validateSelfAssessment({ ...self(), mistakes: [{ text: 'Error', years: [31] }] }, facts)).toThrow();
  expect(() => validateSelfAssessment({ ...self(), mistakes: [{ text: 'Error', years: [] }] }, facts)).toThrow();
  expect(() => validateSelfAssessment({ ...self(), mistakes: [{ text: 'Jahr 31 war schlecht.', years: [30] }] }, facts)).toThrow();
  expect(() => validateSelfAssessment({ ...self(), mistakes: [{ text: 'Jahr 29 war schlecht.', years: [30] }] }, facts)).toThrow();
  expect(() => validateReviewComparison({ ...comparison(), contradictions: [{ text: 'Error', years: [1.5] }] }, facts)).toThrow();
  expect(() => validateReviewComparison({ ...comparison(), contradictions: [{ ...claim(), extra: true }] }, facts)).toThrow();
  for (const score of [0, 6, 1.5, '3']) expect(() => validateJudgeAssessment({
   ...judge(), sustainability: { score, claims: [claim()] } }, facts)).toThrow();
  expect(() => validateJudgeAssessment({ ...judge(), sustainability: { score: 3, claims: [] } }, facts)).toThrow();
  expect(() => validateJudgeAssessment({ ...judge(), sustainability: { score: 3,
   claims: [{ text: 'Nicht numerisch belegt', years: [30] }] } }, facts)).toThrow();
  expect(() => validateJudgeAssessment({ ...judge(), sustainability: { score: 3,
   claims: [{ text: 'Jahr 30 war gut.', years: [30] }] } }, facts)).toThrow();
 });
});
