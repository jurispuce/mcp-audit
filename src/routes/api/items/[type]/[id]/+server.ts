import { json } from '@sveltejs/kit';
import { getItem, getItemComments, getItemHistory } from '#lib/domain/items.ts';
import { appDatabase } from '#lib/server/db.ts';
import { assertItemInContext, httpError } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/** Everything the item sheet needs for one record: details, history and comments. */
export const GET: RequestHandler = ({ params, url }) => {
	try {
		const app = appDatabase();
		assertItemInContext(app, url, params.type, params.id);
		return json({
			item: getItem(app, params.type, params.id),
			history: getItemHistory(app, params.type, params.id).map(({ snapshot: _snapshot, ...e }) => e),
			comments: getItemComments(app, params.type, params.id),
			links: []
		});
	} catch (e) {
		httpError(e);
	}
};
