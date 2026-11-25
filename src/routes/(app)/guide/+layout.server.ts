import { NotFoundError } from '#lib/domain/errors.ts';
import { getEngagement, listEngagements } from '#lib/domain/engagements.ts';
import { engagementOverview } from '#lib/domain/overview.ts';
import { proposalSummary } from '#lib/domain/proposals.ts';
import { signInMethod } from '#lib/domain/sign-in-method.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

/**
 * The guide (#84, #106). `?e=<engagement>` keeps the engagement the person came from: the shell stays
 * on it, the steps show its progress, and the guide's Go buttons open its screens. Without one, the
 * engagements to choose from. The MCP address is this instance's own, taken from the request.
 */
export const load: LayoutServerLoad = ({ url }) => {
	const app = appDatabase();
	const id = url.searchParams.get('e');
	let engagement: ReturnType<typeof getEngagement> | null = null;
	if (id) {
		try {
			engagement = getEngagement(app, id);
		} catch (e) {
			if (!(e instanceof NotFoundError)) throw e;
		}
	}
	return {
		engagement,
		proposals: engagement ? proposalSummary(app, engagement.id) : null,
		// Progress per step comes from the same phase checklist as Home.
		phases: engagement
			? engagementOverview(app, engagement.id).phases.map((p) => ({
					number: p.number,
					title: p.title,
					fact: p.fact,
					done: p.done
				}))
			: null,
		engagements: engagement
			? []
			: listEngagements(app).map((e) => ({ id: e.id, name: e.name, auditeeName: e.auditeeName })),
		mcpUrl: `${url.origin}/mcp`,
		signIn: signInMethod()
	};
};
