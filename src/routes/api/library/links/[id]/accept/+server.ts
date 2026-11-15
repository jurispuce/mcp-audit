import { acceptLink } from '#lib/domain/library-review.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** Confirm a proposed link (a person only). */
export const POST: RequestHandler = ({ params, locals }) =>
	answer(() => {
		acceptLink(appDatabase(), uiActor(locals), params.id);
	});
