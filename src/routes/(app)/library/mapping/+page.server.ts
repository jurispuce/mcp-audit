import { addLink, getSourceByCode, listSources } from '#lib/domain/library.ts';
import { acceptAllLinks, acceptLink, editLink, mappingOf, rejectLink } from '#lib/domain/library-review.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const app = appDatabase();
	const sources = listSources(app, { includeProposed: true });
	const from = getSourceByCode(app, url.searchParams.get('from') ?? '');
	const to = getSourceByCode(app, url.searchParams.get('to') ?? '');
	const onlyOpen = url.searchParams.get('open') === '1';
	const mapping = from && to && from.id !== to.id ? mappingOf(app, from.id, to.id) : null;
	return {
		sources: sources.map((s) => ({ id: s.id, code: s.code, title: s.title, status: s.status })),
		from,
		to,
		onlyOpen,
		mapping: mapping && {
			...mapping,
			rows: onlyOpen
				? mapping.rows.filter(
						(r) =>
							!r.links.some((l) => l.status === 'confirmed') || r.links.some((l) => l.status === 'proposed')
					)
				: mapping.rows
		}
	};
};

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		try {
			acceptLink(appDatabase(), uiActor(locals), String((await request.formData()).get('id')));
			return { success: 'Link accepted.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			rejectLink(appDatabase(), uiActor(locals), String(data.get('id')));
			return { success: data.get('proposed') === 'true' ? 'Proposed link rejected.' : 'Link removed.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	edit: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const values = formValues(data, ['type', 'coverage', 'note']);
		try {
			editLink(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), {
				type: values.type,
				coverage: values.type === 'implements' ? values.coverage || 'partial' : null,
				note: values.note || null
			});
			return { success: 'Link saved.' };
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'edit' });
		}
	},
	add: async ({ request, locals }) => {
		const data = await request.formData();
		const values = formValues(data, ['from', 'to', 'type', 'coverage', 'note']);
		try {
			addLink(appDatabase(), uiActor(locals), {
				fromId: values.from!,
				toId: values.to!,
				type: values.type!,
				coverage: values.type === 'implements' ? values.coverage || 'partial' : null,
				note: values.note || null
			});
			return { success: 'Link added.' };
		} catch (e) {
			return formFailure(e, { ...values, action: 'add' });
		}
	},
	acceptAll: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			const n = acceptAllLinks(
				appDatabase(),
				uiActor(locals),
				String(data.get('from')),
				String(data.get('to'))
			);
			return { success: `${n} proposed ${n === 1 ? 'link' : 'links'} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	}
};
