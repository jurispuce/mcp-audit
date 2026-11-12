import { getAuditee, updateAuditee } from '#lib/domain/engagements.ts';
import {
	acceptAllPeople,
	acceptPerson,
	addPerson,
	cleanList,
	listPeople,
	rejectPerson,
	updatePerson
} from '#lib/domain/people.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { engagement } = await parent();
	const app = appDatabase();
	return { auditee: getAuditee(app, engagement.auditeeId), people: listPeople(app, engagement.auditeeId) };
};

const PERSON = ['role', 'name', 'unit', 'email', 'responsibilities'];
const personInput = (v: Record<string, string>) => ({
	role: v.role ?? '',
	name: v.name || null,
	unit: v.unit || null,
	email: v.email || null,
	responsibilities: cleanList((v.responsibilities ?? '').split('\n'))
});

export const actions: Actions = {
	description: async ({ request, locals }) => {
		const data = await request.formData();
		const values = formValues(data, ['description']);
		try {
			const app = appDatabase();
			const auditeeId = String(data.get('auditee_id'));
			updateAuditee(app, uiActor(locals), auditeeId, Number(data.get('base_version')), {
				description: values.description || null
			});
			return { success: 'Auditee description saved.' };
		} catch (e) {
			return formFailure(e, { ...values, action: 'description' });
		}
	},
	add: async ({ request, locals }) => {
		const data = await request.formData();
		const values = formValues(data, PERSON);
		try {
			addPerson(appDatabase(), uiActor(locals), String(data.get('auditee_id')), personInput(values));
			return { success: `${values.role} added.` };
		} catch (e) {
			return formFailure(e, { ...values, action: 'add' });
		}
	},
	update: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const values = formValues(data, PERSON);
		try {
			updatePerson(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), personInput(values));
			return { success: `${values.role} saved.` };
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'update' });
		}
	},
	accept: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			const p = acceptPerson(appDatabase(), uiActor(locals), String(data.get('id')));
			return { success: `${p.role} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	reject: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			rejectPerson(appDatabase(), uiActor(locals), String(data.get('id')));
			return { success: data.get('proposed') === 'true' ? 'Proposal rejected.' : 'Role removed.' };
		} catch (e) {
			return formFailure(e);
		}
	},
	acceptAll: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			const n = acceptAllPeople(appDatabase(), uiActor(locals), String(data.get('auditee_id')));
			return { success: `${n} proposed ${n === 1 ? 'role' : 'roles'} accepted.` };
		} catch (e) {
			return formFailure(e);
		}
	}
};
