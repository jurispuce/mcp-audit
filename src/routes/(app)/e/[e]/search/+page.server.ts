import { searchEngagement } from '#lib/domain/search.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	return { q, results: q ? searchEngagement(appDatabase(), params.e, q) : [] };
};
