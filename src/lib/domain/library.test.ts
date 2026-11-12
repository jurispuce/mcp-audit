import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { ValidationError } from './errors';
import { getItem, getItemHistory } from './items';
import {
	addCriterion,
	addLink,
	criteriaOf,
	getGuidance,
	linkDefinition,
	linksOf,
	listSources,
	removeCriterion,
	removeLink,
	requirementDefinition,
	requirementTree,
	searchRequirements,
	setGuidance,
	setTranslationOf,
	sourceDefinition,
	translationsOf,
	updateCriterion
} from './library';
import { createFirstAdmin } from './users';
import { createEntity, revertEntity, updateEntity, type Actor } from './write';

let app: AppDatabase;
let actor: Actor;
let nis2: string;

function req(sourceId: string, ref: string, title: string, extra: Record<string, unknown> = {}) {
	return String(
		createEntity(app, actor, requirementDefinition, {
			source_id: sourceId,
			ref_code: ref,
			title,
			language: 'en',
			...extra
		}).row.id
	);
}

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	actor = { userId: a.id, channel: 'ui' };
	nis2 = String(
		createEntity(app, actor, sourceDefinition, {
			code: 'NIS2',
			type: 'law',
			title: 'NIS 2 Directive',
			language: 'en',
			licence_note: 'Public EU law'
		}).row.id
	);
});
afterEach(() => app.close());

describe('library schema (#24)', () => {
	it('stores sources with type, language and licence note', () => {
		expect(listSources(app)).toMatchObject([
			{ code: 'nis2', type: 'law', language: 'en', licenceNote: 'Public EU law', requirementCount: 0 }
		]);
		expect(() =>
			createEntity(app, actor, sourceDefinition, { code: 'nis2', title: 'Again', language: 'en' })
		).toThrow(/already in use/);
		expect(() =>
			createEntity(app, actor, sourceDefinition, { code: 'x', title: 'X', type: 'blog', language: 'en' })
		).toThrow(ValidationError);
	});

	it('builds the requirement tree from parent_id, in natural order', () => {
		const art = req(nis2, 'Art. 21(2)', 'Measures');
		req(nis2, 'Art. 21(2)(j)', 'MFA', { parent_id: art });
		req(nis2, 'Art. 21(2)(a)', 'Policies', { parent_id: art });
		req(nis2, 'Art. 21(1)', 'General');
		const tree = requirementTree(app, nis2);
		expect(tree.map((n) => n.refCode)).toEqual(['Art. 21(1)', 'Art. 21(2)']);
		expect(tree[1]!.children.map((n) => n.refCode)).toEqual(['Art. 21(2)(a)', 'Art. 21(2)(j)']);
	});

	it('keeps ref_code unique within a source but not across sources', () => {
		req(nis2, 'A.1', 'One');
		expect(() => req(nis2, 'A.1', 'Duplicate')).toThrow(/already in use/);
		const iso = String(
			createEntity(app, actor, sourceDefinition, { code: 'iso', title: 'ISO', language: 'en' }).row.id
		);
		expect(() => req(iso, 'A.1', 'Same code, other source')).not.toThrow();
	});

	it('refuses a parent in another source and cycles', () => {
		const a = req(nis2, 'A', 'A');
		const iso = String(
			createEntity(app, actor, sourceDefinition, { code: 'iso', title: 'ISO', language: 'en' }).row.id
		);
		const other = req(iso, 'X', 'X');
		expect(() => req(nis2, 'B', 'B', { parent_id: other })).toThrow(/same source/);
		const b = req(nis2, 'B', 'B', { parent_id: a });
		expect(() => updateEntity(app, actor, requirementDefinition, a, 1, { parent_id: b })).toThrow(/ancestor/);
	});

	it('supports the five link types; implements needs coverage', () => {
		const a = req(nis2, 'A', 'A');
		const b = req(nis2, 'B', 'B');
		for (const type of ['details', 'explains', 'equivalent', 'conflicts']) {
			expect(addLink(app, actor, { fromId: a, toId: b, type }).row.coverage).toBeNull();
		}
		expect(() => addLink(app, actor, { fromId: a, toId: b, type: 'implements' })).toThrow(/coverage/);
		expect(
			addLink(app, actor, { fromId: b, toId: a, type: 'implements', coverage: 'partial' }).row.coverage
		).toBe('partial');
		expect(() => addLink(app, actor, { fromId: a, toId: b, type: 'supersedes' })).toThrow(ValidationError);
		expect(() => addLink(app, actor, { fromId: a, toId: a, type: 'details' })).toThrow(/itself/);
		expect(() => addLink(app, actor, { fromId: a, toId: b, type: 'details' })).toThrow(/already exists/);
	});

	it('versions every library row through the write function', () => {
		const a = req(nis2, 'A', 'A');
		const b = req(nis2, 'B', 'B');
		const link = addLink(app, actor, { fromId: a, toId: b, type: 'details' });
		setGuidance(app, actor, a, 'Ask for the policy.');
		const c = addCriterion(app, actor, a, { text: 'Policy approved', expectedEvidence: ['Signed policy'] });
		const types = app.sqlite.prepare('SELECT DISTINCT entity_type AS t FROM revision ORDER BY t').all() as {
			t: string;
		}[];
		expect(types.map((r) => r.t)).toEqual([
			'criterion',
			'guidance',
			'requirement',
			'requirement_link',
			'source',
			'user'
		]);
		expect(getItemHistory(app, 'requirement_link', String(link.row.id))).toHaveLength(1);
		expect(getItemHistory(app, 'criterion', String(c.row.id))).toHaveLength(1);
	});

	it('finds requirements by code, title or text with full-text search', () => {
		req(nis2, 'Art. 21(2)(h)', 'Use of cryptography and encryption', {
			text: 'Policies and procedures regarding the use of cryptography'
		});
		req(nis2, 'Art. 21(2)(b)', 'Incident handling');
		expect(searchRequirements(app, 'crypto').map((r) => r.refCode)).toEqual(['Art. 21(2)(h)']);
		expect(searchRequirements(app, '21(2)(b)').map((r) => r.refCode)).toEqual(['Art. 21(2)(b)']);
		expect(searchRequirements(app, 'procedures')[0]?.snippet).toContain('[procedures]');
	});
});

