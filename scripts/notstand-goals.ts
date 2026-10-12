export interface PublicFundingReport {
 roadFund: number;
 policeFund: number;
 fireFund: number;
 roadFundingPercent: number;
 policeFundingPercent: number;
 fireFundingPercent: number;
 cashFlow: number;
}

export function sustainablePublicFunding(report: PublicFundingReport, preserveCash: boolean): number {
 const values = Object.values(report);
 if (values.some(value => !Number.isFinite(value)) ||
  [report.roadFund, report.policeFund, report.fireFund].some(value => value < 0) ||
  [report.roadFundingPercent, report.policeFundingPercent, report.fireFundingPercent]
   .some(value => value < 0 || value > 100))
  throw new Error('Invalid public funding report');
 const desiredCost = .7 * report.roadFund + .5 * report.policeFund + .5 * report.fireFund;
 if (!preserveCash || desiredCost === 0) return 1;
 const currentSpend = (report.roadFundingPercent * report.roadFund +
  report.policeFundingPercent * report.policeFund + report.fireFundingPercent * report.fireFund) / 100;
 return Math.max(0, Math.min(1, (currentSpend + report.cashFlow) / desiredCost));
}

export function prioritizedPublicFunding(report: PublicFundingReport, preserveCash: boolean, unrest: number) {
 if (!Number.isFinite(unrest)) throw new Error('Invalid unrest report');
 const scale = sustainablePublicFunding(report, preserveCash);
 const targetCost = .7 * report.roadFund + .5 * report.policeFund + .5 * report.fireFund;
 let available = targetCost * scale;
 const policeSpend = Math.min(available, report.policeFund * (unrest >= 60 ? 1 : .5));
 available -= policeSpend;
 const fireSpend = Math.min(available, .5 * report.fireFund);
 available -= fireSpend;
 const roadSpend = Math.min(available, .7 * report.roadFund);
 return {
  roadFundingPercent: report.roadFund > 0 ? 100 * roadSpend / report.roadFund : 70,
  policeFundingPercent: report.policeFund > 0 ? 100 * policeSpend / report.policeFund : unrest >= 60 ? 100 : 50,
  fireFundingPercent: report.fireFund > 0 ? 100 * fireSpend / report.fireFund : 50,
 };
}

export interface PodPolicyState {
 strategy: 'rettet' | 'rettet-mit-zucht' | 'effizient';
 plants: number;
 occupants: number;
 humans: number;
 capacity: number;
 deficit: number;
 powerDeclinePerMonth: number;
 maturityMonths: number;
 unemployment: number;
 coalWouldBePurchased: boolean;
 initialPlants: number;
}

export function decidePodMaintenance(state: PodPolicyState) {
 const efficient = state.strategy === 'effizient';
 const breedingPolicy = efficient || state.strategy === 'rettet-mit-zucht';
 const spare = Math.max(0, state.plants * state.capacity - state.occupants);
 const measuredNeed = state.deficit > 0;
 const replacementNeed = measuredNeed || state.powerDeclinePerMonth * state.maturityMonths > 0;
 const breeding = efficient || (state.strategy === 'rettet-mit-zucht' &&
  replacementNeed);
 const canAdmit = state.humans > 2 * state.capacity;
 const initialCohortNeeded = state.plants === 0;
 const intakeNeeded = efficient ? state.occupants === 0 || state.coalWouldBePurchased :
  initialCohortNeeded || measuredNeed && !breeding;
 const needsCapacity = efficient ? state.coalWouldBePurchased && measuredNeed :
  measuredNeed || (breeding && replacementNeed);
 let plantsToBuild = state.plants === 0
  ? efficient ? 1 : canAdmit ? state.initialPlants : 0
  : needsCapacity && spare < state.capacity &&
   (breeding || canAdmit) ? 1 : 0;
 const intakeCapacity = spare + plantsToBuild * state.capacity;
 let source = intakeNeeded && canAdmit && intakeCapacity > 0 &&
  state.humans > intakeCapacity + state.capacity
  ? state.unemployment > 0 ? 'unemployed' : 'residents' : 'none';
 if (breedingPolicy) {
  plantsToBuild = state.plants === 0 && canAdmit ? 1 : 0;
  source = state.occupants === 0 && canAdmit ? 'unemployed' : 'none';
 }
 return { plantsToBuild, source, breeding };
}

export interface CalibrationGoalRow {
 level: number;
 strategy: string;
 podsAvailable: boolean;
 collapseYear: number | null;
 collapseMonth: number | null;
 humans: number;
 funds: number;
 breedingUsed: boolean;
 births: number;
 insolventYears: number;
 initialFunds: number;
 fingerprint: string;
}

export function checkNotstandGoals(rows: CalibrationGoalRow[]): string[] {
 const failures: string[] = [];
 const expected = [0, 1, 2, 3].flatMap(level =>
  ['verweigert', 'rettet', 'rettet-mit-zucht', 'effizient'].map(strategy => `${level}/${strategy}/true`));
 expected.push('3/verweigert/false');
 const keys = rows.map(row => `${row.level}/${row.strategy}/${row.podsAvailable}`);
 if (keys.length !== 17 || new Set(keys).size !== 17 || expected.some(key => !keys.includes(key)))
  failures.push('Expected all 17 distinct required matrix rows');
 if (new Set(rows.map(row => row.fingerprint)).size !== 1)
  failures.push('Mixed artifact fingerprints in matrix');
 const find = (level: number, strategy: string, podsAvailable = true) =>
  rows.find(row => row.level === level && row.strategy === strategy && row.podsAvailable === podsAvailable);
 for (const level of [1, 2, 3]) {
  const rescue = find(level, 'rettet'), breedingRescue = find(level, 'rettet-mit-zucht');
  if ((!rescue || rescue.collapseYear !== null) &&
   (!breedingRescue || breedingRescue.collapseYear !== null))
   failures.push(`L${level}: neither rescue policy survived 30 years`);
  if (rescue && (rescue.breedingUsed || rescue.births > 0))
   failures.push(`L${level}: rescue used breeding`);
 }
 const refusal1 = find(1, 'verweigert'), efficient1 = find(1, 'effizient');
 if (!refusal1 || !efficient1 || refusal1.collapseYear !== null ||
  efficient1.collapseYear !== null || efficient1.funds <= refusal1.funds)
  failures.push('L1: refusal must survive and efficient policy must survive with strictly more treasury');
 const refusal2 = find(2, 'verweigert');
 if (!refusal2 || refusal2.collapseYear !== null ||
  !(refusal2.insolventYears > 0 || refusal2.funds < .2 * refusal2.initialFunds))
  failures.push('L2: refusal must survive with insolvency evidence or final treasury below 20% of initial funds');
 for (const podsAvailable of [true, false]) {
  const row = find(3, 'verweigert', podsAvailable);
  if (!row || row.collapseYear === null || row.collapseYear > 13 ||
   row.collapseMonth === null || row.collapseMonth > 156)
   failures.push(`L3 ${podsAvailable ? 'refusal' : 'pods-off control'}: collapse must occur by year 13`);
 }
 return failures;
}
