import { inbox } from '#lib/domain/execution.ts';
import { listEvents, listEvidence } from '#lib/domain/planning.ts';
import { appDatabase } from '#lib/server/db.ts';
import { captureAction, linkActions } from '#lib/server/run.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	const events = new Map(listEvents(app, params.e).map((e) => [e.id, e.title]));
	return {
		items: inbox(app, params.e).map((a) => ({
			id: a.id,
			title: a.displayName,
			filename: a.filename,
			kind: a.kind,
			origin: a.origin,
			eventId: a.eventId,
			eventTitle: a.eventId ? (events.get(a.eventId) ?? null) : null
		})),
		evidence: listEvidence(app, params.e)
			.filter((x) => !x.proposed)
			.map((x) => ({ id: x.id, text: x.text, eventTitle: events.get(x.eventId) }))
	};
};

export const actions: Actions = { ...linkActions, capture: captureAction };
