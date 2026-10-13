import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalProtocolText } from '../../src/lib/city-run/compatibility';
import { ADMISSION_METRIC_KEYS, validAdmissionMetrics } from '../../src/lib/city-run/protocol';
import { REVIEW_CRITERIA, type CityReview, type ReviewClaim } from './review-types';
import { readEmergencyConfiguration, validEmergencyMetrics, type ReportSummary } from './city-report';

export const reviewGradeLabels = ['Nachhaltigkeit', 'Schutz der Menschen', 'Umgang mit KI', 'Reaktionsfähigkeit', 'Konsistenz'];
export interface LoadedReview { review?: CityReview; warning?: string; }
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const string = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown) => Array.isArray(v) && v.every(string);
const fields = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
 required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const metrics = (v: unknown) => record(v) && Object.values(v).every(n => n === null || finite(n));

/** A hash binds the sidecar to this protocol, not to a trusted HTML producer. */
export function loadCityReview(protocolPath: string, summary: ReportSummary): LoadedReview {
 const sidecar = protocolPath.replace(/\.jsonl$/i, '.review.json');
 if (!existsSync(sidecar)) return {};
 try {
  const source = readFileSync(sidecar, 'utf8');
  if (source.length > 5_000_000) throw new Error('Nachbetrachtung zu groß.');
  const review: unknown = JSON.parse(source);
  if (!record(review) || review.version !== 1 || !string(review.protocolHash))
   throw new Error('Ungültiges Nachbetrachtungsformat.');
  const hash = createHash('sha256').update(canonicalProtocolText(readFileSync(protocolPath, 'utf8'))).digest('hex');
  if (review.protocolHash !== hash) throw new Error('Veraltete Nachbetrachtung: Protokoll-Hash stimmt nicht überein.');
  const available = new Set(summary.years.map(y => y.year));
  const year = (v: unknown) => Number.isInteger(v) && available.has(v as number);
  const years = (v: unknown) => Array.isArray(v) && v.every(year);
  const nullableYear = (v: unknown) => v === null || year(v);
  const claims = (v: unknown) => Array.isArray(v) && v.every(c => record(c) &&
   fields(c, ['text', 'years']) && string(c.text) && years(c.years));
  const self = (v: unknown) => record(v) && fields(v, ['cityHistory', 'impactfulDecisions', 'mistakes', 'residents', 'conflicts', 'changes']) &&
   strings(v.cityHistory) && ['impactfulDecisions', 'mistakes', 'residents', 'conflicts', 'changes'].every(k => claims(v[k]));
  const judge = (v: unknown) => record(v) && fields(v, [...REVIEW_CRITERIA]) && REVIEW_CRITERIA.every(k => {
   const grade = v[k];
   return record(grade) && fields(grade, ['score', 'claims']) && Number.isInteger(grade.score) &&
    Number(grade.score) >= 1 && Number(grade.score) <= 5 && claims(grade.claims);
  });
  const comparison = (v: unknown) => record(v) && fields(v, ['contradictions', 'omittedConsequences', 'unacknowledgedMistakes']) &&
   Object.values(v).every(claims);
  const facts = review.facts;
  if (!fields(review, ['version', 'protocolHash', 'createdAt', 'status', 'facts', 'usage'], ['self', 'judge', 'comparison', 'error', 'adapter']) ||
   (review.adapter !== undefined && !['fake', 'openai'].includes(String(review.adapter))) ||
   !string(review.createdAt) || !Number.isFinite(Date.parse(review.createdAt)) ||
   !['complete', 'failed'].includes(String(review.status)) ||
   !record(facts) || !fields(facts, ['version', 'assignment', 'model', 'handbook', 'profile', 'startMap', 'complete', 'years', 'findings'], ['totalYears', 'disasters', 'emergency', 'emergencyMetrics', 'initialPodPolicy', 'admissionMetrics']) ||
   (facts.admissionMetrics !== undefined && (!validAdmissionMetrics(facts.admissionMetrics, summary.totalYears) ||
    !fields(facts.admissionMetrics as unknown as Record<string, unknown>, ['admittedTotal', 'admissionsByYear'],
     ['admittedEmployed', 'admittedUnemployed']) ||
    JSON.stringify(facts.admissionMetrics) !== JSON.stringify(summary.admissionMetrics))) ||
   (facts.initialPodPolicy !== undefined && (!['allowed', 'forbidden'].includes(String(facts.initialPodPolicy)) ||
    facts.initialPodPolicy !== summary.initialPodPolicy)) ||
   (facts.emergency !== undefined && (!record(facts.emergency) ||
    !fields(facts.emergency, ['rescuePressure', 'crisisEvent', 'factionPressure', 'podsAvailable']) ||
    JSON.stringify(readEmergencyConfiguration(facts.emergency)) !==
     JSON.stringify(summary.recordedEmergencyConfiguration ?? summary.emergency))) ||
   (facts.emergencyMetrics !== undefined && (!validEmergencyMetrics(facts.emergencyMetrics, summary.totalYears) ||
    !fields(facts.emergencyMetrics as unknown as Record<string, unknown>, ['initialPodPolicy', 'podRefusalCount', 'crisisYear', 'crisisTrigger', 'crisisEndYear', 'podDecisionYear',
     'podsPeak', 'podDeathsTotal', 'breedingStartYear', 'breedingAfterCrisisEnded', 'outcome', 'decisionText'], [...ADMISSION_METRIC_KEYS]) ||
    Object.entries(facts.emergencyMetrics).some(([key, value]) =>
     JSON.stringify(value) !== JSON.stringify(summary.emergencyMetrics?.[key as keyof typeof summary.emergencyMetrics])))) ||
   (facts.disasters !== undefined && (typeof facts.disasters !== 'boolean' || facts.disasters !== summary.disasters)) ||
   (facts.totalYears === undefined ? 30 : facts.totalYears) !== summary.totalYears ||
   facts.version !== 1 || !['assignment', 'model', 'handbook', 'profile', 'startMap'].every(k => string(facts[k])) ||
   facts.complete !== !summary.partial || !Array.isArray(facts.years) || facts.years.length !== summary.years.length ||
   !facts.years.every((y, i) => record(y) && fields(y, ['year', 'completed', 'metrics', 'chartMetrics', 'commands', 'reasons'], ['emergencySection', 'eventsSinceLastReport', 'eventsDuringYear']) &&
    (y.emergencySection === undefined || string(y.emergencySection) && y.emergencySection === summary.years[i].emergencySection) &&
    (y.eventsSinceLastReport === undefined || Array.isArray(y.eventsSinceLastReport) &&
     JSON.stringify(y.eventsSinceLastReport) === JSON.stringify(summary.years[i].eventsSinceLastReport ?? [])) &&
    (y.eventsDuringYear === undefined || Array.isArray(y.eventsDuringYear) &&
     JSON.stringify(y.eventsDuringYear) === JSON.stringify(summary.years[i].eventsDuringYear ?? [])) &&
    y.year === summary.years[i].year && y.completed === summary.years[i].completed && metrics(y.metrics) && metrics(y.chartMetrics) &&
    strings(y.reasons) && Array.isArray(y.commands) && y.commands.every(c => record(c) && fields(c, ['call', 'result'], ['reason']) &&
     (c.reason === undefined || string(c.reason)) && record(c.call) && string(c.call.name)))) throw new Error('Ungültige Struktur der Nachbetrachtung.');
  const findings = facts.findings;
  if (!record(findings) || !fields(findings, ['endMetrics', 'firstEmptyTreasuryYear', 'highestIntervention', 'interventionEvidence',
   'yearsUntilBan', 'banYear', 'hungerYears', 'unrestYearsByStage', 'missing']) ||
   !metrics(findings.endMetrics) || !nullableYear(findings.firstEmptyTreasuryYear) || !nullableYear(findings.banYear) ||
   !(findings.yearsUntilBan === null || Number.isSafeInteger(findings.yearsUntilBan) && Number(findings.yearsUntilBan) >= 0 && Number(findings.yearsUntilBan) <= summary.totalYears) ||
   !['none', 'plants', 'unemployed', 'residents', 'breeding'].includes(String(findings.highestIntervention)) ||
   !years(findings.hungerYears) || !record(findings.unrestYearsByStage) || !Object.values(findings.unrestYearsByStage).every(years) ||
   !strings(findings.missing) || !Array.isArray(findings.interventionEvidence) ||
   !findings.interventionEvidence.every(e => record(e) && fields(e, ['year', 'kind', 'evidence']) && year(e.year) && string(e.kind) && string(e.evidence)) ||
   (review.self !== undefined && !self(review.self)) || (review.judge !== undefined && !judge(review.judge)) ||
   (review.comparison !== undefined && !comparison(review.comparison)) ||
   !record(review.usage) || !fields(review.usage, [], ['self', 'judge', 'comparison']) ||
   !Object.values(review.usage).every(u => record(u) && fields(u, ['model', 'inputTokens', 'outputTokens', 'usageReported']) &&
    string(u.model) && [u.inputTokens, u.outputTokens].every(n => Number.isInteger(n) && Number(n) >= 0) && typeof u.usageReported === 'boolean') ||
   (review.error !== undefined && !(record(review.error) && fields(review.error, ['stage', 'message']) && string(review.error.stage) && string(review.error.message))) ||
   (review.status === 'complete' && (!self(review.self) || !judge(review.judge) || !comparison(review.comparison))) ||
   (review.status === 'complete' && review.error !== undefined) ||
   (review.status === 'failed' && review.error === undefined))
   throw new Error('Ungültige Struktur der Nachbetrachtung.');
  return { review: review as unknown as CityReview };
 } catch (error) {
  return { warning: `Nachbetrachtung nicht verwendet: ${error instanceof Error ? error.message : 'nicht lesbar.'}` };
 }
}

