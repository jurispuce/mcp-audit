import { rejectLink } from '#lib/domain/library-review.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** Reject a proposed link: removed, and the history keeps it. */
export const POST: RequestHandler = ({ params, locals }) =>
	answer(() => {
		rejectLink(appDatabase(), uiActor(locals), params.id);
	});
