import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { listArtifacts, uploadArtifacts } from './artifacts';
import './entities';
import { createEngagement, findingScaleOf, type Engagement } from './engagements';
import { ForbiddenError, ValidationError } from './errors';
import {
	acceptAllLinks,
	addEvidenceLink,
	addNote,
	confirmLink,
	inbox,
	listLinks,
	listNotes,
	mentionOptions,
	setEventHeld,
	suspectedIssues
} from './execution';
import {
	acceptProposal,
	approveAllDrafts,
	approveFinding,
	proposeFinding,
	rejectProposal,
	reopenFinding,
	saveDraft,
	unitCards
} from './findings';
import { getItemHistory } from './items';
import { addInternal } from './internal';
import { findRequirement, getSourceByCode } from './library';
import { importBuiltInSource } from './library-import';
import { engagementOverview } from './overview';
import { addPerson, type Person } from './people';
import { addEvent, addEvidence, listEvidence, type PlanEvent } from './planning';
import { selectRequirements } from './selection';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;
let e: Engagement;
let head: Person;
let ev: PlanEvent;
let files: string;
const req = (p: string) => findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${p})`)!.id;
const value = (code: string) => findingScaleOf(app, e.id).find((v) => v.code === code)!.id;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris',
		email: 'juris@example.test',
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
	selectRequirements(app, human, e.id, [req('b'), req('i')]);
	head = addPerson(app, human, e.auditeeId, { role: 'Head of IT' });
	ev = addEvent(app, human, e.id, {
		title: 'Access interview',
		participant_ids: [head.id],
		requirement_ids: [req('i'), req('b')]
	});
	files = mkdtempSync(path.join(tmpdir(), 'mcpa-exec-'));
});
afterEach(() => {
	app.close();
	rmSync(files, { recursive: true, force: true });
});

const leaverList = () =>
	addEvidence(app, human, e.id, ev.id, { text: 'Leaver list for 2026', requirement_ids: [req('i')] });
async function upload(name: string, text: string) {
	const [r] = await uploadArtifacts(
		app,
		human,
		files,
		e.id,
		[{ name, type: 'text/plain', bytes: new TextEncoder().encode(text) }],
		{ eventId: ev.id }
	);
	return r!.artifact!;
}

describe('auditor notes (#53)', () => {
	it('stores type, text, mentions and time; offers requirements, internal rules, documents, roles and this event’s evidence', () => {
		const item = leaverList();
		addInternal(app, human, e.id, {
			title: 'Leavers disabled within a day',
			implements: [{ requirementId: req('i'), coverage: 'full' }]
		});
		const options = mentionOptions(app, e.id, ev.id);
		expect(options.map((o) => o.type)).toEqual([
			'requirement',
			'requirement',
			'internal_requirement',
			'person',
			'evidence_item'
		]);
		const { note } = addNote(app, human, e.id, ev.id, {
			text: 'Access review done twice a year',
			mentions: [{ type: 'requirement', id: req('i'), label: 'Art. 21(2)(i)' }],
			at: Date.parse('2026-11-17T10:04:10Z')
		});
		expect(note).toMatchObject({ type: 'note', mentions: [{ label: 'Art. 21(2)(i)' }] });
		expect(() =>
			addNote(app, human, e.id, ev.id, {
				text: 'x',
				mentions: [{ type: 'person', id: 'nobody', label: 'Ghost' }]
			})
		).toThrow(ValidationError);
		expect(listNotes(app, e.id, { eventId: ev.id })).toHaveLength(1);
		void item;
	});

	it('a promise mentioning evidence sets it to promised by the mentioned role, with a due date from the text', () => {
		const item = leaverList();
		const { effects } = addNote(app, human, e.id, ev.id, {
			type: 'promise',
			text: 'Head of IT will send the leaver list by 2026-11-20',
			mentions: [
				{ type: 'person', id: head.id, label: 'Head of IT' },
				{ type: 'evidence_item', id: item.id, label: item.text }
			]
		});
		expect(effects).toEqual(['Leaver list for 2026 set to promised by Head of IT']);
		expect(listEvidence(app, e.id)[0]).toMatchObject({
			status: 'promised',
			promisedBy: 'Head of IT',
			promisedDue: '2026-11-20'
		});
	});

	it('an unknown document name creates a mentioned document; a suspected issue shows for its requirement only', () => {
		const { note, effects } = addNote(app, human, e.id, ev.id, {
			type: 'issue',
			text: 'No access review in H1; they follow an onboarding checklist',
			mentions: [
				{ type: 'requirement', id: req('i'), label: 'Art. 21(2)(i)' },
				{ type: 'artifact', id: '', label: 'Onboarding checklist' }
			]
		});
		expect(effects).toEqual(['Onboarding checklist recorded as mentioned, not received']);
		expect(listArtifacts(app, e.id)).toMatchObject([
			{ displayName: 'Onboarding checklist', state: 'mentioned', eventId: ev.id }
		]);
		expect(note.mentions[1]!.id).toBeTruthy();
		expect(suspectedIssues(app, e.id, req('i')).map((n) => n.id)).toEqual([note.id]);
		expect(suspectedIssues(app, e.id, req('b'))).toEqual([]);
	});

	it('marks the event held', () => {
		expect(setEventHeld(app, human, e.id, ev.id, true).status).toBe('held');
		expect(setEventHeld(app, human, e.id, ev.id, false).status).toBe('planned');
	});
});

describe('artifact capture and inbox (#54)', () => {
	it('lists artifacts not linked to any planned evidence', async () => {
		const a = await upload('leavers.txt', 'leaver list');
		const b = await upload('notes.txt', 'meeting notes');
		const item = leaverList();
		expect(inbox(app, e.id).map((x) => x.id)).toEqual([a.id, b.id]);
		addEvidenceLink(app, human, e.id, { artifactId: a.id, evidenceItemId: item.id });
		expect(inbox(app, e.id).map((x) => x.id)).toEqual([b.id]);
	});
});

describe('evidence links (#55)', () => {
	it('links with locator, excerpt and sufficiency; confirming sets evidence received (partly for partial)', async () => {
		const a = await upload('leavers.txt', '41 accounts reviewed, 3 removed');
		const item = leaverList();
		const second = addEvidence(app, human, e.id, ev.id, {
			text: 'Access review records',
			requirement_ids: [req('i')]
		});
		const link = addEvidenceLink(app, human, e.id, {
			artifactId: a.id,
			evidenceItemId: item.id,
			locator: 'line 1',
			excerpt: '3 removed',
			sufficiency: 'supports'
		});
		expect(link).toMatchObject({ status: 'confirmed', sufficiency: 'supports', locator: 'line 1' });
		addEvidenceLink(app, human, e.id, {
			artifactId: a.id,
			evidenceItemId: second.id,
			sufficiency: 'partial'
		});
		expect(
			listEvidence(app, e.id)
				.map((x) => `${x.text}:${x.status}`)
				.sort()
		).toEqual(['Access review records:partial', 'Leaver list for 2026:received']);
		expect(() => addEvidenceLink(app, human, e.id, { artifactId: a.id, evidenceItemId: item.id })).toThrow(
			/already linked/
		);
	});

	it('AI links are proposed; a person confirms, rejects or accepts all', async () => {
		const a = await upload('leavers.txt', 'x');
		const b = await upload('review.txt', 'y');
		const item = leaverList();
		const second = addEvidence(app, human, e.id, ev.id, {
			text: 'Access review records',
			requirement_ids: [req('i')]
		});
		const p1 = addEvidenceLink(app, ai, e.id, { artifactId: a.id, evidenceItemId: item.id });
		addEvidenceLink(app, ai, e.id, {
			artifactId: b.id,
			evidenceItemId: second.id,
			sufficiency: 'contradicts'
		});
		expect(p1.status).toBe('proposed');
		expect(listEvidence(app, e.id).every((x) => x.status === 'planned')).toBe(true);
		expect(() => confirmLink(app, ai, e.id, p1.id)).toThrow(ForbiddenError);
		expect(confirmLink(app, human, e.id, p1.id).status).toBe('confirmed');
		expect(acceptAllLinks(app, human, e.id)).toBe(1);
		expect(listLinks(app, e.id).every((l) => l.status === 'confirmed')).toBe(true);
	});
});

describe('findings and approval (#57, #58)', () => {
	it('one card per unit with evidence summary, internal rules, suspected issues and finding', async () => {
		const item = leaverList();
		const a = await upload('leavers.txt', 'x');
		addEvidenceLink(app, human, e.id, {
			artifactId: a.id,
			evidenceItemId: item.id,
			sufficiency: 'contradicts'
		});
		addInternal(app, human, e.id, {
			title: 'Leavers disabled within a day',
			implements: [{ requirementId: req('i'), coverage: 'partial' }]
		});
		addNote(app, human, e.id, ev.id, {
			type: 'issue',
			text: 'Three leavers still active',
			mentions: [{ type: 'evidence_item', id: item.id, label: item.text }]
		});
		const cards = unitCards(app, e.id);
		expect(cards.map((c) => c.refCode)).toEqual(['Art. 21(2)(b)', 'Art. 21(2)(i)']);
		const i = cards[1]!;
		expect(i.evidenceSummary).toMatchObject({ total: 1, received: 1, contradicts: 1 });
		expect(i.internalRules).toMatchObject([{ refCode: 'INT-1', coverage: 'partial' }]);
		expect(i.suspectedIssues.map((n) => n.text)).toEqual(['Three leavers still active']);
		expect(i.finding).toBeNull();
	});

	it('AI proposes; a suspected issue blocks proposing conformity; a person accepts, saves, approves, reopens', () => {
		const item = leaverList();
		const unit = unitCards(app, e.id)[1]!.unitId;
		addNote(app, human, e.id, ev.id, {
			type: 'issue',
			text: 'No review in H1',
			mentions: [{ type: 'requirement', id: req('i'), label: 'Art. 21(2)(i)' }]
		});
		expect(() =>
			proposeFinding(app, ai, e.id, unit, { findingValueId: value('c'), rationale: 'Looks fine' })
		).toThrow(/suspected issue/);
		const p = proposeFinding(app, ai, e.id, unit, {
			findingValueId: value('na'),
			rationale: 'Leaver list not yet received.',
			evidenceItemIds: [item.id]
		});
		expect(p.status).toBe('proposed');
		expect(() => approveFinding(app, human, e.id, p.id)).toThrow(/Accept the proposal/);
		expect(() => acceptProposal(app, ai, e.id, p.id)).toThrow(ForbiddenError);
		const d = acceptProposal(app, human, e.id, p.id);
		expect(d.status).toBe('draft');
		expect(() => approveFinding(app, ai, e.id, d.id)).toThrow(ForbiddenError);
		const approved = approveFinding(app, human, e.id, d.id);
		expect(approved).toMatchObject({ status: 'approved', approvedByName: 'Juris', approvedVersion: 3 });
		expect(() => saveDraft(app, human, e.id, unit, { rationale: 'changed' })).toThrow(/locked/);
		expect(() => proposeFinding(app, ai, e.id, unit, { rationale: 'AI edit' })).toThrow(/locked/);
		const reopened = reopenFinding(app, human, e.id, d.id);
		expect(reopened).toMatchObject({ status: 'draft', approvedAt: null, version: 4 });
		expect(getItemHistory(app, 'finding', d.id).map((h) => h.note)).toEqual([
			'Reopened',
			'Approved',
			'Proposal accepted as draft',
			null
		]);
	});

	it('missing evidence never makes a non-conformity', () => {
		const item = leaverList();
		const unit = unitCards(app, e.id)[1]!.unitId;
		expect(() =>
			saveDraft(app, human, e.id, unit, {
				findingValueId: value('major'),
				rationale: 'No leaver list',
				evidenceItemIds: [item.id]
			})
		).toThrow(/no reasonable assurance/);
		expect(() => saveDraft(app, human, e.id, unit, { findingValueId: value('minor') })).toThrow(
			/no reasonable assurance/
		);
		expect(
			saveDraft(app, human, e.id, unit, { findingValueId: value('na'), rationale: 'No leaver list' }).value
				?.code
		).toBe('na');
	});

	it('approve all drafts in one action; reject a proposal; phase 8 counts conclusions', () => {
		const [b, i] = unitCards(app, e.id);
		saveDraft(app, human, e.id, b!.unitId, {
			findingValueId: value('c'),
			rationale: 'Incident log reviewed'
		});
		const p = proposeFinding(app, ai, e.id, i!.unitId, { findingValueId: value('na') });
		rejectProposal(app, human, e.id, p.id);
		saveDraft(app, human, e.id, i!.unitId, { findingValueId: value('cn'), rationale: 'Minor gaps' });
		expect(approveAllDrafts(app, human, e.id)).toBe(2);
		const o = engagementOverview(app, e.id);
		expect(o.phases[7]).toMatchObject({ done: true, fact: '2 of 2 assessment units concluded' });
	});
});
