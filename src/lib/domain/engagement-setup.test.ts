import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import {
	createEngagement,
	findingScaleOf,
	listEngagements,
	listMembers,
	listScopes,
	updateEngagement
} from './engagements';
import { ForbiddenError, StaleWriteError, ValidationError } from './errors';
import { getItem, getItemHistory } from './items';
import { findRequirement, getSourceByCode, requirementDefinition } from './library';
import { importBuiltInSource } from './library-import';
import { engagementOverview } from './overview';
import { acceptAllPeople, acceptPerson, addPerson, listPeople, rejectPerson } from './people';
import { addRisk, criticalityOf, listRisks, removeRisk } from './risks';
import {
	addScope,
	deselectRequirements,
	listAssessmentUnits,
	listSelected,
	removeScope,
	selectRequirements,
	setCriticality,
	setScopeHandling,
	setScopeMode,
	upgradePin
} from './selection';
import { createFirstAdmin } from './users';
import { updateEntity, type Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;
let dir: string;

const SEED = path.resolve(import.meta.dirname, '../../../seed/library');

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	ai = { userId: a.id, agent: 'Claude', channel: 'mcp' };
	importBuiltInSource(app, human, 'nis2-art21.yaml', SEED);
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-'));
});
afterEach(() => {
	app.close();
	rmSync(dir, { recursive: true, force: true });
});

