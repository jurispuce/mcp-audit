import { getSourceByCode, searchRequirements } from '#lib/domain/library.ts';
import { appDatabase } from '#lib/server/db.ts';
import { answer } from '#lib/server/json.ts';
import type { RequestHandler } from './$types';

/** Requirement search for pickers (link targets, translations); `source` limits it to one source. */
export const GET: RequestHandler = ({ url }) =>
	answer(() => {
		const app = appDatabase();
		const code = url.searchParams.get('source');
		const source = code ? getSourceByCode(app, code) : null;
		return {
			results: searchRequirements(app, url.searchParams.get('q') ?? '', {
				limit: 20,
				excludeId: url.searchParams.get('exclude') ?? undefined,
				sourceId: source?.id,
				// Mapping a proposed import: its own requirements are proposed too.
				includeProposed: source?.status === 'proposed'
			})
		};
	});
