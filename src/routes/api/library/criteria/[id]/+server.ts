import { updateCriterion } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer, body } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const b = await body<{ text: string; expectedEvidence: string[] | string; baseVersion: number }>(event);
	return answer(() => ({
		criterion: updateCriterion(appDatabase(), uiActor(event.locals), event.params.id, Number(b.baseVersion), {
			text: b.text,
			expectedEvidence: b.expectedEvidence
		}).row
	}));
};
