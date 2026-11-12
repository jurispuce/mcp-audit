import { fail } from '@sveltejs/kit';
import { ValidationError } from '#lib/domain/errors.ts';
import { listSources } from '#lib/domain/library.ts';
import { listLibraryDocuments, uploadLibraryDocuments } from '#lib/domain/library-documents.ts';
import { importSourceYaml } from '#lib/domain/library-import.ts';
import { listLibraryProposals } from '#lib/domain/library-review.ts';
import { loadConfig } from '#lib/server/config.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

const MAX_FILE = 2 * 1024 * 1024;

export const load: PageServerLoad = () => {
	const app = appDatabase();
	const p = listLibraryProposals(app);
	return {
		documents: listLibraryDocuments(app).map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
		sources: listSources(app, { includeProposed: true }).map((s) => ({
			code: s.code,
			title: s.title,
			status: s.status
		})),
		waiting: {
			imports: p.sources.length,
			changes: p.changes.reduce((n, c) => n + c.requirements.length, 0),
			links: p.mappings.reduce((n, m) => n + m.proposed, 0)
		}
	};
};

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
	upload: async ({ request, locals }) => {
		const data = await request.formData();
		const files = data.getAll('documents').filter((f): f is File => f instanceof File && f.size > 0);
		if (!files.length) return formFailure(new ValidationError('Choose a PDF, Word or text file.'));
		try {
			const results = await uploadLibraryDocuments(
				appDatabase(),
				uiActor(locals),
				loadConfig().filesDir,
				await Promise.all(
					files.map(async (f) => ({
						name: f.name,
						type: f.type,
						bytes: new Uint8Array(await f.arrayBuffer())
					}))
				)
			);
			const added = results.filter((r) => r.document);
			const notes = results.flatMap((r) =>
				r.duplicateOf
					? [`${r.filename} is already here as ${r.duplicateOf.title}.`]
					: r.error
						? [`${r.filename}: ${r.error}`]
						: []
			);
			return {
				success: `${added.length} ${added.length === 1 ? 'document' : 'documents'} added.${notes.length ? ` ${notes.join(' ')}` : ''}`,
				uploaded: added[0]?.document?.id ?? null
			};
		} catch (e) {
			return formFailure(e);
		}
	}
};
