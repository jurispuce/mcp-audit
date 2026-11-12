import { listJobs } from '#lib/domain/jobs.ts';
import {
	acceptAllProposals,
	acceptProposalItem,
	isProposalType,
	listProposals,
	rejectProposalItem
} from '#lib/domain/proposals.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const app = appDatabase();
	const t = url.searchParams.get('type');
	const type = isProposalType(t) ? t : undefined;
	return {
		type: type ?? null,
		items: listProposals(app, params.e, type),
		jobs: listJobs(app, { engagementId: params.e }, { limit: 10 })
	};
};

function typeOf(data: FormData) {
	const t = String(data.get('type') ?? '');
	if (!isProposalType(t)) throw new ValidationError('Unknown proposal type.');
	return t;
}

export const actions: Actions = {
	accept: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			acceptProposalItem(appDatabase(), uiActor(locals), params.e, typeOf(data), String(data.get('id')));
			return { success: 'Proposal accepted.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			rejectProposalItem(appDatabase(), uiActor(locals), params.e, typeOf(data), String(data.get('id')));
			return { success: 'Proposal rejected.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptAll: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const types = data.getAll('type').map(String).filter(isProposalType);
			let n = 0;
			if (types.length === 0) n = acceptAllProposals(appDatabase(), uiActor(locals), params.e);
			for (const t of types) n += acceptAllProposals(appDatabase(), uiActor(locals), params.e, t);
			return { success: `${n} ${n === 1 ? 'proposal' : 'proposals'} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	}
};
