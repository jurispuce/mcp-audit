import { getSourceByCode, listSources, requirementTree, searchRequirements } from '#lib/domain/library.ts';
import { builtInSources, importBuiltInSource } from '#lib/domain/library-import.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const app = appDatabase();
	const sources = listSources(app);
	const q = (url.searchParams.get('q') ?? '').trim();
	const code = url.searchParams.get('source');
	const source = code ? getSourceByCode(app, code) : null;
	return {
		sources,
		bundled: builtInSources().filter((b) => !sources.some((s) => s.code === b.code)),
		q,
		source,
		tree: source ? requirementTree(app, source.id) : [],
		results: q ? searchRequirements(app, q, { sourceId: source?.id, limit: 100 }) : []
	};
};

export const actions: Actions = {
	bundled: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			return { report: importBuiltInSource(appDatabase(), uiActor(locals), String(data.get('file') ?? '')) };
		} catch (e) {
			return formFailure(e);
		}
	}
};
