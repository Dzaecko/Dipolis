import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readReportSummary } from '../../../cli/model/city-report';
import { loadCityReview, reviewGradeLabels } from '../../../cli/model/city-review-render';
import { REVIEW_CRITERIA } from '../../../cli/model/review-types';

export const prerender = true;

export function load() {
	const runs = ['model-runs', 'v3-pods-runs', 'review-acceptance'].flatMap((directory) => {
		const root = path.resolve('../../docs/results', directory);
		if (!existsSync(root)) return [];
		return readdirSync(root).filter((name) => name.endsWith('.jsonl')).map((file) => {
			const protocol = path.join(root, file);
			const summary = readReportSummary(protocol);
			const loaded = loadCityReview(protocol, summary);
			const html = file.replace(/\.jsonl$/i, '.html');
			return {
				name: file.replace(/\.jsonl$/i, ''),
				totalYears: summary.totalYears,
				observedYears: summary.observedYears,
				href: existsSync(path.join(root, html)) ? `/reports/${directory}/${html}` : null,
				grades: REVIEW_CRITERIA.map((key) => loaded.review?.judge?.[key]?.score ?? null),
				warning: loaded.warning ?? loaded.review?.error?.message ?? null,
				fake: loaded.review?.adapter === 'fake',
			};
		});
	});
	return { runs, gradeLabels: reviewGradeLabels };
}
