import { listArtifacts, uploadArtifacts } from '#lib/domain/artifacts.ts';
import { listScopes } from '#lib/domain/engagements.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import { bulkMessage, reviewProposalItems } from '#lib/domain/proposals.ts';
import {
	acceptAllRisks,
	acceptRisk,
	addRisk,
	listRisks,
	rejectRisk,
	removeRisk,
	RISK_LEVELS,
	RISK_ORIGINS,
	updateRisk
} from '#lib/domain/risks.ts';
import { loadConfig } from '#lib/server/config.ts';
import { listSelected } from '#lib/domain/selection.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	return {
		risks: listRisks(app, params.e),
		registers: listArtifacts(app, params.e)
			.filter((a) => a.kind === 'risk_register' && a.state === 'received' && !a.replacedBy)
			.map((a) => ({
				id: a.id,
				name: a.displayName,
				filename: a.filename,
				textStatus: a.textStatus
			})),
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
	uploadRegister: async ({ request, locals, params }) => {
		const data = await request.formData();
		const file = data.get('file');
		if (!(file instanceof File) || file.size === 0)
			return formFailure(new ValidationError('Choose the risk register file.'));
		try {
			const [r] = await uploadArtifacts(
				appDatabase(),
				uiActor(locals),
				loadConfig().filesDir,
				params.e,
				[{ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }],
				{ kind: 'risk_register' }
			);
			if (r?.duplicateOf) return { success: `${file.name} is already here as ${r.duplicateOf.displayName}.` };
			if (!r?.artifact) throw new ValidationError(r?.error ?? 'The file could not be added.');
			const read = r.artifact.textStatus === 'extracted';
			return {
				success: read
					? `${r.artifact.displayName} added. Extract its risks with AI, or add them by hand.`
					: `${r.artifact.displayName} added, but its text could not be read. Upload it as PDF, Excel (.xlsx), Word (.docx), CSV or Markdown.`
			};
		} catch (e) {
			return formFailure(e);
		}
	},
	accept: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const r = acceptRisk(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: `${r.title} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			rejectRisk(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: 'Proposed risk rejected.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptAll: async ({ locals, params }) => {
		try {
			const n = acceptAllRisks(appDatabase(), uiActor(locals), params.e);
			return { success: `${n} proposed ${n === 1 ? 'risk' : 'risks'} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'risk', ids, 'accept');
			return { success: bulkMessage(r, 'accept') };
		} catch (e) {
			return formFailure(e);
		}
	},
	rejectSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'risk', ids, 'reject');
			return { success: bulkMessage(r, 'reject') };
		} catch (e) {
			return formFailure(e);
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
