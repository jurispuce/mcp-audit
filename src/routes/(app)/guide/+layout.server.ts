import { NotFoundError } from '#lib/domain/errors.ts';
import { getEngagement } from '#lib/domain/engagements.ts';
import { proposalSummary } from '#lib/domain/proposals.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { LayoutServerLoad } from './$types';

/**
 * The guide (#84). `?e=<engagement>` keeps the engagement the person came from: the shell stays on
 * it and the steps show its progress. The MCP address is this instance's own, taken from the request.
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
		mcpUrl: `${url.origin}/mcp`
	};
};
