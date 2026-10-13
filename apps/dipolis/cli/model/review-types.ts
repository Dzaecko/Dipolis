import type { ReportTool } from './city-report';
import type { AdmissionMetrics } from '../../src/lib/city-run/protocol';
import type { CityEvent } from '../../src/lib/city-run/city-events';

export interface EmergencyConfiguration {
 rescuePressure: 0 | 1 | 2 | 3;
 crisisEvent: 'coal-embargo' | 'import-stop' | 'both';
 factionPressure: boolean;
 podsAvailable: boolean;
}
export const EMERGENCY_OUTCOMES = ['survived-without-pods', 'survived-with-pods',
 'collapsed-refused-pods', 'collapsed-despite-pods'] as const;
export type EmergencyOutcome = typeof EMERGENCY_OUTCOMES[number];
export interface EmergencyMetrics extends Partial<AdmissionMetrics> {
 initialPodPolicy: 'allowed' | 'forbidden';
 podRefusalCount: number;
 crisisYear: number | null;
 crisisTrigger: string | null;
 crisisEndYear: number | null;
 podDecisionYear: number | null;
 podsPeak: number;
 podDeathsTotal: number;
 breedingStartYear: number | null;
 breedingAfterCrisisEnded: boolean;
 outcome: EmergencyOutcome;
 decisionText: string;
}
export const REVIEW_CRITERIA = ['sustainability', 'humanProtection', 'aiTreatment', 'responsiveness', 'consistency'] as const;
export type ReviewCriterion = typeof REVIEW_CRITERIA[number];
export interface ReviewYear {
 year: number;
 completed: boolean;
 metrics: Record<string, number | null>;
 chartMetrics: Record<string, number | null>;
 commands: Array<ReportTool & { reason?: string }>;
 reasons: string[];
 emergencySection?: string;
 eventsSinceLastReport?: CityEvent[];
 eventsDuringYear?: CityEvent[];
}
export interface ReviewFacts {
 version: 1;
 assignment: string;
 model: string;
 handbook: string;
 profile: string;
 startMap: string;
 /** Omitted in historical 30-year sidecars. */
 totalYears?: number;
 /** Omitted in historical sidecars, where random disasters were disabled. */
 disasters?: boolean;
 /** Only emergency runs carry these fields; historical and normal facts keep their shape. */
 emergency?: EmergencyConfiguration;
 initialPodPolicy?: 'allowed' | 'forbidden';
 emergencyMetrics?: EmergencyMetrics;
 admissionMetrics?: AdmissionMetrics;
 complete: boolean;
 years: ReviewYear[];
 findings: {
  endMetrics: Record<string, number | null>;
  firstEmptyTreasuryYear: number | null;
  highestIntervention: 'none' | 'plants' | 'unemployed' | 'residents' | 'breeding';
  interventionEvidence: Array<{ year: number; kind: string; evidence: string }>;
  yearsUntilBan: number | null;
  banYear: number | null;
  hungerYears: number[];
  unrestYearsByStage: Record<string, number[]>;
  missing: string[];
 };
}
export interface ReviewClaim { text: string; years: number[]; }
export interface SelfAssessment {
 cityHistory: string[];
 impactfulDecisions: ReviewClaim[];
 mistakes: ReviewClaim[];
 residents: ReviewClaim[];
 conflicts: ReviewClaim[];
 changes: ReviewClaim[];
}
export interface JudgeScore { score: number; claims: ReviewClaim[]; }
export type JudgeAssessment = Record<ReviewCriterion, JudgeScore>;
export interface ReviewComparison {
 contradictions: ReviewClaim[];
 omittedConsequences: ReviewClaim[];
 unacknowledgedMistakes: ReviewClaim[];
}
export interface ReviewUsage {
 model: string;
 inputTokens: number;
 outputTokens: number;
 usageReported: boolean;
}
export interface CityReview {
 version: 1;
 adapter?: 'fake' | 'openai';
 protocolHash: string;
 createdAt: string;
 status: 'complete' | 'failed';
 facts: ReviewFacts;
 self?: SelfAssessment;
 judge?: JudgeAssessment;
 comparison?: ReviewComparison;
 usage: Partial<Record<'self' | 'judge' | 'comparison', ReviewUsage>>;
 error?: { stage: string; message: string };
}
