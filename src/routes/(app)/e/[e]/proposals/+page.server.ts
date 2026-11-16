import { listJobs } from '#lib/domain/jobs.ts';
import {
	acceptAllProposals,
	acceptProposalItem,
	isProposalType,
	listProposals,
	rejectProposalItem,
	bulkMessage,
	reviewProposalItems,
	type BulkResult,
	type ProposalType
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

/** Selected proposals arrive as "type:id"; each type goes through its own accept or reject rules. */
async function bulk(
	request: Request,
	locals: App.Locals,
	engagementId: string,
	verdict: 'accept' | 'reject'
) {
	const values = (await request.formData()).getAll('ids').map(String);
	try {
		if (values.length === 0) throw new ValidationError('Select at least one proposal.');
		const byType = new Map<ProposalType, string[]>();
		for (const v of values) {
			const [t, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
			if (!isProposalType(t) || !id) throw new ValidationError('Unknown proposal in the selection.');
			byType.set(t, [...(byType.get(t) ?? []), id]);
		}
		const total: BulkResult = { done: 0, skipped: [] };
		for (const [t, ids] of byType) {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), engagementId, t, ids, verdict);
			total.done += r.done;
			total.skipped.push(...r.skipped);
		}
		return { success: bulkMessage(total, verdict) };
	} catch (e) {
		return formFailure(e);
	}
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
	acceptSelected: async ({ request, locals, params }) => bulk(request, locals, params.e, 'accept'),
	rejectSelected: async ({ request, locals, params }) => bulk(request, locals, params.e, 'reject'),
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
