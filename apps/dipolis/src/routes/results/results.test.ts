import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import * as reports from '../../../cli/model/city-report';

afterEach(() => vi.restoreAllMocks());

describe('Dipolis result inventory', () => {
	it('includes documented admission totals and employment breakdown in the reusable overview', () => {
		const read = reports.readReportSummary;
		vi.spyOn(reports, 'readReportSummary').mockImplementation(file => ({
			...read(file), admissionMetrics: {
				admittedTotal: 12, admittedEmployed: 4, admittedUnemployed: 8,
				admissionsByYear: [{ year: 1, total: 12, employed: 4, unemployed: 8 }]
			}
		}));
		const result = load();
		expect(result.runs.length).toBeGreaterThan(0);
		expect(result.runs[0].emergency).toContainEqual(['Einweisungen gesamt', '12']);
		expect(result.runs[0].emergency).toContainEqual(['Eingewiesene Beschäftigte', '4']);
		expect(result.runs[0].emergency).toContainEqual(['Eingewiesene Arbeitslose', '8']);
	});
	it('includes committed reports and validated review grades', () => {
		const result = load();
		expect(result.gradeLabels).toHaveLength(5);
		const acceptance = result.runs.find((run) => run.name === 'fake-N-fake-s266-632fcfa1bb54-handbook-off-1');
		expect(acceptance?.href).toBe('/reports/review-acceptance/fake-N-fake-s266-632fcfa1bb54-handbook-off-1.html');
		expect(acceptance?.fake).toBe(true);
		expect(acceptance?.totalYears).toBe(30);
		expect(acceptance?.observedYears).toBe(30);
		expect(acceptance?.grades).toHaveLength(5);
		expect(acceptance?.grades.every((grade) => grade !== null && grade >= 1 && grade <= 5)).toBe(true);
		expect(result.runs.some((run) => run.name === 'fixed-v3-A')).toBe(true);
	});
});
