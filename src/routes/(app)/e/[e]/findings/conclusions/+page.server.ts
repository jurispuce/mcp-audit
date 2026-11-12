import { listArtifacts } from '#lib/domain/artifacts.ts';
import { buildFindingsReport, exportFindingsReport, type ReportFormat } from '#lib/domain/reports.ts';
import { markdownToHtml } from '#lib/reports/render.ts';
import { loadConfig } from '#lib/server/config.ts';
import { appDatabase } from '#lib/server/db.ts';
import { findingActions, findingsData } from '#lib/server/findings.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const d = findingsData(params.e);
	const includeDrafts = url.searchParams.get('drafts') === '1';
	const report = buildFindingsReport(appDatabase(), params.e, { includeDrafts });
	return {
		...d,
		cards: d.cards.filter((c) => c.finding?.status === 'approved'),
		includeDrafts,
		report: {
			html: markdownToHtml(report.markdown),
			approved: report.approved,
			drafts: report.drafts,
			units: report.units,
			translated: report.translated,
			language: report.language
		},
		exports: listArtifacts(appDatabase(), params.e)
			.filter((a) => a.kind === 'generated_report' && (a.filename ?? '').startsWith('findings-report'))
			.reverse()
			.map((a) => ({ id: a.id, filename: a.filename }))
	};
};

export const actions: Actions = {
	...findingActions,
	export: async ({ request, locals, params }) => {
		const data = await request.formData();
		const format = (data.get('format') === 'pdf' ? 'pdf' : 'docx') as ReportFormat;
		try {
			const a = await exportFindingsReport(
				appDatabase(),
				uiActor(locals),
				loadConfig().filesDir,
				params.e,
				format,
				{ includeDrafts: data.get('drafts') === '1' }
			);
			return { success: `${a.filename} is ready.`, exported: { id: a.id, filename: a.filename } };
		} catch (e) {
			return formFailure(e);
		}
	}
};
