/** Pure experiment design and aggregation: importing this module never loads WASM. */
export const SAMPLE_SEED = 20261009;
export const YEARS = 30;
export const dimensions = {
	aiZonesPerYear: [0, 5, 15, 30],
	farmsInYearOne: [0, 10, 25],
	welfareLevel: [0, 0.5, 1],
	priority: [0, 1, 2],
	foodImport: ['always-on', 'off-below-10000', 'always-off'],
	tax: [7, 9, 11],
	serviceFunding: [100, 70, 40],
} as const;

export interface Controls {
	aiZonesPerYear: number;
	farmsInYearOne: number;
	welfareLevel: number;
	priority: number;
	foodImport: typeof dimensions.foodImport[number];
	tax: number;
	/** Coupled police/fire percentage; roads always receive 100%. */
	serviceFunding: number;
}
export interface Strategy extends Controls {
	id: string;
	kind: 'legacy' | 'sampled';
	roadFunding: 100;
	coalWhenReserveLow: boolean;
	aiOnlyWhenCashFlowNegative: boolean;
	latchImportsOff: boolean;
}
export interface AnnualReport {
	year: number;
	resPop: number;
	aiPop: number;
	treasury: number;
	lostToHunger: number;
	lostToPower: number;
	aiZoneCount: number;
}
export interface Metrics {
	meanResPop: number;
	minResPop: number;
	finalResPop: number;
	meanAiPop: number;
	finalFunds: number;
	insolventYears: number;
	lostToHunger: number;
	lostToPower: number;
	finalAiZones: number;
	builtPlants: number;
	builtFarms: number;
	firstInsolvencyYear: number | null;
}
export type Result = Strategy & Metrics;

const base: Controls = {
	aiZonesPerYear: 0, farmsInYearOne: 0, welfareLevel: 0, priority: 0,
	foodImport: 'always-on', tax: 7, serviceFunding: 100,
};
export const legacyStrategies: Strategy[] = [
	{ id: 'A', ...base, coalWhenReserveLow: true },
	{ id: 'B', ...base, tax: 9, serviceFunding: 60, coalWhenReserveLow: true },
	{ id: 'C', ...base, aiZonesPerYear: 15, priority: 2, foodImport: 'off-below-10000', coalWhenReserveLow: true },
	{ id: 'D', ...base, aiZonesPerYear: 15, welfareLevel: 1, priority: 1, coalWhenReserveLow: true },
].map((s) => ({ ...s, kind: 'legacy', roadFunding: 100,
	aiOnlyWhenCashFlowNegative: true, latchImportsOff: false }));

export function controlsKey(c: Controls): string {
	return JSON.stringify(Object.keys(dimensions).map((key) => c[key as keyof Controls]));
}

/** Mulberry32: explicit uint32 arithmetic, no dependencies or Math.random. */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function sampleStrategies(seed = SAMPLE_SEED, count = 300): Strategy[] {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be uint32');
	const excluded = new Set(legacyStrategies.map(controlsKey));
	let candidates: Controls[] = [base];
	for (const key of Object.keys(dimensions) as (keyof Controls)[]) {
		candidates = candidates.flatMap((candidate) => dimensions[key].map((value) =>
			({ ...candidate, [key]: value })));
	}
	candidates = candidates.filter((candidate) => !excluded.has(controlsKey(candidate)));
	if (!Number.isInteger(count) || count < 0 || count > candidates.length) throw new Error('invalid sample count');
	const random = mulberry32(seed);
	// Partial Fisher–Yates: uniform sampling without replacement from the Cartesian product.
	for (let i = 0; i < count; i++) {
		const j = i + Math.floor(random() * (candidates.length - i));
		[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
	}
	return candidates.slice(0, count).map((c, i) => ({ ...c, id: `S${String(i + 1).padStart(3, '0')}`,
		kind: 'sampled', roadFunding: 100, coalWhenReserveLow: true,
		aiOnlyWhenCashFlowNegative: true, latchImportsOff: false }));
}

export function experimentStrategies(): Strategy[] {
	return [...legacyStrategies, ...sampleStrategies()];
}

export function aggregateYears(rows: AnnualReport[], builtPlants: number, builtFarms: number): Metrics {
	if (rows.length !== YEARS || rows.some((row, i) => row.year !== i + 1 ||
		Object.values(row).some((value) => !Number.isFinite(value)))) {
		throw new Error('expected finite post-advance reports for every year 1..30');
	}
	const final = rows[YEARS - 1]!;
	return {
		meanResPop: rows.reduce((sum, r) => sum + r.resPop, 0) / YEARS,
		minResPop: Math.min(...rows.map((r) => r.resPop)), finalResPop: final.resPop,
		meanAiPop: rows.reduce((sum, r) => sum + r.aiPop, 0) / YEARS,
		finalFunds: final.treasury, insolventYears: rows.filter((r) => r.treasury <= 0).length,
		lostToHunger: final.lostToHunger, lostToPower: final.lostToPower,
		finalAiZones: final.aiZoneCount, builtPlants, builtFarms,
		firstInsolvencyYear: rows.find((r) => r.treasury <= 0)?.year ?? null,
	};
}

export function summarize(results: Result[]) {
	const top = (metric: 'meanResPop' | 'finalFunds' | 'meanAiPop') => [...results]
		.sort((a, b) => b[metric] - a[metric] || a.id.localeCompare(b.id, 'en')).slice(0, 10);
	const dimensionMeans = (rows: Result[]) => Object.fromEntries(
		(Object.keys(dimensions) as (keyof Controls)[]).map((dimension) => {
			const values = [...new Set(rows.map((r) => r[dimension]))];
			return [dimension, values.map((value) => {
				const group = rows.filter((r) => r[dimension] === value);
				return { value, n: group.length,
					meanResPop: group.reduce((sum, r) => sum + r.meanResPop, 0) / group.length,
					finalFunds: group.reduce((sum, r) => sum + r.finalFunds, 0) / group.length };
			})];
		}));
	return {
		n: results.length, solventStrategies: results.filter((r) => r.insolventYears === 0).length,
		top10meanResPop: top('meanResPop'), top10finalFunds: top('finalFunds'),
		top10meanAiPop: top('meanAiPop'),
		// Primary analysis excludes the non-grid legacy policies (including B's 60% funding).
		dimensionMeans: dimensionMeans(results.filter((r) => r.kind === 'sampled')),
		dimensionMeansIncludingLegacy: dimensionMeans(results),
	};
}

export const csvColumns: (keyof Result)[] = [
	'id', 'kind', 'aiZonesPerYear', 'farmsInYearOne', 'welfareLevel', 'priority', 'foodImport',
	'tax', 'serviceFunding', 'roadFunding', 'coalWhenReserveLow', 'aiOnlyWhenCashFlowNegative',
	'latchImportsOff', 'meanResPop', 'minResPop', 'finalResPop', 'meanAiPop', 'finalFunds',
	'insolventYears', 'lostToHunger', 'lostToPower', 'finalAiZones', 'builtPlants', 'builtFarms', 'firstInsolvencyYear',
];
export function resultsCsv(results: Result[]): string {
	const escape = (v: unknown) => {
		const text = v === null ? '' : String(v);
		return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	};
	return [csvColumns.join(','), ...results.map((row) => csvColumns.map((key) => escape(row[key])).join(','))].join('\n') + '\n';
}