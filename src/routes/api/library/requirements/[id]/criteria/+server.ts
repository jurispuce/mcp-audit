import { addCriterion } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer, body } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const b = await body<{ text: string; expectedEvidence: string[] | string }>(event);
	return answer(
		() => ({
			criterion: addCriterion(appDatabase(), uiActor(event.locals), event.params.id, {
				text: String(b.text ?? ''),
				expectedEvidence: b.expectedEvidence ?? []
			}).row
		}),
		201
	);
};
