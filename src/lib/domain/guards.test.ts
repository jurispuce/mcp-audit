import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { ForbiddenError } from './errors';
import { assertAiAllowed, assertCanReadRequirement, canReadSource, isHuman, requireHuman } from './guards';
import { requirementDefinition, sourceDefinition } from './library';
import { createTestEntityTables, testEngagements, testGuarded } from './test-entities';
import { createFirstAdmin } from './users';
import { createEntity, deleteEntity, revertEntity, updateEntity, type Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;

beforeEach(async () => {
	app = createTestDatabase();
	createTestEntityTables(app);
	const a = await createFirstAdmin(app, {
		name: 'Juris',
		email: 'juris@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	ai = { userId: a.id, channel: 'mcp', agent: 'Claude' };
	testEngagements.clear();
	testEngagements.set('eng-on', true);
	testEngagements.set('eng-off', false);
});
afterEach(() => app.close());

describe('judgement writes by AI are stored as proposed (#33)', () => {
	it('forces proposed on create, for MCP and in-app AI alike', () => {
		expect(createEntity(app, ai, testGuarded, { title: 'a' }).row.status).toBe('proposed');
		expect(createEntity(app, { ...ai, channel: 'ai' }, testGuarded, { title: 'b' }).row.status).toBe(
			'proposed'
		);
		expect(createEntity(app, human, testGuarded, { title: 'c' }).row.status).toBe('confirmed');
	});

	it('refuses an AI write that sets the judgement to anything but proposed', () => {
		expect(() => createEntity(app, ai, testGuarded, { title: 'a', status: 'confirmed' })).toThrow(
			ForbiddenError
		);
		const id = String(createEntity(app, ai, testGuarded, { title: 'a' }).row.id);
		expect(() => updateEntity(app, ai, testGuarded, id, 1, { status: 'confirmed' })).toThrow(
			/AI can only propose/
		);
	});

	it('puts an AI edit of a confirmed item back to proposed, including a revert by AI', () => {
		const id = String(createEntity(app, human, testGuarded, { title: 'v1' }).row.id);
		updateEntity(app, human, testGuarded, id, 1, { title: 'v2' });
		expect(updateEntity(app, ai, testGuarded, id, 2, { title: 'v3' }).row.status).toBe('proposed');
		updateEntity(app, human, testGuarded, id, 3, { status: 'confirmed' });
		expect(revertEntity(app, ai, testGuarded, id, 4, 1).row).toMatchObject({
			title: 'v1',
			status: 'proposed'
		});
	});
});

describe('only people approve (#33)', () => {
	it('refuses an AI change to a human-only column, also by revert', () => {
		const id = String(createEntity(app, human, testGuarded, { title: 'finding' }).row.id);
		expect(() => updateEntity(app, ai, testGuarded, id, 1, { approved: true })).toThrow(
			/Only a person in the app/
		);
		updateEntity(app, human, testGuarded, id, 1, { approved: true });
		expect(() => revertEntity(app, ai, testGuarded, id, 2, 1)).toThrow(/Only a person in the app/);
		expect(revertEntity(app, human, testGuarded, id, 2, 1).row.approved).toBe(0);
	});

	it('requireHuman refuses AI actors for approve, plan status and file deletion', () => {
		expect(isHuman(human)).toBe(true);
		for (const action of ['Approving a finding', 'Changing plan status', 'Deleting an artifact file']) {
			expect(() => requireHuman(ai, action)).toThrow(`${action} is done by a person in the app`);
			expect(() => requireHuman({ ...ai, channel: 'ai' }, action)).toThrow(ForbiddenError);
			expect(() => requireHuman(human, action)).not.toThrow();
		}
	});
});

describe('ai_allowed off means AI cannot act on the engagement (#33)', () => {
	it('refuses AI create, update, delete and revert on such an engagement; people are not affected', () => {
		expect(() => createEntity(app, ai, testGuarded, { title: 'x', engagement_id: 'eng-off' })).toThrow(
			/AI is switched off/
		);
		expect(createEntity(app, ai, testGuarded, { title: 'x', engagement_id: 'eng-on' }).row.status).toBe(
			'proposed'
		);
		const id = String(createEntity(app, human, testGuarded, { title: 'x', engagement_id: 'eng-off' }).row.id);
		expect(() => updateEntity(app, ai, testGuarded, id, 1, { title: 'y' })).toThrow(/AI is switched off/);
		expect(() => deleteEntity(app, ai, testGuarded, id, 1)).toThrow(/AI is switched off/);
		updateEntity(app, human, testGuarded, id, 1, { title: 'y' });
		expect(() => revertEntity(app, ai, testGuarded, id, 2, 1)).toThrow(/AI is switched off/);
	});

	it('assertAiAllowed checks one engagement', () => {
		expect(() => assertAiAllowed({ id: 'e', aiAllowed: false }, ai)).toThrow(ForbiddenError);
		expect(() => assertAiAllowed({ id: 'e', aiAllowed: false }, human)).not.toThrow();
		expect(() => assertAiAllowed({ id: 'e', aiAllowed: true }, ai)).not.toThrow();
		expect(() => assertAiAllowed(null, ai)).not.toThrow();
	});
});

describe('internal requirements never cross auditees (#33)', () => {
	it('lets a source be read from the library only when it is external, and from its own auditee', () => {
		expect(canReadSource({ auditee_id: null }, {})).toBe(true);
		expect(canReadSource({ auditee_id: 'a1' }, {})).toBe(false);
		expect(canReadSource({ auditee_id: 'a1' }, { auditeeId: 'a2' })).toBe(false);
		expect(canReadSource({ auditee_id: 'a1' }, { auditeeId: 'a1' })).toBe(true);
	});

	it("refuses to read another auditee's internal requirement", () => {
		const src = createEntity(app, human, sourceDefinition, {
			code: 'a1-policy',
			type: 'internal',
			title: 'A1',
			language: 'en',
			auditee_id: 'a1'
		}).row;
		const req = String(
			createEntity(app, human, requirementDefinition, {
				source_id: src.id,
				ref_code: 'I-1',
				title: 'Rule',
				language: 'en',
				origin: 'internal'
			}).row.id
		);
		expect(() => assertCanReadRequirement(app, req, { auditeeId: 'a2' })).toThrow(/another auditee/);
		expect(() => assertCanReadRequirement(app, req, {})).toThrow(/another auditee/);
		expect(() => assertCanReadRequirement(app, req, { auditeeId: 'a1' })).not.toThrow();
	});
});
