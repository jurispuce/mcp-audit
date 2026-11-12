import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { createEngagement, getEngagement, updateEngagement, type Engagement } from './engagements';
import { ForbiddenError, ValidationError } from './errors';
import { getItemHistory } from './items';
import { findRequirement, getSourceByCode } from './library';
import { importBuiltInSource } from './library-import';
import { engagementOverview } from './overview';
import { addPerson } from './people';
import {
	acceptAllEvents,
	acceptEvent,
	addEvent,
	addEvidence,
	coverage,
	listEvents,
	listEvidence,
	planState,
	rejectEvent,
	removeEvent,
	setEventRequirement,
	setPlanStatus,
	updateEvent,
	updateEvidence
} from './planning';
import { addRisk } from './risks';
import { selectRequirements } from './selection';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;
let e: Engagement;
const req = (p: string) => findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${p})`)!.id;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	ai = { userId: a.id, agent: 'Claude', channel: 'mcp' };
	importBuiltInSource(
		app,
		human,
		'nis2-art21.yaml',
		path.resolve(import.meta.dirname, '../../../seed/library')
	);
	e = createEngagement(app, human, {
		name: 'NIS 2 audit',
		auditeeName: 'Baltic Freight SIA',
		startDate: '2026-11-16'
	});
	selectRequirements(app, human, e.id, [req('b'), req('c'), req('i'), req('j')]);
});
afterEach(() => {
	app.close();
	vi.useRealTimers();
});

describe('planning schema (#45)', () => {
	it('stores events with format, date, time, duration, participants, requirements, status and the proposed flag', () => {
		const head = addPerson(app, human, e.auditeeId, { role: 'Head of IT', name: 'Ilze' });
		const ev = addEvent(app, human, e.id, {
			title: 'Access interview',
			format: 'interview',
			date: '2026-11-17',
			start_time: '10:00',
			duration_min: 90,
			participant_ids: [head.id],
			participants_note: 'Service desk lead',
			requirement_ids: [req('i'), req('j')]
		});
		expect(ev).toMatchObject({
			formatLabel: 'Interview',
			durationMin: 90,
			status: 'planned',
			proposed: false,
			participantsLine: 'Head of IT (Ilze), Service desk lead'
		});
		expect(ev.requirements.map((r) => r.refCode)).toEqual(['Art. 21(2)(i)', 'Art. 21(2)(j)']);
		expect(() => addEvent(app, human, e.id, { title: 'x', requirement_ids: [req('a')] })).toThrow(/selected/);
		expect(() => addEvent(app, human, e.id, { title: 'x', participant_ids: ['nobody'] })).toThrow(
			ValidationError
		);
		expect(() => addEvent(app, human, e.id, { title: 'x', start_time: '25:00' })).toThrow(ValidationError);
		expect(() => addEvent(app, human, e.id, { title: '' })).toThrow(ValidationError);
		expect(updateEvent(app, human, e.id, ev.id, ev.version, { status: 'held' }).status).toBe('held');
	});

	it('stores planned evidence with kind, criticality from the highest linked risk, requirements, scope and promise', () => {
		addRisk(app, human, e.id, { title: 'Leavers', level: 'high', requirement_ids: [req('i')] });
		const ev = addEvent(app, human, e.id, {
			title: 'Access interview',
			requirement_ids: [req('i'), req('b')]
		});
		const high = addEvidence(app, human, e.id, ev.id, {
			text: 'Leaver list 2026',
			requirement_ids: [req('i')]
		});
		const medium = addEvidence(app, human, e.id, ev.id, {
			text: 'Incident log',
			kind: 'record',
			requirement_ids: [req('b')]
		});
		expect(high).toMatchObject({
			criticality: 'high',
			kind: 'record',
			status: 'planned',
			scopeName: 'All scopes',
			requirementRefs: ['Art. 21(2)(i)']
		});
		expect(medium.criticality).toBe('medium');
		const promised = updateEvidence(app, human, e.id, medium.id, medium.version, {
			status: 'promised',
			promised_by: 'Head of IT',
			promised_due: '2026-11-20'
		});
		expect(promised).toMatchObject({
			status: 'promised',
			promisedBy: 'Head of IT',
			promisedDue: '2026-11-20'
		});
		expect(() => addEvidence(app, human, e.id, ev.id, { text: 'x', requirement_ids: [req('a')] })).toThrow(
			/selected/
		);
		expect(() => addEvidence(app, human, e.id, ev.id, { text: 'x', scope_id: 'nope' })).toThrow(/scope/i);
		expect(listEvents(app, e.id)[0]!.evidence).toEqual({ total: 2, received: 0, open: 2 });
	});

	it('sorts events by date and time, undated last', () => {
		addEvent(app, human, e.id, { title: 'Later', date: '2026-11-18', start_time: '09:00' });
		addEvent(app, human, e.id, { title: 'Undated' });
		addEvent(app, human, e.id, { title: 'Afternoon', date: '2026-11-17', start_time: '14:00' });
		addEvent(app, human, e.id, { title: 'Morning', date: '2026-11-17', start_time: '09:30' });
		expect(listEvents(app, e.id).map((x) => x.title)).toEqual(['Morning', 'Afternoon', 'Later', 'Undated']);
	});
});

describe('AI-drafted events (#46)', () => {
	it('are proposed, editable before acceptance, and only a person accepts or rejects them', () => {
		const draft = addEvent(app, ai, e.id, {
			title: 'Incident handling interview',
			requirement_ids: [req('b')]
		});
		expect(draft.proposed).toBe(true);
		expect(() => addEvent(app, ai, e.id, { title: 'x', proposed: 0 } as never)).toThrow(ForbiddenError);
		const evid = addEvidence(app, ai, e.id, draft.id, { text: 'Incident log for 2026' });
		expect(evid.proposed).toBe(true);
		const edited = updateEvent(app, human, e.id, draft.id, draft.version, { date: '2026-11-19' });
		expect(edited).toMatchObject({ proposed: true, date: '2026-11-19' });
		expect(() => acceptEvent(app, ai, e.id, draft.id)).toThrow(ForbiddenError);
		const accepted = acceptEvent(app, human, e.id, draft.id);
		expect(accepted.proposed).toBe(false);
		expect(listEvidence(app, e.id, { eventId: draft.id })[0]!.proposed).toBe(false);
		expect(getItemHistory(app, 'event', draft.id)[0]).toMatchObject({ note: 'Accepted' });
	});

	it('reject removes the draft with its evidence; accept all accepts the rest', () => {
		const a = addEvent(app, ai, e.id, { title: 'A' });
		addEvidence(app, ai, e.id, a.id, { text: 'x' });
		addEvent(app, ai, e.id, { title: 'B' });
		addEvent(app, ai, e.id, { title: 'C' });
		rejectEvent(app, human, e.id, a.id);
		expect(listEvidence(app, e.id)).toEqual([]);
		expect(acceptAllEvents(app, human, e.id)).toBe(2);
		expect(listEvents(app, e.id).map((x) => `${x.title}:${x.proposed}`)).toEqual(['B:false', 'C:false']);
	});

	it('removing an event removes its planned evidence, both kept in history', () => {
		const ev = addEvent(app, human, e.id, { title: 'Walkthrough', format: 'walkthrough' });
		const x = addEvidence(app, human, e.id, ev.id, { text: 'Server room access log' });
		removeEvent(app, human, e.id, ev.id);
		expect(listEvents(app, e.id)).toEqual([]);
		expect(getItemHistory(app, 'evidence_item', x.id)[0]!.summary).toBe('Deleted');
	});
});

describe('plan status (#47)', () => {
	it('goes draft, sent, agreed, back to draft and reopen; people only', () => {
		expect(() => setPlanStatus(app, ai, e.id, e.version, 'sent')).toThrow(ForbiddenError);
		expect(() => setPlanStatus(app, human, e.id, e.version, 'agreed')).toThrow(/draft/);
		let now = setPlanStatus(app, human, e.id, e.version, 'sent');
		expect(now.planStatus).toBe('sent');
		now = setPlanStatus(app, human, e.id, now.version, 'draft');
		now = setPlanStatus(app, human, e.id, now.version, 'sent');
		now = setPlanStatus(app, human, e.id, now.version, 'agreed');
		expect(planState(app, now)).toMatchObject({ status: 'agreed', changedSince: false, next: ['draft'] });
		now = setPlanStatus(app, human, e.id, now.version, 'draft');
		expect(getItemHistory(app, 'engagement', e.id)[0]).toMatchObject({ note: 'Plan reopened' });
		expect(() => updateEngagement(app, ai, e.id, now.version, { plan_status: 'sent' })).toThrow(
			ForbiddenError
		);
	});

	it('keeps events editable in every state and flags changes made after sending', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-16T09:00:00Z'));
		const ev = addEvent(app, human, e.id, { title: 'Access interview', requirement_ids: [req('i')] });
		vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
		const sent = setPlanStatus(app, human, e.id, e.version, 'sent');
		expect(planState(app, sent).changedSince).toBe(false);
		vi.setSystemTime(new Date('2026-11-16T11:00:00Z'));
		updateEvent(app, human, e.id, ev.id, ev.version, { start_time: '11:00' });
		expect(planState(app, getEngagement(app, e.id)).changedSince).toBe(true);
		vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
		const agreed = setPlanStatus(app, human, e.id, sent.version, 'agreed');
		expect(planState(app, agreed).changedSince).toBe(false);
		vi.setSystemTime(new Date('2026-11-16T13:00:00Z'));
		addEvidence(app, human, e.id, ev.id, { text: 'Leaver list' });
		expect(planState(app, getEngagement(app, e.id)).changedSince).toBe(true);
	});
});

describe('coverage (#48)', () => {
	it('lists events per requirement, uncovered first; a requirement can be in several events', () => {
		const a = addEvent(app, human, e.id, { title: 'Access interview', requirement_ids: [req('i')] });
		const b = addEvent(app, human, e.id, {
			title: 'MFA test',
			format: 'technical_test',
			requirement_ids: [req('i')]
		});
		let c = coverage(app, e.id);
		expect(c).toMatchObject({ covered: 1, total: 4 });
		expect(c.rows.map((r) => r.refCode)).toEqual([
			'Art. 21(2)(b)',
			'Art. 21(2)(c)',
			'Art. 21(2)(j)',
			'Art. 21(2)(i)'
		]);
		expect(c.rows[3]!.events.map((x) => x.title)).toEqual(['Access interview', 'MFA test']);
		setEventRequirement(app, human, e.id, b.id, req('j'), true);
		setEventRequirement(app, human, e.id, a.id, req('i'), false);
		c = coverage(app, e.id);
		expect(c.covered).toBe(2);
		expect(c.rows.find((r) => r.refCode === 'Art. 21(2)(i)')!.events.map((x) => x.title)).toEqual([
			'MFA test'
		]);
	});
});

describe('Home phases 6 and 7', () => {
	it('plan events is done when the plan is agreed with evidence; run when no evidence is still planned', () => {
		const ev = addEvent(app, human, e.id, { title: 'Access interview', requirement_ids: [req('i')] });
		const x = addEvidence(app, human, e.id, ev.id, { text: 'Leaver list' });
		let o = engagementOverview(app, e.id);
		expect(o.phases[5]).toMatchObject({ done: false, fact: '1 event, 1 evidence item · plan draft' });
		const sent = setPlanStatus(app, human, e.id, e.version, 'sent');
		setPlanStatus(app, human, e.id, sent.version, 'agreed');
		o = engagementOverview(app, e.id);
		expect(o.phases[5]!.done).toBe(true);
		expect(o.phases[6]).toMatchObject({ done: false, fact: '0 of 1 event held · 1 evidence still planned' });
		updateEvidence(app, human, e.id, x.id, x.version, { status: 'received' });
		expect(engagementOverview(app, e.id).phases[6]!.done).toBe(true);
	});
});
