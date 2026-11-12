import { aiAvailable } from '#lib/domain/ai-settings.ts';
import { listJobs } from '#lib/domain/jobs.ts';
import { listLibraryProposals } from '#lib/domain/library-review.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const app = appDatabase();
	return {
		proposalCount: listLibraryProposals(app).total,
		// The library has no AI switch of its own; the buttons need a checked model.
		ai: {
			allowed: true,
			available: aiAvailable(app),
			running: listJobs(app, { engagementId: null })
				.filter((j) => j.status === 'running')
				.map((j) => ({ id: j.id, action: j.action, context: j.context }))
		}
	};
};