describe('links shown in both directions (#27)', () => {
	it('labels a link from each end and removes it as a new version', () => {
		const a = req(nis2, 'INT-1', 'Review access every six months');
		const b = req(nis2, 'A.5.18', 'Access rights');
		const link = addLink(app, actor, { fromId: a, toId: b, type: 'implements', coverage: 'full' });
		expect(linksOf(app, a)).toMatchObject([
			{ label: 'Implements', direction: 'out', coverage: 'full', other: { refCode: 'A.5.18' } }
		]);
		expect(linksOf(app, b)).toMatchObject([
			{ label: 'Implemented by', direction: 'in', other: { refCode: 'INT-1' } }
		]);
		expect(getItem(app, 'requirement', b).counts.links).toBe(1);
		removeLink(app, actor, String(link.row.id), 1);
		expect(linksOf(app, a)).toEqual([]);
		expect(getItemHistory(app, 'requirement_link', String(link.row.id))[0]?.summary).toBe('Deleted');
		// A removed link is restored by reverting it.
		revertEntity(app, actor, linkDefinition, String(link.row.id), 2, 1);
		expect(linksOf(app, b)).toHaveLength(1);
	});
});

describe('guidance and criteria (#28)', () => {
	it('versions guidance separately from the requirement text', () => {
		const a = req(nis2, 'A', 'A', { text: 'Original text' });
		setGuidance(app, actor, a, 'Ask for the risk register.');
		setGuidance(app, actor, a, 'Ask for the risk register and its last review.', 1);
		expect(getGuidance(app, a)).toMatchObject({
			body: 'Ask for the risk register and its last review.',
			version: 2
		});
		expect(getItem(app, 'requirement', a).version).toBe(1);
		expect(() => setGuidance(app, actor, a, 'Stale edit', 1)).toThrow(/changed by someone else/);
	});

	it('keeps criteria with expected evidence, editable and removable', () => {
		const a = req(nis2, 'A', 'A');
		const c1 = addCriterion(app, actor, a, {
			text: 'Access is reviewed at a set interval',
			expectedEvidence: 'Review records\n\nList of changes'
		});
		addCriterion(app, actor, a, { text: 'Results are acted on' });
		expect(criteriaOf(app, a)).toMatchObject([
			{
				text: 'Access is reviewed at a set interval',
				expectedEvidence: ['Review records', 'List of changes']
			},
			{ text: 'Results are acted on', expectedEvidence: [] }
		]);
		updateCriterion(app, actor, String(c1.row.id), 1, {
			expectedEvidence: ['Review records for two cycles']
		});
		expect(criteriaOf(app, a)[0]?.expectedEvidence).toEqual(['Review records for two cycles']);
		removeCriterion(app, actor, String(c1.row.id), 2);
		expect(criteriaOf(app, a).map((c) => c.text)).toEqual(['Results are acted on']);
		expect(() => addCriterion(app, actor, a, { text: ' ' })).toThrow(ValidationError);
	});

	it('shows links, guidance and criteria with the requirement in the item sheet', () => {
		const a = req(nis2, 'A', 'A');
		setGuidance(app, actor, a, 'How to audit');
		addCriterion(app, actor, a, { text: 'C1' });
		const extra = getItem(app, 'requirement', a).extra as { guidance: { body: string }; criteria: unknown[] };
		expect(extra.guidance.body).toBe('How to audit');
		expect(extra.criteria).toHaveLength(1);
	});
});

