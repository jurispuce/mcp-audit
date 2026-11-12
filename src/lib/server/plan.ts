import type { RequestEvent } from '@sveltejs/kit';
import { getEngagement } from '#lib/domain/engagements.ts';
import { listPeople } from '#lib/domain/people.ts';
import {
	PLAN_STATUSES,
	personLabel,
	planState,
	setPlanStatus,
	type PlanStatus
} from '#lib/domain/planning.ts';
import { listScopes } from '#lib/domain/engagements.ts';
import { listSelected } from '#lib/domain/selection.ts';
import { appDatabase } from './db';
import { formFailure, uiActor } from './http';

/** What every Plan tab shows in its header: the plan status as a whole. */
export function planHeader(engagementId: string) {
	const app = appDatabase();
	const s = planState(app, getEngagement(app, engagementId));
	return { status: s.status, at: s.at?.toISOString() ?? null, changedSince: s.changedSince, next: s.next };
}

/** Choices for event and evidence forms. */
export function planChoices(engagementId: string) {
	const app = appDatabase();
	const e = getEngagement(app, engagementId);
	return {
		people: listPeople(app, e.auditeeId)
			.filter((p) => p.status === 'confirmed')
			.map((p) => ({ id: p.id, label: personLabel(p) })),
		requirements: listSelected(app, e.id).map((s) => ({
			id: s.requirementId,
			refCode: s.refCode,
			title: s.pinned.title
		})),
		scopes: listScopes(app, e.id).map((s) => ({ id: s.id, name: s.name }))
	};
}

/** The form action behind the plan header's buttons, shared by every Plan tab. */
export async function planStatusAction({ request, locals, params }: RequestEvent) {
	const data = await request.formData();
	const to = String(data.get('to')) as PlanStatus;
	if (!(PLAN_STATUSES as readonly string[]).includes(to)) return formFailure(new Error('bad status'));
	try {
		setPlanStatus(appDatabase(), uiActor(locals), String(params.e), Number(data.get('base_version')), to);
		const done: Record<PlanStatus, string> = {
			sent: 'Plan marked as sent to the auditee.',
			agreed: 'Plan agreed.',
			draft: 'Plan is a draft again.'
		};
		return { success: done[to] };
	} catch (e) {
		return formFailure(e);
	}
}
