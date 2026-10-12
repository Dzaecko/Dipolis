import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('Dipolis result inventory', () => {
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
