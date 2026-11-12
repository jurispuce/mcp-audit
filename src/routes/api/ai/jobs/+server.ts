import { startJob } from '#lib/ai/runner.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer, body } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** Start an in-app AI action. Answers at once with the job; progress is read from /api/ai/jobs/:id. */
export const POST: RequestHandler = async (event) => {
	const input = await body<{ action: string; context: Record<string, unknown> }>(event);
	return answer(() => {
		const { job } = startJob(appDatabase(), uiActor(event.locals), {
			action: String(input.action ?? ''),
			context: input.context && typeof input.context === 'object' ? input.context : {}
		});
		return { job };
	}, 202);
};
