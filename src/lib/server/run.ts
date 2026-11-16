import type { RequestEvent } from '@sveltejs/kit';
import { uploadArtifacts } from '#lib/domain/artifacts.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import {
	acceptAllLinks,
	addEvidenceLink,
	confirmLink,
	removeLink,
	type Sufficiency
} from '#lib/domain/execution.ts';
import { bulkMessage, reviewProposalItems } from '#lib/domain/proposals.ts';
import { appDatabase } from './db';
import { loadConfig } from './config';
import { formFailure, formValues, uiActor } from './http';

/** Accept or reject the selected proposed evidence links, each through its own rules. */
async function selectedLinks(
	request: Request,
	locals: App.Locals,
	params: RequestEvent['params'],
	verdict: 'accept' | 'reject'
) {
	const ids = (await request.formData()).getAll('ids').map(String);
	try {
		const r = reviewProposalItems(appDatabase(), uiActor(locals), String(params.e), 'link', ids, verdict);
		return { success: bulkMessage(r, verdict) };
	} catch (e) {
		return formFailure(e);
	}
}

/** Form actions for linking artifacts to planned evidence, shared by the event screen and the Inbox. */
export const linkActions = {
	link: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		const values = formValues(data, ['artifact', 'evidence', 'locator', 'excerpt', 'sufficiency']);
		try {
			if (!values.evidence)
				throw new ValidationError('Choose the planned evidence it shows.', { evidence: 'Required' });
			addEvidenceLink(appDatabase(), uiActor(locals), String(params.e), {
				artifactId: values.artifact!,
				evidenceItemId: values.evidence,
				locator: values.locator || null,
				excerpt: values.excerpt || null,
				sufficiency: (values.sufficiency || 'supports') as Sufficiency
			});
			return { success: 'Linked. The evidence is marked received.' };
		} catch (e) {
			return formFailure(e, { ...values, action: 'link' });
		}
	},
	confirmLink: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		try {
			confirmLink(appDatabase(), uiActor(locals), String(params.e), String(data.get('id')));
			return { success: 'Link accepted.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	removeLink: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		try {
			removeLink(appDatabase(), uiActor(locals), String(params.e), String(data.get('id')));
			return { success: data.get('proposed') === 'true' ? 'Proposed link rejected.' : 'Link removed.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptSelectedLinks: async ({ request, locals, params }: RequestEvent) =>
		selectedLinks(request, locals, params, 'accept'),
	rejectSelectedLinks: async ({ request, locals, params }: RequestEvent) =>
		selectedLinks(request, locals, params, 'reject'),
	acceptAllLinks: async ({ request, locals, params }: RequestEvent) => {
		const data = await request.formData();
		try {
			const n = acceptAllLinks(
				appDatabase(),
				uiActor(locals),
				String(params.e),
				data.get('event') ? { eventId: String(data.get('event')) } : {}
			);
			return { success: `${n} proposed ${n === 1 ? 'link' : 'links'} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	}
};

/** Upload files or a photo taken on the phone, attached to an event. */
export async function captureAction({ request, locals, params }: RequestEvent) {
	const data = await request.formData();
	const files = data.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
	if (!files.length) return formFailure(new ValidationError('Choose a file or take a photo.'));
	try {
		const results = await uploadArtifacts(
			appDatabase(),
			uiActor(locals),
			loadConfig().filesDir,
			String(params.e),
			await Promise.all(
				files.map(async (f) => ({
					name: f.name || 'photo.jpg',
					type: f.type,
					bytes: new Uint8Array(await f.arrayBuffer())
				}))
			),
			{ eventId: params.event ? String(params.event) : null }
		);
		const added = results.filter((r) => r.artifact).length;
		const dup = results
			.filter((r) => r.duplicateOf)
			.map((r) => `${r.filename} is already here as ${r.duplicateOf!.displayName}.`);
		return {
			success: `${added} ${added === 1 ? 'file' : 'files'} added.${dup.length ? ` ${dup.join(' ')}` : ''}`
		};
	} catch (e) {
		return formFailure(e);
	}
}
