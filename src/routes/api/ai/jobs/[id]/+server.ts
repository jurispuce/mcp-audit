import { getJob } from '#lib/domain/jobs.ts';
import { appDatabase } from '#lib/server/db.ts';
import { answer } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** A job's status and progress steps, for the progress panel to poll. */
export const GET: RequestHandler = ({ params }) => answer(() => ({ job: getJob(appDatabase(), params.id) }));
