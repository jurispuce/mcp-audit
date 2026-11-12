import { listScopes } from '#lib/domain/engagements.ts';
import { addRisk, listRisks, removeRisk, RISK_LEVELS, RISK_ORIGINS, updateRisk } from '#lib/domain/risks.ts';
import { listSelected } from '#lib/domain/selection.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	return {
		risks: listRisks(app, params.e),
		requirements: listSelected(app, params.e).map((s) => ({
			id: s.requirementId,
			refCode: s.refCode,
			title: s.pinned.title
		})),
		scopes: listScopes(app, params.e).map((s) => ({ id: s.id, name: s.name })),
		levels: RISK_LEVELS,
		origins: RISK_ORIGINS
	};
};

function riskInput(data: FormData) {
	const values = formValues(data, ['title', 'description', 'level', 'origin']);
	return {
		values,
		input: {
			title: values.title ?? '',
			description: values.description || null,
			level: values.level,
			origin: values.origin,
			requirement_ids: data.getAll('requirement').map(String),
			scope_ids: data.getAll('scope').map(String)
		}
	};
}

export const actions: Actions = {
	add: async ({ request, locals, params }) => {
		const { values, input } = riskInput(await request.formData());
		try {
			addRisk(appDatabase(), uiActor(locals), params.e, input);
			return { success: `Risk ${input.title} added.` };
		} catch (e) {
			return formFailure(e, {
				...values,
				action: 'add',
				requirements: input.requirement_ids.join(','),
				scopes: input.scope_ids.join(',')
			});
		}
	},
	update: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const { values, input } = riskInput(data);
		try {
			updateRisk(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), input);
			return { success: 'Risk saved.' };
		} catch (e) {
			return formFailure(e, {
				...values,
				id,
				action: 'update',
				requirements: input.requirement_ids.join(','),
				scopes: input.scope_ids.join(',')
			});
		}
	},
	remove: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			removeRisk(appDatabase(), uiActor(locals), String(data.get('id')));
			return { success: 'Risk removed.' };
		} catch (e) {
			return formFailure(e);
		}
	}
};
