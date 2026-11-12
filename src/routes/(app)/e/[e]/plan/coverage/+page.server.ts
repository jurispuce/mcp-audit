import { redirect } from '@sveltejs/kit';
import { addEvent, coverage, listEvents, setEventRequirement } from '#lib/domain/planning.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import { planHeader, planStatusAction } from '#lib/server/plan.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	return {
		plan: planHeader(params.e),
		coverage: coverage(app, params.e),
		events: listEvents(app, params.e).map((e) => ({
			id: e.id,
			title: e.title,
			date: e.date,
			startTime: e.startTime,
			formatLabel: e.formatLabel,
			participantsLine: e.participantsLine,
			requirementIds: e.requirementIds,
			proposed: e.proposed
		}))
	};
};

export const actions: Actions = {
	planStatus: planStatusAction,
	include: async ({ request, locals, params }) => {
		const data = await request.formData();
		const included = data.get('included') === 'true';
		try {
			const ev = setEventRequirement(
				appDatabase(),
				uiActor(locals),
				params.e,
				String(data.get('event')),
				String(data.get('requirement')),
				included
			);
			return { success: included ? `Added to ${ev.title}.` : `Removed from ${ev.title}.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	/** A new event that already contains the requirement, opened for editing. */
	newEvent: async ({ request, locals, params }) => {
		const data = await request.formData();
		const requirementId = String(data.get('requirement'));
		let id: string;
		try {
			id = addEvent(appDatabase(), uiActor(locals), params.e, {
				title: `New event for ${String(data.get('ref') ?? 'requirement')}`,
				requirement_ids: [requirementId]
			}).id;
		} catch (e) {
			return formFailure(e);
		}
		redirect(303, `/e/${params.e}/plan/events?edit=${id}#event-${id}`);
	}
};
