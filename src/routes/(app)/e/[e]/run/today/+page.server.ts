import { listEvents } from '#lib/domain/planning.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

/** Today's events; when there are none, the next day with events. Drafts are not run. */
export const load: PageServerLoad = ({ params, url }) => {
	const today = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
	const events = listEvents(appDatabase(), params.e).filter((e) => !e.proposed);
	const todays = events.filter((e) => e.date === today);
	const next = todays.length ? null : (events.find((e) => e.date && e.date > today)?.date ?? null);
	return {
		today,
		todays,
		next,
		nextEvents: next ? events.filter((e) => e.date === next) : [],
		total: events.length
	};
};