const nis2 = (point: string) =>
	findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${point})`)!;
const newEngagement = (over: Partial<Parameters<typeof createEngagement>[2]> = {}) =>
	createEngagement(app, human, {
		name: 'NIS 2 audit',
		auditeeName: 'Baltic Freight SIA',
		startDate: '2026-11-16',
		...over
	});

describe('engagement (#35)', () => {
	it('creates one default scope, the six-value finding scale and the creator as lead auditor', () => {
		const e = newEngagement({ workingLanguage: 'en', reportLanguage: 'lv' });
		expect(e).toMatchObject({
			auditeeName: 'Baltic Freight SIA',
			workingLanguage: 'en',
			reportLanguage: 'lv',
			scopeMode: 'single',
			planStatus: 'draft',
			carryOverInternal: false,
			aiAllowed: true,
			llmProfile: null
		});
		expect(listScopes(app, e.id).map((s) => s.name)).toEqual(['Baltic Freight SIA']);
		expect(findingScaleOf(app, e.id).map((v) => v.label)).toEqual([
			'No reasonable assurance',
			'Conformity',
			'Conformity with positive note',
			'Conformity with auditor note',
			'Minor non-conformity',
			'Major non-conformity'
		]);
		expect(
			findingScaleOf(app, e.id)
				.filter((v) => v.isNonconformity)
				.map((v) => v.code)
		).toEqual(['minor', 'major']);
		expect(listMembers(app, e.id)).toMatchObject([{ name: 'Ada', role: 'lead_auditor' }]);
	});

	it('reuses an auditee with the same name and validates dates', () => {
		const a = newEngagement();
		const b = newEngagement({ name: 'Follow-up', auditeeName: 'baltic freight sia' });
		expect(b.auditeeId).toBe(a.auditeeId);
		expect(() => newEngagement({ startDate: '16.11.2026' })).toThrow(ValidationError);
		expect(() => newEngagement({ endDate: '2026-01-01' })).toThrow(/end/i);
		expect(listEngagements(app)).toHaveLength(2);
	});

	it('is versioned, and AI may not change plan status, the AI switch, model profile or carry-over', () => {
		const e = newEngagement();
		const changed = updateEngagement(app, human, e.id, e.version, { description: 'Annual audit' });
		expect(changed.version).toBe(2);
		expect(() => updateEngagement(app, human, e.id, e.version, { description: 'x' })).toThrow(
			StaleWriteError
		);
		const attempts = {
			plan_status: 'agreed',
			ai_allowed: false,
			llm_profile: 'fast',
			carry_over_internal: true
		};
		for (const [col, value] of Object.entries(attempts))
			expect(() => updateEngagement(app, ai, e.id, 2, { [col]: value }), col).toThrow(ForbiddenError);
		expect(getItemHistory(app, 'engagement', e.id).map((h) => h.version)).toEqual([2, 1]);
	});

	it('refuses every AI write once AI is switched off for the engagement', () => {
		const e = newEngagement();
		updateEngagement(app, human, e.id, e.version, { ai_allowed: false });
		expect(() => addScope(app, ai, e.id, { name: 'Warehouse' })).toThrow(/switched off/);
		expect(() => addRisk(app, ai, e.id, { title: 'x' })).toThrow(/switched off/);
		expect(() => addScope(app, human, e.id, { name: 'Warehouse' })).not.toThrow();
	});

	it('every new entity type opens in the item sheet', () => {
		const e = newEngagement();
		expect(getItem(app, 'engagement', e.id).label).toBe('NIS 2 audit');
		expect(getItem(app, 'scope', listScopes(app, e.id)[0]!.id).label).toBe('Baltic Freight SIA');
		expect(getItem(app, 'auditee', e.auditeeId).label).toBe('Baltic Freight SIA');
	});
});

describe('requirement selection and assessment units (#37)', () => {
	it('pins the current library version and keeps showing it after the library changes', () => {
		const e = newEngagement();
		const b = nis2('b');
		expect(selectRequirements(app, human, e.id, [b.id, nis2('c').id])).toEqual({ selected: 2, already: 0 });
		expect(selectRequirements(app, human, e.id, [b.id])).toEqual({ selected: 0, already: 1 });
		updateEntity(app, human, requirementDefinition, b.id, b.version, {
			text: 'incident handling, including reporting;'
		});
		const [sel] = listSelected(app, e.id).filter((s) => s.requirementId === b.id);
		expect(sel!.pinned).toMatchObject({ version: 1, text: 'incident handling;' });
		expect(sel!.newerVersion).toBe(2);
		upgradePin(app, human, e.id, b.id);
		const [after] = listSelected(app, e.id).filter((s) => s.requirementId === b.id);
		expect(after!.pinned).toMatchObject({ version: 2, text: 'incident handling, including reporting;' });
		expect(after!.newerVersion).toBeNull();
	});

	it('generates one unit per requirement, or one per scope when per-scope, and keeps them in step', () => {
		const e = newEngagement();
		const [b, c] = [nis2('b').id, nis2('c').id];
		selectRequirements(app, human, e.id, [b, c]);
		expect(listAssessmentUnits(app, e.id)).toHaveLength(2);

		const after = setScopeMode(app, human, e.id, e.version, 'multiple');
		addScope(app, human, e.id, { name: 'Warehouse' });
		setScopeHandling(app, human, e.id, [{ requirementId: b, scopeHandling: 'per_scope' }]);
		const units = listAssessmentUnits(app, e.id);
		expect(units).toHaveLength(3);
		expect(units.filter((u) => u.requirementId === b).map((u) => u.scopeName)).toEqual([
			'Baltic Freight SIA',
			'Warehouse'
		]);

		// Removing a scope removes its units; switching back to single collapses to one unit each.
		const warehouse = listScopes(app, e.id).find((s) => s.name === 'Warehouse')!;
		removeScope(app, human, warehouse.id, warehouse.version);
		expect(listAssessmentUnits(app, e.id)).toHaveLength(2);
		setScopeMode(app, human, e.id, after.version, 'single');
		expect(listAssessmentUnits(app, e.id)).toHaveLength(2);

		deselectRequirements(app, human, e.id, [c]);
		expect(listAssessmentUnits(app, e.id).map((u) => u.requirementId)).toEqual([b]);
		// Selecting again restores the same selection row as a new version.
		selectRequirements(app, human, e.id, [c]);
		expect(listSelected(app, e.id)).toHaveLength(2);
	});

	it('always keeps at least one scope', () => {
		const e = newEngagement();
		const [only] = listScopes(app, e.id);
		expect(() => removeScope(app, human, only!.id, only!.version)).toThrow(/at least one scope/);
	});

	it('keeps the selection versioned', () => {
		const e = newEngagement();
		selectRequirements(app, human, e.id, [nis2('b').id]);
		const [sel] = listSelected(app, e.id);
		expect(getItemHistory(app, 'engagement_requirement', sel!.id)).toHaveLength(1);
	});
});

describe('auditee roles (#39)', () => {
	it('needs a role; name, unit and email are optional; AI only proposes', () => {
		const e = newEngagement();
		expect(() => addPerson(app, human, e.auditeeId, { role: '' })).toThrow(ValidationError);
		expect(() => addPerson(app, human, e.auditeeId, { role: 'CISO', email: 'not an email' })).toThrow(
			ValidationError
		);
		const p = addPerson(app, human, e.auditeeId, { role: 'Head of IT' });
		expect(p).toMatchObject({ role: 'Head of IT', name: null, status: 'confirmed' });
		const proposed = addPerson(app, ai, e.auditeeId, {
			role: 'Warehouse manager',
			responsibilities: ['Backups at the warehouse'],
			source_document: 'Backup procedure',
			source_section: '1'
		});
		expect(proposed.status).toBe('proposed');
		expect(() => addPerson(app, ai, e.auditeeId, { role: 'DPO', status: 'confirmed' } as never)).toThrow(
			ForbiddenError
		);
		expect(() => acceptPerson(app, ai, proposed.id)).toThrow(ForbiddenError);
		expect(acceptPerson(app, human, proposed.id).status).toBe('confirmed');
	});

	it('rejects one or accepts all proposals', () => {
		const e = newEngagement();
		const a = addPerson(app, ai, e.auditeeId, { role: 'A' });
		addPerson(app, ai, e.auditeeId, { role: 'B' });
		addPerson(app, ai, e.auditeeId, { role: 'C' });
		rejectPerson(app, human, a.id);
		expect(acceptAllPeople(app, human, e.auditeeId)).toBe(2);
		expect(listPeople(app, e.auditeeId).map((p) => `${p.role}:${p.status}`)).toEqual([
			'B:confirmed',
			'C:confirmed'
		]);
	});
});

describe('risks and criticality (#40)', () => {
	it('links a risk to several selected requirements and drives their default criticality', () => {
		const e = newEngagement();
		const [i, j, c] = [nis2('i').id, nis2('j').id, nis2('c').id];
		selectRequirements(app, human, e.id, [i, j, c]);
		expect(() => addRisk(app, human, e.id, { title: 'x', requirement_ids: [nis2('a').id] })).toThrow(
			/selected/
		);
		const high = addRisk(app, human, e.id, {
			title: 'Leaver accounts stay active',
			level: 'high',
			requirement_ids: [i, j]
		});
		addRisk(app, human, e.id, { title: 'Weak MFA', level: 'low', requirement_ids: [j] });
		expect(listRisks(app, e.id).map((r) => r.title)).toEqual(['Leaver accounts stay active', 'Weak MFA']);

		let crit = criticalityOf(app, e.id);
		expect(crit.get(i)).toMatchObject({ level: 'high', from: 'risk' });
		expect(crit.get(j)).toMatchObject({ level: 'high', from: 'risk' });
		expect(crit.get(c)).toMatchObject({ level: 'medium', from: 'default' });

		setCriticality(app, human, e.id, c, 'low');
		removeRisk(app, human, high.id);
		crit = criticalityOf(app, e.id);
		expect(crit.get(c)).toMatchObject({ level: 'low', from: 'override' });
		expect(crit.get(j)).toMatchObject({ level: 'low', from: 'risk' });
		expect(crit.get(i)).toMatchObject({ level: 'medium', from: 'default' });
	});
});

describe('Home checklist (#36)', () => {
	it('computes one fact per phase and the first open phase', () => {
		const e = newEngagement();
		let o = engagementOverview(app, e.id);
		expect(o.phases.map((p) => p.state)).toEqual([
			'done',
			'current',
			'todo',
			'done',
			'todo',
			'todo',
			'todo',
			'todo'
		]);
		expect(o.phases).toHaveLength(8);
		expect(o.current).toMatchObject({ number: 2, next: 'select requirements', href: '/setup/requirements' });
		expect(o.phases[1]!.fact).toBe('None selected');

		selectRequirements(app, human, e.id, [nis2('b').id]);
		addPerson(app, human, e.auditeeId, { role: 'Head of IT' });
		o = engagementOverview(app, e.id);
		expect(o.phases[1]).toMatchObject({ done: true, fact: '1 requirement selected' });
		expect(o.current).toMatchObject({ number: 3, href: '/setup/risks' });
		expect(o.phases[2]!.fact).toBe('1 role, 0 risks');
		addRisk(app, human, e.id, { title: 'x', requirement_ids: [nis2('b').id] });
		o = engagementOverview(app, e.id);
		// Single scope counts as done, so the next open phase is internal requirements.
		expect(o.phases[3]).toMatchObject({ done: true, fact: 'Single scope · 1 assessment unit' });
		expect(o.current?.number).toBe(5);
	});
});
