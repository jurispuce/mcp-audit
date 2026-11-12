import { redirect } from '@sveltejs/kit';
import { createEngagement, listAuditees, listEngagements } from '#lib/domain/engagements.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import { DESTINATIONS } from '#lib/navigation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const app = appDatabase();
	// The switcher passes the current destination, so choosing another engagement keeps it.
	const at = DESTINATIONS.find((d) => d.key === url.searchParams.get('at'));
	return {
		engagements: listEngagements(app),
		auditees: listAuditees(app).map((a) => a.name),
		at: at?.path ?? '',
		atLabel: at && at.key !== 'home' ? at.label : null,
		today: new Date().toISOString().slice(0, 10)
	};
};

const FIELDS = [
	'name',
	'auditee',
	'start_date',
	'end_date',
	'working_language',
	'report_language',
	'description'
];

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const values = formValues(await request.formData(), FIELDS);
		let id: string;
		try {
			id = createEngagement(appDatabase(), uiActor(locals), {
				name: values.name ?? '',
				auditeeName: values.auditee,
				startDate: values.start_date ?? '',
				endDate: values.end_date || null,
				workingLanguage: values.working_language || 'en',
				reportLanguage: values.report_language || 'en',
				description: values.description || null
			}).id;
		} catch (e) {
			return formFailure(e, values);
		}
		redirect(303, `/e/${id}`);
	}
};
