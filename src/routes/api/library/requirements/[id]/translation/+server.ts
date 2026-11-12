import { setTranslationOf } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer, body } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** Mark this requirement as the translation of another, or clear it with translationOf: null. */
export const PUT: RequestHandler = async (event) => {
	const b = await body<{ translationOf: string | null; baseVersion: number }>(event);
	return answer(() => ({
		requirement: setTranslationOf(
			appDatabase(),
			uiActor(event.locals),
			event.params.id,
			Number(b.baseVersion),
			b.translationOf ? String(b.translationOf) : null
		).row
	}));
};
