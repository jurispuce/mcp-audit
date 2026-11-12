import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { createEngagement } from './engagements';
import { ForbiddenError } from './errors';
import { addInternal, acceptInternal, listInternal } from './internal';
import { getItemHistory } from './items';
import {
	addLink,
	findRequirement,
	getRequirement,
	getSourceByCode,
	linkDefinition,
	linksOf,
	listSources,
	searchRequirements,
	sourceDefinition,
	upsertSources
} from './library';
import { importBuiltInSource, importSourceYaml, upsertRequirements } from './library-import';
import {
	acceptAllLinks,
	acceptRequirement,
	editLink,
	listLibraryProposals,
	mappingOf,
	publishSource,
	rejectLink,
	rejectRequirement,
	rejectSource
} from './library-review';
import { selectRequirements } from './selection';
import { createFirstAdmin } from './users';
import { createEntity, updateEntity, type Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;

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
});
afterEach(() => app.close());

const nis2 = (p: string) => findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${p})`)!;

function aiImport() {
	upsertSources(app, ai, [{ code: 'mk397', title: 'MK noteikumi Nr. 397', type: 'law', language: 'lv' }]);
	upsertRequirements(app, ai, 'mk397', [
		{ ref: '5', title: 'Riska pārvaldība' },
		{ ref: '5.1', title: 'Riska novērtējums reizi gadā', parent: '5' },
		{ ref: '6', title: 'Piekļuves kontrole' }
	]);
	return getSourceByCode(app, 'mk397')!;
}

describe('proposed library changes (#69)', () => {
	it('a source AI creates is proposed with proposed requirements, hidden from the library, search and selection', () => {
		const src = aiImport();
		expect(src).toMatchObject({ status: 'proposed', requirementCount: 3, proposedCount: 3 });
		expect(listSources(app).map((s) => s.code)).toEqual(['nis2']);
		expect(searchRequirements(app, 'piekļuves')).toEqual([]);
		expect(searchRequirements(app, 'piekļuves', { includeProposed: true }).map((r) => r.refCode)).toEqual([
			'6'
		]);
		const e = createEngagement(app, human, { name: 'A', auditeeName: 'B', startDate: '2026-11-16' });
		expect(() => selectRequirements(app, human, e.id, [findRequirement(app, src.id, '6')!.id])).toThrow(
			/Library, Review/
		);
		expect(() => upsertSources(app, ai, [{ code: 'mk397', title: 'x' }])).not.toThrow();
		expect(getSourceByCode(app, 'mk397')!.status).toBe('proposed');
	});

	it('only a person publishes a source; AI cannot set it active', () => {
		const src = aiImport();
		expect(() => publishSource(app, ai, src.id)).toThrow(ForbiddenError);
		const row = app.sqlite.prepare('SELECT current_version FROM source WHERE id = ?').get(src.id) as {
			current_version: number;
		};
		expect(() =>
			updateEntity(app, ai, sourceDefinition, src.id, row.current_version, { status: 'active' })
		).toThrow(ForbiddenError);
		const published = publishSource(app, human, src.id);
		expect(published).toMatchObject({ status: 'active', proposedCount: 0 });
		expect(searchRequirements(app, 'piekļuves').map((r) => r.refCode)).toEqual(['6']);
	});

	it('an AI edit of a published requirement is proposed; reject restores the last confirmed version', () => {
		const b = nis2('b');
		upsertRequirements(app, ai, 'nis2', [{ ref: 'Art. 21(2)(b)', title: 'Incident handling and reporting' }]);
		expect(getRequirement(app, b.id)).toMatchObject({
			status: 'proposed',
			title: 'Incident handling and reporting'
		});
		expect(listLibraryProposals(app).changes[0]!.requirements.map((r) => r.refCode)).toEqual([
			'Art. 21(2)(b)'
		]);
		rejectRequirement(app, human, b.id);
		expect(getRequirement(app, b.id)).toMatchObject({ status: 'confirmed', title: b.title, version: 3 });
		upsertRequirements(app, ai, 'nis2', [
			{ ref: 'Art. 21(2)(b)', text: 'incident handling, including reporting;' }
		]);
		expect(acceptRequirement(app, human, b.id)).toMatchObject({
			status: 'confirmed',
			text: 'incident handling, including reporting;'
		});
		expect(getItemHistory(app, 'requirement', b.id)[0]).toMatchObject({
			note: 'Accepted',
			authorAgent: null
		});
	});

	it('a requirement AI added to a published source is removed when rejected', () => {
		upsertRequirements(app, ai, 'nis2', [{ ref: 'Art. 21(3)', title: 'Supply chain vulnerabilities' }]);
		const r = findRequirement(app, getSourceByCode(app, 'nis2')!.id, 'Art. 21(3)')!;
		expect(r.status).toBe('proposed');
		rejectRequirement(app, human, r.id);
		const row = app.sqlite.prepare('SELECT deleted FROM requirement WHERE id = ?').get(r.id) as {
			deleted: number;
		};
		expect(row.deleted).toBe(1);
	});

	it('a person’s YAML import stays active and confirmed', () => {
		importSourceYaml(
			app,
			human,
			'id: iso\ntitle: ISO sample\nrequirements:\n  - {id: A.5.15, title: Access control}'
		);
		expect(getSourceByCode(app, 'iso')).toMatchObject({ status: 'active', proposedCount: 0 });
	});

	it('rejecting a proposed source removes it with its requirements and links', () => {
		const src = aiImport();
		addLink(app, ai, {
			fromId: findRequirement(app, src.id, '6')!.id,
			toId: nis2('i').id,
			type: 'implements',
			coverage: 'partial',
			note: 'Both on access control'
		});
		rejectSource(app, human, src.id);
		expect(getSourceByCode(app, 'mk397')).toBeNull();
		expect(linksOf(app, nis2('i').id)).toEqual([]);
		expect(() => rejectSource(app, human, getSourceByCode(app, 'nis2')!.id)).toThrow(
			/Only a proposed source/
		);
	});
});

describe('mapping with review (#71)', () => {
	it('AI links are proposed with a reason; a person edits, accepts, rejects or accepts all', () => {
		const src = aiImport();
		const six = findRequirement(app, src.id, '6')!;
		const five1 = findRequirement(app, src.id, '5.1')!;
		const l1 = addLink(app, ai, {
			fromId: six.id,
			toId: nis2('i').id,
			type: 'implements',
			coverage: 'partial',
			note: 'Same topic: access control'
		}).row;
		addLink(app, ai, {
			fromId: five1.id,
			toId: nis2('a').id,
			type: 'details',
			note: 'Risk assessment frequency'
		});
		addLink(app, ai, { fromId: six.id, toId: nis2('j').id, type: 'details', note: 'Weak' });
		expect(l1.status).toBe('proposed');
		expect(() =>
			createEntity(app, ai, linkDefinition, {
				from_id: six.id,
				to_id: nis2('b').id,
				type: 'details',
				status: 'confirmed'
			})
		).toThrow(ForbiddenError);

		let m = mappingOf(app, src.id, getSourceByCode(app, 'nis2')!.id);
		expect(m).toMatchObject({ mapped: 0, proposed: 3 });
		expect(
			m.rows.find((r) => r.refCode === '6')!.links.map((l) => `${l.label} ${l.target.refCode} ${l.status}`)
		).toEqual(['Implements Art. 21(2)(i) proposed', 'Details Art. 21(2)(j) proposed']);
		expect(listLibraryProposals(app).mappings).toMatchObject([
			{ fromCode: 'mk397', toCode: 'nis2', proposed: 3 }
		]);

		editLink(app, human, String(l1.id), 1, { coverage: 'full' });
		const weak = m.rows.find((r) => r.refCode === '6')!.links[1]!;
		rejectLink(app, human, weak.id);
		expect(() => acceptAllLinks(app, ai, src.id, getSourceByCode(app, 'nis2')!.id)).toThrow(ForbiddenError);
		expect(acceptAllLinks(app, human, src.id, getSourceByCode(app, 'nis2')!.id)).toBe(2);
		m = mappingOf(app, src.id, getSourceByCode(app, 'nis2')!.id);
		expect(m).toMatchObject({ mapped: 2, proposed: 0 });
		expect(m.rows.find((r) => r.refCode === '6')!.links[0]).toMatchObject({
			coverage: 'full',
			status: 'confirmed'
		});
	});

	it('internal requirements: accepting the rule accepts its proposed links; findings count confirmed links only', () => {
		const e = createEngagement(app, human, { name: 'A', auditeeName: 'B', startDate: '2026-11-16' });
		selectRequirements(app, human, e.id, [nis2('i').id]);
		const r = addInternal(app, ai, e.id, {
			title: 'Leavers disabled',
			implements: [{ requirementId: nis2('i').id, coverage: 'full' }]
		});
		expect(r.implements[0]!.status).toBe('proposed');
		acceptInternal(app, human, e.id, r.id);
		expect(listInternal(app, e.id)[0]!.implements[0]!.status).toBe('confirmed');
	});
});
