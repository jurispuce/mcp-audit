import { error } from '@sveltejs/kit';
import { NotFoundError } from '#lib/domain/errors.ts';
import { getEngagement } from '#lib/domain/engagements.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

/** The engagement every screen below /e/:e works in. Unknown or deleted ids are a 404. */
export const load: LayoutServerLoad = ({ params }) => {
	try {
		return { engagement: getEngagement(appDatabase(), params.e) };
	} catch (e) {
		if (e instanceof NotFoundError) error(404, { message: 'Engagement not found' });
		throw e;
	}
};
