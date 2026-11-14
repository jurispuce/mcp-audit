import { requirementForReading } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { answer } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** One library requirement with its full text and place in its source, for reading side by side. */
export const GET: RequestHandler = ({ params }) =>
	answer(() => ({ requirement: requirementForReading(appDatabase(), params.id) }));
