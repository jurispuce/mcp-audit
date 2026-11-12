import { error } from '@sveltejs/kit';
import { NotFoundError } from '#lib/domain/errors.ts';
import { aiAvailable } from '#lib/domain/ai-settings.ts';
import { getEngagement } from '#lib/domain/engagements.ts';
import { listJobs } from '#lib/domain/jobs.ts';
import { proposalSummary } from '#lib/domain/proposals.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

/** The engagement every screen below /e/:e works in. Unknown or deleted ids are a 404. */
export const load: LayoutServerLoad = ({ params }) => {
	try {
		const app = appDatabase();
		const engagement = getEngagement(app, params.e);
		return {
			engagement,
			proposals: proposalSummary(app, engagement.id),
			// Whether the AI buttons can run here: AI allowed on the engagement and a checked model set up.
			ai: {
				allowed: engagement.aiAllowed,
				available: aiAvailable(app),
				running: listJobs(app, { engagementId: engagement.id })
					.filter((j) => j.status === 'running')
					.map((j) => ({ id: j.id, action: j.action, context: j.context }))
			}
		};
	} catch (e) {
		if (e instanceof NotFoundError) error(404, { message: 'Engagement not found' });
		throw e;
	}
};
