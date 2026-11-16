import { ValidationError } from '#lib/domain/errors.ts';
import {
	bulkMessage,
	isProposalType,
	reviewProposalItems,
	type BulkResult,
	type ProposalType
} from '#lib/domain/proposals.ts';
import { appDatabase } from './db';
import { formFailure, uiActor } from './http';

/**
 * A form action for the selection bar where items of several types sit together (the Proposals
 * list, Plan, Events): values arrive as "type:id", and each type goes through its own rules.
 */
export async function reviewSelected(
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
			const i = v.indexOf(':');
			const [t, id] = [v.slice(0, i), v.slice(i + 1)];
			if (i < 1 || !isProposalType(t) || !id) throw new ValidationError('Unknown proposal in the selection.');
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
