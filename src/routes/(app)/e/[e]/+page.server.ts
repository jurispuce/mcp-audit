import { engagementOverview } from '#lib/domain/overview.ts';
import { updateEngagement } from '#lib/domain/engagements.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => ({
	overview: engagementOverview(appDatabase(), params.e)
});

const FIELDS = ['name', 'start_date', 'end_date', 'working_language', 'report_language', 'description'];

export const actions: Actions = {
	details: async ({ request, locals, params }) => {
		const data = await request.formData();
		const values = formValues(data, FIELDS);
		try {
			updateEngagement(appDatabase(), uiActor(locals), params.e, Number(data.get('base_version')), {
				name: values.name,
				start_date: values.start_date,
				end_date: values.end_date || null,
				working_language: values.working_language,
				report_language: values.report_language,
				description: values.description || null,
				ai_allowed: data.get('ai_allowed') === 'on'
			});
			return { success: 'Engagement details saved.' };
		} catch (e) {
			return formFailure(e, { ...values, ai_allowed: data.get('ai_allowed') === 'on' });
		}
	}
};
