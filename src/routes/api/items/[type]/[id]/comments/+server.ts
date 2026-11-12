import { json } from '@sveltejs/kit';
import { addComment } from '#lib/domain/comments.ts';
import '#lib/domain/entities.ts';
import { appDatabase } from '#lib/server/db.ts';
import { httpError, uiActor } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/** Add a comment. There is no edit or delete: comments are append-only. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	try {
		const body = (await request.json()) as { body?: string };
		const comment = addComment(
			appDatabase(),
			uiActor(locals),
			params.type,
			params.id,
			String(body.body ?? '')
		);
		return json({ comment }, { status: 201 });
	} catch (e) {
		httpError(e);
	}
};
