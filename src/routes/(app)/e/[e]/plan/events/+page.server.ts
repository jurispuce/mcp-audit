import { redirect } from '@sveltejs/kit';
import {
	acceptAllEvents,
	acceptEvent,
	addEvent,
	addEvidence,
	EVIDENCE_KINDS,
	EVIDENCE_STATUSES,
	KIND_LABELS,
	listEvents,
	listEvidence,
	rejectEvent,
	removeEvent,
	removeEvidence,
	STATUS_LABELS,
	updateEvent,
	updateEvidence,
	type EventInput,
	type EvidenceInput
} from '#lib/domain/planning.ts';
import { criticalityOf } from '#lib/domain/risks.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import { planChoices, planHeader, planStatusAction } from '#lib/server/plan.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = appDatabase();
	const crit = criticalityOf(app, params.e);
	return {
		plan: planHeader(params.e),
		events: listEvents(app, params.e),
		evidence: listEvidence(app, params.e),
		...planChoices(params.e),
		criticality: Object.fromEntries([...crit].map(([id, c]) => [id, c.level])),
		kinds: EVIDENCE_KINDS.map((k) => [k, KIND_LABELS[k]] as [string, string]),
		statuses: EVIDENCE_STATUSES.map((k) => [k, STATUS_LABELS[k]] as [string, string])
	};
};

const EVENT_FIELDS = [
	'title',
	'format',
	'date',
	'start_time',
	'duration_min',
	'participants_note',
	'location',
	'status'
];

function eventInput(data: FormData): { values: Record<string, string>; input: EventInput } {
	const values = formValues(data, EVENT_FIELDS);
	const input: EventInput = {
		title: values.title,
		format: values.format,
		date: values.date || null,
		start_time: values.start_time || null,
		duration_min: values.duration_min || 60,
		participant_ids: data.getAll('participant').map(String),
		participants_note: values.participants_note || null,
		requirement_ids: data.getAll('requirement').map(String),
		location: values.location || null
	};
	if (values.status) input.status = values.status;
	return {
		values: {
			...values,
			participant_ids: input.participant_ids!.join(','),
			requirement_ids: input.requirement_ids!.join(',')
		},
		input
	};
}

function evidenceInput(data: FormData): { values: Record<string, string>; input: EvidenceInput } {
	const values = formValues(data, [
		'text',
		'kind',
		'criticality',
		'scope_id',
		'status',
		'promised_by',
		'promised_due'
	]);
	const input: EvidenceInput = {
		text: values.text,
		kind: values.kind,
		criticality: values.criticality || null,
		requirement_ids: data.getAll('requirement').map(String),
		scope_id: values.scope_id || null
	};
	if (values.status) {
		input.status = values.status;
		input.promised_by = values.promised_by || null;
		input.promised_due = values.promised_due || null;
	}
	return { values: { ...values, requirement_ids: input.requirement_ids!.join(',') }, input };
}

export const actions: Actions = {
	planStatus: planStatusAction,
	add: async ({ request, locals, params }) => {
		const { values, input } = eventInput(await request.formData());
		try {
			addEvent(appDatabase(), uiActor(locals), params.e, input);
			return { success: `Event ${input.title} added.` };
		} catch (e) {
			return formFailure(e, { ...values, action: 'add' });
		}
	},
	update: async ({ request, locals, params }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const { values, input } = eventInput(data);
		try {
			updateEvent(appDatabase(), uiActor(locals), params.e, id, Number(data.get('base_version')), input);
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'update' });
		}
		redirect(303, `/e/${params.e}/plan/events#event-${id}`);
	},
	remove: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			removeEvent(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: 'Event removed with its planned evidence.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	accept: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const ev = acceptEvent(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: `${ev.title} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			rejectEvent(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: 'Drafted event rejected.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptAll: async ({ locals, params }) => {
		try {
			const n = acceptAllEvents(appDatabase(), uiActor(locals), params.e);
			return { success: `${n} drafted ${n === 1 ? 'event' : 'events'} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	addEvidence: async ({ request, locals, params }) => {
		const data = await request.formData();
		const eventId = String(data.get('event_id'));
		const { values, input } = evidenceInput(data);
		try {
			addEvidence(appDatabase(), uiActor(locals), params.e, eventId, input);
			return { success: 'Planned evidence added.' };
		} catch (e) {
			return formFailure(e, { ...values, event_id: eventId, action: 'addEvidence' });
		}
	},
	updateEvidence: async ({ request, locals, params }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const { values, input } = evidenceInput(data);
		try {
			updateEvidence(appDatabase(), uiActor(locals), params.e, id, Number(data.get('base_version')), input);
			return { success: 'Planned evidence saved.' };
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'updateEvidence' });
		}
	},
	removeEvidence: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			removeEvidence(appDatabase(), uiActor(locals), params.e, String(data.get('id')));
			return { success: 'Planned evidence removed.' };
		} catch (e) {
			return formFailure(e);
		}
	}
};
