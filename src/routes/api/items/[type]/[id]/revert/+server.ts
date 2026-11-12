import { json } from '@sveltejs/kit';
import { getItem, revertItem } from '#lib/domain/items.ts';
import { appDatabase } from '#lib/server/db.ts';
import { httpError, uiActor } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/** Revert an item to an earlier version: a new version that copies it. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	try {
		const body = (await request.json()) as { toVersion?: number; baseVersion?: number };
		const app = appDatabase();
		revertItem(
			app,
			uiActor(locals),
			params.type,
			params.id,
			Number(body.baseVersion),
			Number(body.toVersion)
		);
		return json({ item: getItem(app, params.type, params.id) });
	} catch (e) {
		httpError(e);
	}
};
