import { error } from '@sveltejs/kit';
import { listArtifacts } from '#lib/domain/artifacts.ts';
import { NotFoundError } from '#lib/domain/errors.ts';
import {
	addNote,
	listLinks,
	listNotes,
	mentionOptions,
	removeNote,
	setEventHeld,
	type Mention,
	type NoteType
} from '#lib/domain/execution.ts';
import {
	EVIDENCE_STATUSES,
	getEvent,
	listEvidence,
	STATUS_LABELS,
	updateEvidence
} from '#lib/domain/planning.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import { captureAction, linkActions } from '#lib/server/run.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	try {
		const event = getEvent(app, params.e, params.event);
		return {
			event,
			evidence: listEvidence(app, params.e, { eventId: event.id }).filter((x) => !x.proposed),
			notes: listNotes(app, params.e, { eventId: event.id }).map((n) => ({ ...n, at: n.at.toISOString() })),
			artifacts: listArtifacts(app, params.e, { eventId: event.id }).map((a) => ({
				id: a.id,
				title: a.displayName,
				filename: a.filename,
				kind: a.kind,
				state: a.state,
				mimeType: a.mimeType,
				textStatus: a.textStatus
			})),
			links: listLinks(app, params.e, { eventId: event.id }),
			mentions: mentionOptions(app, params.e, event.id),
			statuses: EVIDENCE_STATUSES.map((s) => [s, STATUS_LABELS[s]] as [string, string])
		};
	} catch (e) {
		if (e instanceof NotFoundError) error(404, { message: 'Event not found' });
		throw e;
	}
};

export const actions: Actions = {
	...linkActions,
	capture: captureAction,
	held: async ({ request, locals, params }) => {
		const held = (await request.formData()).get('held') === 'true';
		try {
			setEventHeld(appDatabase(), uiActor(locals), params.e, params.event, held);
			return { success: held ? 'Event marked held.' : 'Event marked planned again.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	status: async ({ request, locals, params }) => {
		const data = await request.formData();
		const values = formValues(data, ['status', 'promised_by', 'promised_due']);
		try {
			updateEvidence(
				appDatabase(),
				uiActor(locals),
				params.e,
				String(data.get('id')),
				Number(data.get('base_version')),
				{
					status: values.status,
					...(values.status === 'promised'
						? { promised_by: values.promised_by || null, promised_due: values.promised_due || null }
						: {})
				}
			);
			return { success: 'Evidence updated.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	note: async ({ request, locals, params }) => {
		const data = await request.formData();
		const text = String(data.get('text') ?? '');
		let mentions = parseMentionField(data.get('mentions'));
		// Keep only mentions whose label is still in the text.
		mentions = mentions.filter((m) => text.includes(`@${m.label}`));
		try {
			const { effects } = addNote(appDatabase(), uiActor(locals), params.e, params.event, {
				type: String(data.get('type') || 'note') as NoteType,
				text,
				mentions
			});
			return {
				success: effects.length ? `Note saved. ${effects.join('. ')}.` : 'Note saved.',
				noteSaved: true
			};
		} catch (e) {
			return formFailure(e, { text, action: 'note' });
		}
	},
	removeNote: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			removeNote(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: 'Note removed.' };
		} catch (e) {
			return formFailure(e);
		}
	}
};

function parseMentionField(v: FormDataEntryValue | null): Mention[] {
	try {
		const list = JSON.parse(String(v || '[]'));
		return Array.isArray(list) ? (list as Mention[]) : [];
	} catch {
		return [];
	}
}
