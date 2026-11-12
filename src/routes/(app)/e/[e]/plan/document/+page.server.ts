import { listArtifacts } from '#lib/domain/artifacts.ts';
import { buildAuditPlan, exportAuditPlan, type PlanFormat } from '#lib/domain/audit-plan.ts';
import { markdownToHtml } from '#lib/reports/render.ts';
import { loadConfig } from '#lib/server/config.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import { planHeader, planStatusAction } from '#lib/server/plan.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	const plan = buildAuditPlan(app, params.e);
	return {
		plan: planHeader(params.e),
		document: {
			html: markdownToHtml(plan.markdown),
			language: plan.language,
			translated: plan.translated,
			uncovered: plan.uncovered,
			drafts: plan.drafts
		},
		exports: listArtifacts(app, params.e)
			.filter((a) => a.kind === 'generated_report' && (a.filename ?? '').startsWith('audit-plan'))
			.reverse()
			.map((a) => ({
				id: a.id,
				title: a.displayName,
				filename: a.filename,
				createdAt: a.createdAt.toISOString()
			}))
	};
};

export const actions: Actions = {
	planStatus: planStatusAction,
	export: async ({ request, locals, params }) => {
		const format = (await request.formData()).get('format') === 'pdf' ? 'pdf' : ('docx' as PlanFormat);
		try {
			const a = await exportAuditPlan(
				appDatabase(),
				uiActor(locals),
				loadConfig().filesDir,
				params.e,
				format
			);
			return { success: `${a.filename} is ready.`, exported: { id: a.id, filename: a.filename } };
		} catch (e) {
			return formFailure(e);
		}
	}
};
