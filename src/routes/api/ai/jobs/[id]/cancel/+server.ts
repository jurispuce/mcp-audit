import { cancelJob } from '#lib/ai/runner.ts';
import { appDatabase } from '#lib/server/db.ts';
import { uiActor } from '#lib/server/http.ts';
import { answer } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ params, locals }) =>
	answer(() => ({ job: cancelJob(appDatabase(), uiActor(locals), params.id) }));
