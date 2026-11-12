import type { RequestEvent } from '@sveltejs/kit';
import { findingScaleOf } from '#lib/domain/engagements.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import {
	acceptProposal,
	approveAllDrafts,
	approveFinding,
	rejectProposal,
	reopenFinding,
	saveDraft,
	unitCards
} from '#lib/domain/findings.ts';
import { appDatabase } from './db';
import { formFailure, uiActor } from './http';

/** Data every Findings tab needs: the unit cards and the engagement's finding scale. */
export function findingsData(engagementId: string) {
	const app = appDatabase();
	const cards = unitCards(app, engagementId).map((c) => ({
		...c,
		suspectedIssues: c.suspectedIssues.map((n) => ({ ...n, at: n.at.toISOString() })),
		finding: c.finding && { ...c.finding, approvedAt: c.finding.approvedAt?.toISOString() ?? null }
	}));
	return { cards, scale: findingScaleOf(app, engagementId) };
}

export const findingActions = {
	save: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		const unit = String(data.get('unit'));
		const values = {
			finding_value_id: String(data.get('finding_value_id') ?? ''),
			rationale: String(data.get('rationale') ?? ''),
			confidence: String(data.get('confidence') ?? ''),
			evidence: data.getAll('evidence').map(String).join(','),
			unit,
			action: 'save'
		};
		try {
			saveDraft(
				appDatabase(),
				uiActor(locals),
				String(params.e),
				unit,
				{
					findingValueId: values.finding_value_id || null,
					rationale: values.rationale || null,
					confidence: values.confidence || null,
					evidenceItemIds: data.getAll('evidence').map(String)
				},
				data.get('base_version') ? Number(data.get('base_version')) : undefined
			);
			return { success: 'Draft saved.', unit };
		} catch (e) {
			return formFailure(e, values);
		}
	},
	accept: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		try {
			acceptProposal(appDatabase(), uiActor(locals), String(params.e), String(data.get('id')));
			return { success: 'Proposal accepted as a draft.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		try {
			rejectProposal(appDatabase(), uiActor(locals), String(params.e), String(data.get('id')));
			return { success: 'Proposal rejected.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	approve: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		try {
			approveFinding(
				appDatabase(),
				uiActor(locals),
				String(params.e),
				String(data.get('id')),
				Number(data.get('base_version'))
			);
			return { success: 'Approved. The finding is now a conclusion.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	reopen: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		try {
			reopenFinding(appDatabase(), uiActor(locals), String(params.e), String(data.get('id')));
			return { success: 'Reopened as a draft.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	approveAll: async ({ locals, params }: RequestEvent) => {
		try {
			const n = approveAllDrafts(appDatabase(), uiActor(locals), String(params.e));
			if (!n) throw new ValidationError('No drafts with a finding value to approve.');
			return { success: `${n} ${n === 1 ? 'draft' : 'drafts'} approved.` };
		} catch (e) {
			return formFailure(e);
		}
	}
};
