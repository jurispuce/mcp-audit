import {
	addMentionedDocument,
	ARTIFACT_KINDS,
	KIND_LABELS,
	listArtifacts,
	removeArtifact,
	updateArtifact,
	uploadArtifacts
} from '#lib/domain/artifacts.ts';
import {
	carriedOverDocuments,
	recheckMessage,
	sectionsWithoutRequirements,
	uploadNewVersion,
	versionsNeedingReview
} from '#lib/domain/document-versions.ts';
import { updateEngagement } from '#lib/domain/engagements.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import {
	acceptAllInternal,
	acceptInternal,
	acceptRecheckProposal,
	addInternal,
	carryOverCandidates,
	keepInternal,
	listInternal,
	rejectInternal,
	rejectRecheckProposal,
	removeAfterRecheck
} from '#lib/domain/internal.ts';
import { listSelected } from '#lib/domain/selection.ts';
import { loadConfig } from '#lib/server/config.ts';
import { bulkMessage, reviewProposalItems } from '#lib/domain/proposals.ts';
import { linkReceivedDocuments } from '#lib/domain/received-documents.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	return {
		documents: listArtifacts(app, params.e),
		internal: listInternal(app, params.e),
		carryOver: carryOverCandidates(app, params.e).length,
		// Documents of earlier engagements whose rules are carried over: they can get a new version here.
		carried: carriedOverDocuments(app, params.e),
		// "3 internal requirements need review after a new version of X" (#76).
		toReview: versionsNeedingReview(app, params.e),
		openSections: Object.fromEntries(
			[...sectionsWithoutRequirements(app, params.e)].map(([id, hs]) => [
				id,
				hs.map((h) => ({ number: h.number, title: h.title }))
			])
		),
		requirements: listSelected(app, params.e).map((s) => ({
			id: s.requirementId,
			refCode: s.refCode,
			title: s.pinned.title
		})),
		kinds: ARTIFACT_KINDS.map((k) => [k, KIND_LABELS[k]!] as [string, string])
	};
};

const META = ['title', 'kind', 'version_label', 'approval_date', 'language'];

