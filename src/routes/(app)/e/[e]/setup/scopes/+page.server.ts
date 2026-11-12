import { listScopes } from '#lib/domain/engagements.ts';
import {
	addScope,
	countUnits,
	removeScope,
	setScopeMode,
	unitsInScope,
	updateScope
} from '#lib/domain/selection.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	return {
		scopes: listScopes(app, params.e).map((s) => ({ ...s, units: unitsInScope(app, s.id) })),
		units: countUnits(app, params.e)
	};
};

export const actions: Actions = {
	mode: async ({ request, locals, params }) => {
		const data = await request.formData();
		const mode = data.get('mode') === 'multiple' ? 'multiple' : 'single';
		try {
			setScopeMode(appDatabase(), uiActor(locals), params.e, Number(data.get('base_version')), mode);
			return { success: mode === 'multiple' ? 'Multiple scopes.' : 'Single scope.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	add: async ({ request, locals, params }) => {
		const values = formValues(await request.formData(), ['name', 'description']);
		try {
			addScope(appDatabase(), uiActor(locals), params.e, {
				name: values.name ?? '',
				description: values.description || null
			});
			return { success: `Scope ${values.name} added.` };
		} catch (e) {
			return formFailure(e, { ...values, action: 'add' });
		}
	},
	rename: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const values = formValues(data, ['name']);
		try {
			updateScope(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), {
				name: values.name
			});
			return { success: 'Scope renamed.' };
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'rename' });
		}
	},
	remove: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const app = appDatabase();
		const units = unitsInScope(app, id);
		// A scope with assessment units holds (or will hold) findings: ask before removing it.
		if (units > 0 && data.get('confirm') !== 'yes')
			return { confirmRemove: { id, units, name: String(data.get('name') ?? '') } };
		try {
			removeScope(app, uiActor(locals), id, Number(data.get('base_version')));
			return { success: 'Scope removed.' };
		} catch (e) {
			return formFailure(e, { id, action: 'remove' });
		}
	}
};
