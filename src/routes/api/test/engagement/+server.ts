import { error, json } from '@sveltejs/kit';
import { createTestEngagement, seedAllowed } from '#lib/domain/seed.ts';
import { listEvents } from '#lib/domain/planning.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Test only: a fresh copy of the sample engagement with its own auditee. 404 unless TEST_SEED_ENABLED=true. */
export const POST: RequestHandler = async ({ request }) => {
	if (!seedAllowed()) error(404, { message: 'Not found' });
	const { name } = (await request.json()) as { name?: string };
	if (!name) error(400, { message: 'Give the engagement a name.' });
	const app = appDatabase();
	const e = await createTestEngagement(app, process.env, name);
	return json({
		id: e.id,
		name: e.name,
		auditeeId: e.auditeeId,
		events: listEvents(app, e.id).map((x) => ({ id: x.id, title: x.title }))
	});
};
