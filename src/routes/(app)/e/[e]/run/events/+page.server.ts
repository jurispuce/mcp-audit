import { listEvents } from '#lib/domain/planning.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => ({
	events: listEvents(appDatabase(), params.e).filter((e) => !e.proposed)
});
