import { setGuidance } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer, body } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async (event) => {
	const b = await body<{ body: string; baseVersion: number | null }>(event);
	return answer(() => ({
		guidance: setGuidance(
			appDatabase(),
			uiActor(event.locals),
			event.params.id,
			String(b.body ?? ''),
			b.baseVersion == null ? undefined : Number(b.baseVersion)
		).row
	}));
};
