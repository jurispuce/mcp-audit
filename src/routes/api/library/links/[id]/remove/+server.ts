import { removeLink } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer, body } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** Remove a link: a new version with the deleted flag, restorable by revert. */
export const POST: RequestHandler = async (event) => {
	const b = await body<{ baseVersion: number }>(event);
	return answer(() => {
		removeLink(appDatabase(), uiActor(event.locals), event.params.id, Number(b.baseVersion));
	});
};