describe('languages and translation pairs (#29)', () => {
	it('pairs language versions both ways and finds either language', () => {
		const lv = String(
			createEntity(app, actor, sourceDefinition, {
				code: 'nis2-lv',
				type: 'law',
				title: 'NIS 2 direktīva',
				language: 'lv'
			}).row.id
		);
		const en = req(nis2, 'Art. 21(2)(b)', 'Incident handling');
		const lvReq = req(lv, 'Art. 21(2)(b)', 'Incidentu apstrāde', { language: 'lv' });
		setTranslationOf(app, actor, lvReq, 1, en);
		expect(translationsOf(app, en).map((r) => r.language)).toEqual(['lv']);
		expect(translationsOf(app, lvReq).map((r) => r.language)).toEqual(['en']);
		expect(searchRequirements(app, 'incidentu').map((r) => r.id)).toEqual([lvReq]);
		expect(searchRequirements(app, 'apstrade').map((r) => r.id)).toEqual([lvReq]);
		expect(
			searchRequirements(app, 'incident')
				.map((r) => r.id)
				.sort()
		).toEqual([en, lvReq].sort());
	});

	it('refuses a translation in the same language and keeps pairs flat', () => {
		const a = req(nis2, 'A', 'A');
		const b = req(nis2, 'B', 'B');
		expect(() => setTranslationOf(app, actor, b, 1, a)).toThrow(/another language/);
		const lv = String(
			createEntity(app, actor, sourceDefinition, { code: 'lv', title: 'LV', language: 'lv' }).row.id
		);
		const de = String(
			createEntity(app, actor, sourceDefinition, { code: 'de', title: 'DE', language: 'de' }).row.id
		);
		const aLv = req(lv, 'A', 'A lv', { language: 'lv' });
		const aDe = req(de, 'A', 'A de', { language: 'de' });
		setTranslationOf(app, actor, aLv, 1, a);
		setTranslationOf(app, actor, aDe, 1, aLv);
		expect(translationsOf(app, a).map((r) => r.language)).toEqual(['de', 'lv']);
		expect(translationsOf(app, aDe).map((r) => r.language)).toEqual(['en', 'lv']);
	});
});
