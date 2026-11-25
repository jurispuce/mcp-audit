import { error } from '@sveltejs/kit';
import { NotFoundError } from '#lib/domain/errors.ts';
import { aiAvailable } from '#lib/domain/ai-settings.ts';
import { getEngagement } from '#lib/domain/engagements.ts';
import { listJobs } from '#lib/domain/jobs.ts';
import { proposalSummary } from '#lib/domain/proposals.ts';
import { linkReceivedDocuments } from '#lib/domain/received-documents.ts';
import { appDatabase } from '#lib/server/db.ts';
import { guideBar } from '#lib/server/guide-bar.ts';
import { uiActor } from '#lib/server/http.ts';
import type { LayoutServerLoad } from './$types';

/** Screens that show planned evidence or proposals: matches with received documents are proposed first. */
const PROPOSE_RECEIVED = new Set([
	'/(app)/e/[e]/plan/events',
	'/(app)/e/[e]/run/events/[event]',
	'/(app)/e/[e]/proposals'
]);

/** The engagement every screen below /e/:e works in. Unknown or deleted ids are a 404. */
export const load: LayoutServerLoad = ({ params, route, locals, url, cookies }) => {
	try {
		const app = appDatabase();
		const engagement = getEngagement(app, params.e);
		// Planned evidence that a received document already answers shows up as a proposed link at once,
		// with no extra step (#83). Idempotent; a rejected match is not proposed again.
		if (route.id && PROPOSE_RECEIVED.has(route.id))
			linkReceivedDocuments(app, uiActor(locals), engagement.id);
		return {
			engagement,
			proposals: proposalSummary(app, engagement.id),
			// The guide bar (#106), when the person came here from a step of the guide.
			guide: guideBar(app, engagement.id, url, cookies),
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
