import { addLink } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer, body } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const b = await body<{
		fromId: string;
		toId: string;
		type: string;
		coverage: string | null;
		note: string | null;
	}>(event);
	return answer(
		() => ({
			link: addLink(appDatabase(), uiActor(event.locals), {
				fromId: String(b.fromId ?? ''),
				toId: String(b.toId ?? ''),
				type: String(b.type ?? ''),
				coverage: b.coverage ?? null,
				note: b.note ?? null
			}).row
		}),
		201
	);
};
