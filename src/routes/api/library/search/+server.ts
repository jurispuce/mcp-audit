import { searchRequirements } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { answer } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** Requirement search for pickers (link targets, translations). */
export const GET: RequestHandler = ({ url }) =>
	answer(() => ({
		results: searchRequirements(appDatabase(), url.searchParams.get('q') ?? '', {
			limit: 20,
			excludeId: url.searchParams.get('exclude') ?? undefined
		})
	}));
