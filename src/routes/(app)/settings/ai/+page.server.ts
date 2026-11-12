import { error } from '@sveltejs/kit';
import {
	AI_ACTION_KEYS,
	AI_ACTIONS,
	assignModels,
	checkModel,
	gatewayModels,
	getAiSettings,
	removeModel,
	saveGateway,
	type AiAction
} from '#lib/domain/ai-settings.ts';
import { isAdmin } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const app = appDatabase();
	if (!isAdmin(app, uiActor(locals))) error(403, { message: 'Only an admin can change AI settings.' });
	return {
		settings: getAiSettings(app),
		actions: AI_ACTION_KEYS.map((key) => ({
			key,
			label: AI_ACTIONS[key].label,
			skill: AI_ACTIONS[key].skill
		}))
	};
};

export const actions: Actions = {
	gateway: async ({ request, locals }) => {
		const data = await request.formData();
		const values = { base_url: String(data.get('base_url') ?? '') };
		try {
			saveGateway(appDatabase(), uiActor(locals), {
				baseUrl: values.base_url,
				apiKey: String(data.get('api_key') ?? ''),
				clearKey: data.get('clear_key') === 'on'
			});
			return { action: 'gateway', success: 'Gateway saved.' };
		} catch (e) {
			return formFailure(e, { ...values, action: 'gateway' });
		}
	},
	list: async ({ locals }) => {
		try {
			const models = await gatewayModels(appDatabase(), uiActor(locals));
			return {
				action: 'list',
				available: models,
				success: models.length
					? `The gateway offers ${models.length} ${models.length === 1 ? 'model' : 'models'}.`
					: 'The gateway lists no models.'
			};
		} catch (e) {
			return formFailure(e, { action: 'list' });
		}
	},
	check: async ({ request, locals }) => {
		const data = await request.formData();
		const model = String(data.get('model') ?? '');
		try {
			const res = await checkModel(appDatabase(), uiActor(locals), model);
			return res.check?.ok
				? { action: 'check', model: res.id, success: `${res.id} passed the tool-calling check.` }
				: {
						action: 'check',
						model: res.id,
						message: `${res.id} failed the tool-calling check: ${res.check?.message ?? 'no answer'}`
					};
		} catch (e) {
			return formFailure(e, { model, action: 'check' });
		}
	},
	remove: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			removeModel(appDatabase(), uiActor(locals), String(data.get('model') ?? ''));
			return { action: 'remove', success: 'Model removed.' };
		} catch (e) {
			return formFailure(e, { action: 'remove' });
		}
	},
	assign: async ({ request, locals }) => {
		const data = await request.formData();
		const input: Partial<Record<AiAction | 'default', string | null>> = {
			default: String(data.get('default') ?? '') || null
		};
		for (const key of AI_ACTION_KEYS) input[key] = String(data.get(key) ?? '') || null;
		try {
			assignModels(appDatabase(), uiActor(locals), input);
			return { action: 'assign', success: 'Models per action saved.' };
		} catch (e) {
			return formFailure(e, { action: 'assign' });
		}
	}
};
