import { fail } from '@sveltejs/kit';
import { ValidationError } from '#lib/domain/errors.ts';
import { getSourceByCode, listSources, requirementTree, searchRequirements } from '#lib/domain/library.ts';
import { builtInSources, importBuiltInSource, importSourceYaml } from '#lib/domain/library-import.ts';
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

const MAX_FILE = 2 * 1024 * 1024;

export const actions: Actions = {
	import: async ({ request, locals }) => {
		const data = await request.formData();
		const file = data.get('file');
		let text = String(data.get('yaml') ?? '');
		let fileName = 'pasted text';
		if (file instanceof File && file.size > 0) {
			if (file.size > MAX_FILE) return fail(400, { message: 'The file is larger than 2 MB.' });
			text = await file.text();
			fileName = file.name;
		}
		try {
			if (!text.trim()) throw new ValidationError('Choose a YAML file or paste its contents.');
			return { report: importSourceYaml(appDatabase(), uiActor(locals), text, { fileName }) };
		} catch (e) {
			return formFailure(e);
		}
	},
	bundled: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			return { report: importBuiltInSource(appDatabase(), uiActor(locals), String(data.get('file') ?? '')) };
		} catch (e) {
			return formFailure(e);
		}
	}
};
