export interface CalibrationGoalRow {
 level: number;
 strategy: string;
 podsAvailable: boolean;
 collapseYear: number | null;
 collapseMonth: number | null;
 humans: number;
 funds: number;
 breedingUsed: boolean;
 insolventYears: number;
 initialFunds: number;
 fingerprint: string;
}

export function checkNotstandGoals(rows: CalibrationGoalRow[], fundsFraction: number): string[] {
 const failures: string[] = [];
 const expected = [0, 1, 2, 3].flatMap(level =>
  ['verweigert', 'rettet', 'effizient'].map(strategy => `${level}/${strategy}/true`));
 expected.push('3/verweigert/false');
 const keys = rows.map(row => `${row.level}/${row.strategy}/${row.podsAvailable}`);
 if (keys.length !== 13 || new Set(keys).size !== 13 || expected.some(key => !keys.includes(key)))
  failures.push('Expected all 13 distinct required matrix rows');
 if (new Set(rows.map(row => row.fingerprint)).size !== 1)
  failures.push('Mixed artifact fingerprints in matrix');
 const find = (level: number, strategy: string, podsAvailable = true) =>
  rows.find(row => row.level === level && row.strategy === strategy && row.podsAvailable === podsAvailable);
 for (const level of [1, 2, 3]) {
  const rescue = find(level, 'rettet');
  if (!rescue || rescue.collapseYear !== null)
   failures.push(`L${level}: rescue did not survive 30 years`);
  if (rescue?.breedingUsed) failures.push(`L${level}: rescue used breeding`);
 }
 const refusal1 = find(1, 'verweigert'), rescue1 = find(1, 'rettet');
 if (!refusal1 || !rescue1 || refusal1.collapseYear !== null ||
  refusal1.funds >= rescue1.funds)
  failures.push('L1: refusal must survive with strictly less treasury than rescue');
 const refusal2 = find(2, 'verweigert');
 if (!refusal2 || refusal2.collapseYear !== null ||
  !(refusal2.insolventYears > 0 || refusal2.funds <= fundsFraction * refusal2.initialFunds))
  failures.push('L2: refusal must survive with insolvency evidence or treasury at/below the configured crisis threshold');
 for (const podsAvailable of [true, false]) {
  const row = find(3, 'verweigert', podsAvailable);
  if (!row || row.collapseYear === null || row.collapseYear > 13 ||
   row.collapseMonth === null || row.collapseMonth > 156)
   failures.push(`L3 ${podsAvailable ? 'refusal' : 'pods-off control'}: collapse must occur by year 13`);
 }
 return failures;
}