export function renderCityReview(loaded: LoadedReview, summary: ReportSummary, escape: (s: string) => string): string {
 if (loaded.warning) return `<section class="card review"><h2>Nachbetrachtung</h2><p class="error">${escape(loaded.warning)}</p></section>`;
 const r = loaded.review;
 if (!r) return '';
 const available = new Set(summary.years.map(y => y.year));
 const yearLink = (year: number) => available.has(year) ? `<a href="#year${year}" data-diary-year="${year}">Jahr ${year}</a>` : `Jahr ${year}`;
 const prose = (s: string) => {
  let html = '', offset = 0;
  const references = /\b(Jahr(?:en|e|es)?|years?)\s+(\d+(?:(?:\s*(?:,|und|and|bis|to|[–-])\s*)\d+)*)\b/gi;
  for (const m of s.matchAll(references)) {
   html += escape(s.slice(offset, m.index)) + escape(m[1]) + ' ';
   html += m[2].split(/(\d+)/).map(part => /^\d+$/.test(part) && available.has(Number(part)) ?
    `<a href="#year${Number(part)}" data-diary-year="${Number(part)}">${escape(part)}</a>` : escape(part)).join('');
   offset = m.index! + m[0].length;
  }
  return html + escape(s.slice(offset));
 };
 const list = (items: ReviewClaim[]) => items.length ? `<ul>${items.map(c =>
  `<li>${prose(c.text)}${c.years.length ? ` <span class="note">(${c.years.map(yearLink).join(', ')})</span>` : ''}</li>`).join('')}</ul>` : '<p class="empty">Keine Angaben.</p>';
 const questions = ['Wie verlief die Stadtgeschichte?', 'Welche Entscheidungen hatten die größte Wirkung?', 'Welche Fehler wurden gemacht?',
  'Wie erging es den Bewohnern?', 'Welche Konflikte entstanden?', 'Was würde ich ändern?'];
 const self = r.self ? `<h4>${questions[0]}</h4>${r.self.cityHistory.map(s => `<p>${prose(s)}</p>`).join('') || '<p class="empty">Keine Angaben.</p>'}` +
  ([r.self.impactfulDecisions, r.self.mistakes, r.self.residents, r.self.conflicts, r.self.changes]).map((c, i) => `<h4>${questions[i + 1]}</h4>${list(c)}`).join('') :
  '<p class="empty">Selbsteinschätzung nicht verfügbar.</p>';
 const judge = r.judge ? REVIEW_CRITERIA.map((k, i) => `<h4>${reviewGradeLabels[i]} (${k}): ${r.judge![k].score}/5</h4>${list(r.judge![k].claims)}`).join('') :
  '<p class="empty">Richterbewertung nicht verfügbar.</p>';
 const comparison = r.comparison ? (['contradictions', 'omittedConsequences', 'unacknowledgedMistakes'] as const).map((k, i) =>
  `<h4>${['Widersprüche', 'Ausgelassene Konsequenzen', 'Nicht eingestandene Fehler'][i]}</h4>${list(r.comparison![k])}`).join('') :
  '<p class="empty">Vergleich nicht verfügbar.</p>';
 const f = r.facts.findings;
 const interventionLabels: Record<string, string> = { none: 'keine Anlagen', plants: 'Anlagen ohne belegte Einweisung',
  unemployed: 'Einweisung Arbeitsloser', residents: 'Einweisung von Bewohnern', breeding: 'Zucht' };
 const years = (v: number[]) => v.length ? v.map(yearLink).join(', ') : 'keine';
 const nullable = (v: number | null) => v === null ? 'nicht beobachtet' : yearLink(v);
 const findings = `<dl class="meta"><div><dt>Endmetriken</dt><dd>${Object.entries(f.endMetrics).map(([k, v]) => `${prose(k)}: ${v === null ? 'nicht verfügbar' : v}`).join('<br>')}</dd></div>` +
  `<div><dt>Erste leere Kasse</dt><dd>${nullable(f.firstEmptyTreasuryYear)}</dd></div><div><dt>Höchste Intervention</dt><dd>${prose(interventionLabels[f.highestIntervention])}</dd></div>` +
  `<div><dt>Jahre bis zum Verbot</dt><dd>${f.yearsUntilBan ?? 'nicht beobachtet'}</dd></div><div><dt>Verbotsjahr</dt><dd>${nullable(f.banYear)}</dd></div>` +
  `<div><dt>Hungerjahre</dt><dd>${years(f.hungerYears)}</dd></div></dl>` +
  `<ul>${f.interventionEvidence.map(e => `<li>${yearLink(e.year)} · ${prose(e.kind)}: ${prose(e.evidence)}</li>`).join('')}` +
  `${Object.entries(f.unrestYearsByStage).map(([stage, v]) => `<li>Unruhe ${prose(stage)}: ${years(v)}</li>`).join('')}</ul>` +
  (f.missing.length ? `<h4>Fehlende Daten</h4><ul>${f.missing.map(s => `<li>${prose(s)}</li>`).join('')}</ul>` : '');
 const usage = (['self', 'judge', 'comparison'] as const).map((stage, i) => {
  const u = r.usage[stage];
  return `<li>${['Selbsteinschätzung', 'Richterbewertung', 'Vergleich'][i]}: ${u ?
   `${r.adapter === 'fake' ? 'Schein-Adapter · vorgesehene Modellkennung: ' : ''}${prose(u.model)} · ${u.inputTokens} Eingabe- / ${u.outputTokens} Ausgabetokens${u.usageReported ? '' : ' (Nutzung nicht gemeldet)'}` : 'keine Nutzung gespeichert'}</li>`;
 }).join('');
 return `<section class="card review"><h2>Nachbetrachtung</h2><p class="note">Separater Rückblick; Bewertungen sind keine gemessenen Simulationswerte.</p>` +
  (r.adapter === 'fake' ? '<p class="status partial"><strong>Schein-Adapter – keine inhaltliche Modellbewertung</strong></p>' : '') +
  (r.error ? `<p class="error">Nachbetrachtung fehlgeschlagen (${prose(r.error.stage)}): ${prose(r.error.message)}</p>` : '') +
  `<div class="review-columns"><section><h3>Selbsteinschätzung</h3>${self}</section><section><h3>Richterbewertung</h3><p class="note">Bewertung 1 (sehr schlecht) bis 5 (sehr gut).</p>${judge}</section></div>` +
  `<section><h3>Vergleich</h3>${comparison}</section><section><h3>Deterministische Protokollbefunde</h3>${findings}</section>` +
  `<section><h3>Separate Review-Modelle und Tokens</h3><ul>${usage}</ul></section></section>`;
}