export const actions: Actions = {
	upload: async ({ request, locals, params }) => {
		const data = await request.formData();
		const files = data.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
		if (!files.length) return formFailure(new ValidationError('Choose one or more files.'));
		try {
			const results = await uploadArtifacts(
				appDatabase(),
				uiActor(locals),
				loadConfig().filesDir,
				params.e,
				await Promise.all(
					files.map(async (f) => ({
						name: f.name,
						type: f.type,
						bytes: new Uint8Array(await f.arrayBuffer())
					}))
				)
			);
			const added = results.filter((r) => r.artifact).length;
			const notes = results.flatMap((r) =>
				r.duplicateOf
					? [`${r.filename} is already here as ${r.duplicateOf.displayName}.`]
					: r.error
						? [`${r.filename}: ${r.error}`]
						: []
			);
			// Planned evidence the new documents answer is proposed as links right away (#83).
			const linkable = linkReceivedDocuments(appDatabase(), uiActor(locals), params.e).length;
			return {
				success: `${added} ${added === 1 ? 'document' : 'documents'} added.${notes.length ? ` ${notes.join(' ')}` : ''}${linkable ? ` ${linkable} planned evidence ${linkable === 1 ? 'item matches' : 'items match'} these documents: the links are proposed on each event's Run screen and on Proposals.` : ''}`
			};
		} catch (e) {
			return formFailure(e);
		}
	},
	newVersion: async ({ request, locals, params }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const file = data.get('file');
		if (!(file instanceof File) || file.size === 0)
			return formFailure(new ValidationError('Choose the new file.'), { id, action: 'newVersion' });
		try {
			const app = appDatabase();
			const { artifact, recheck } = await uploadNewVersion(
				app,
				uiActor(locals),
				loadConfig().filesDir,
				params.e,
				id,
				{ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
			);
			const checked = recheckMessage(recheck);
			return { success: `${artifact.displayName} added as the new version.${checked ? ` ${checked}` : ''}` };
		} catch (e) {
			return formFailure(e, { id, action: 'newVersion' });
		}
	},
	meta: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const values = formValues(data, META);
		try {
			updateArtifact(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), {
				title: values.title || null,
				kind: values.kind || null,
				version_label: values.version_label || null,
				approval_date: values.approval_date || null,
				language: values.language || null
			});
			return { success: 'Document saved.' };
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'meta' });
		}
	},
	mention: async ({ request, locals, params }) => {
		const values = formValues(await request.formData(), ['title', 'kind']);
		try {
			addMentionedDocument(appDatabase(), uiActor(locals), params.e, values.title ?? '', {
				kind: values.kind || null
			});
			return { success: `${values.title} recorded as mentioned, not received yet.` };
		} catch (e) {
			return formFailure(e, { ...values, action: 'mention' });
		}
	},
	remove: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			removeArtifact(appDatabase(), uiActor(locals), String(data.get('id')));
			return { success: 'Document removed from the engagement.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	addInternal: async ({ request, locals, params }) => {
		const data = await request.formData();
		const values = formValues(data, [
			'title',
			'text',
			'quote',
			'section',
			'artifact',
			'implements',
			'coverage'
		]);
		try {
			addInternal(appDatabase(), uiActor(locals), params.e, {
				title: values.title ?? '',
				text: values.text || null,
				quote: values.quote || null,
				section: values.section || null,
				artifactId: values.artifact || null,
				implements: values.implements
					? [{ requirementId: values.implements, coverage: values.coverage === 'full' ? 'full' : 'partial' }]
					: []
			});
			return { success: 'Internal requirement added.' };
		} catch (e) {
			return formFailure(e, { ...values, action: 'addInternal' });
		}
	},
	accept: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const r = acceptInternal(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: `${r.refCode} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const outcome = rejectInternal(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return {
				success:
					outcome === 'restored'
						? 'Change rejected; the accepted version is back.'
						: 'Internal requirement rejected.'
			};
		} catch (e) {
			return formFailure(e);
		}
	},
	keep: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const r = keepInternal(appDatabase(), uiActor(locals), params.e, String(data.get('id')), {
				useNewPassage: data.get('use_new_passage') === 'true'
			});
			return { success: `${r.refCode} kept.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	removeReview: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			removeAfterRecheck(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: 'Internal requirement removed.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptRecheck: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const outcome = acceptRecheckProposal(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return {
				success: outcome === 'removed' ? 'Internal requirement removed.' : 'Update accepted.'
			};
		} catch (e) {
			return formFailure(e);
		}
	},
	rejectRecheck: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			rejectRecheckProposal(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: 'Proposal rejected; the requirement still needs review.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptRecheckSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'recheck', ids, 'accept');
			return { success: bulkMessage(r, 'accept') };
		} catch (e) {
			return formFailure(e);
		}
	},
	rejectRecheckSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'recheck', ids, 'reject');
			return { success: bulkMessage(r, 'reject') };
		} catch (e) {
			return formFailure(e);
		}
	},
	keepSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'recheck', ids, 'accept');
			return { success: bulkMessage(r, 'accept', ['kept', 'removed']) };
		} catch (e) {
			return formFailure(e);
		}
	},
	removeSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'recheck', ids, 'reject');
			return { success: bulkMessage(r, 'reject', ['kept', 'removed']) };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'internal', ids, 'accept');
			return { success: bulkMessage(r, 'accept') };
		} catch (e) {
			return formFailure(e);
		}
	},
	rejectSelected: async ({ request, locals, params }) => {
		const ids = (await request.formData()).getAll('ids').map(String);
		try {
			const r = reviewProposalItems(appDatabase(), uiActor(locals), params.e, 'internal', ids, 'reject');
			return { success: bulkMessage(r, 'reject') };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptAll: async ({ locals, params }) => {
		try {
			const n = acceptAllInternal(appDatabase(), uiActor(locals), params.e);
			return { success: `${n} proposed internal ${n === 1 ? 'requirement' : 'requirements'} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	carryOver: async ({ request, locals, params }) => {
		const data = await request.formData();
		const on = data.get('on') === 'true';
		try {
			updateEngagement(appDatabase(), uiActor(locals), params.e, Number(data.get('base_version')), {
				carry_over_internal: on
			});
			return {
				success: on
					? 'Internal requirements from earlier engagements are carried over.'
					: 'Carry-over switched off.'
			};
		} catch (e) {
			return formFailure(e);
		}
	}
};
