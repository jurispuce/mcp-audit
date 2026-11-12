import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { ValidationError } from './errors';
import { builtInSources, importBuiltInSource, importSourceYaml } from './library-import';
import {
	criteriaOf,
	findRequirement,
	getGuidance,
	getSourceByCode,
	linksOf,
	listSources,
	requirementDefinition,
	requirementTree,
	translationsOf
} from './library';
import { createFirstAdmin } from './users';
import { deleteEntity, type Actor } from './write';

const SEED = path.resolve(import.meta.dirname, '../../../seed/library');
const nis2Yaml = readFileSync(path.join(SEED, 'nis2-art21.yaml'), 'utf8');

let app: AppDatabase;
let actor: Actor;
const revisions = () => (app.sqlite.prepare('SELECT count(*) AS n FROM revision').get() as { n: number }).n;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	actor = { userId: a.id, channel: 'ui' };
});
afterEach(() => app.close());

describe('NIS 2 seed (#26)', () => {
	it('is bundled and imports cleanly with language and licence note', () => {
		expect(builtInSources(SEED)).toEqual([
			{ file: 'nis2-art21.yaml', code: 'nis2', title: 'NIS 2 Directive (EU) 2022/2555', requirements: 13 }
		]);
		const report = importBuiltInSource(app, actor, 'nis2-art21.yaml', SEED);
		expect(report).toMatchObject({
			source: { code: 'nis2', created: true },
			requirements: { created: 13, updated: 0, unchanged: 0, restored: 0 },
			warnings: []
		});
		const [src] = listSources(app);
		expect(src).toMatchObject({ type: 'law', language: 'en', requirementCount: 13 });
		expect(src!.licenceNote).toContain('Public EU law');

		const tree = requirementTree(app, src!.id);
		expect(tree.map((n) => n.refCode)).toEqual(['Art. 21']);
		expect(tree[0]!.children.map((n) => n.refCode)).toEqual(['Art. 21(1)', 'Art. 21(2)']);
		const points = tree[0]!.children[1]!.children;
		expect(points.map((n) => n.refCode.slice(-3))).toEqual([
			'(a)',
			'(b)',
			'(c)',
			'(d)',
			'(e)',
			'(f)',
			'(g)',
			'(h)',
			'(i)',
			'(j)'
		]);
		expect(points[9]!.text).toContain('multi-factor authentication');
	});

	it('re-importing the same file changes nothing and does not duplicate', () => {
		importSourceYaml(app, actor, nis2Yaml);
		const before = revisions();
		const again = importSourceYaml(app, actor, nis2Yaml);
		expect(again.source).toMatchObject({ created: false, updated: false });
		expect(again.requirements).toEqual({ created: 0, updated: 0, restored: 0, unchanged: 13 });
		expect(revisions()).toBe(before);
		expect(listSources(app)[0]!.requirementCount).toBe(13);
	});

	it('turns changed requirements into new versions, adds new ones and reports missing ones', () => {
		importSourceYaml(app, actor, nis2Yaml);
		const changed = nis2Yaml
			.replace('text: incident handling;', 'text: incident handling, including reporting;')
			.replace(
				/ {2}- id: ["']Art\. 21\(2\)\(j\)["'][\s\S]*$/,
				'  - id: "Art. 21(3)"\n    parent: "Art. 21"\n    title: Supply chain vulnerabilities\n'
			);
		const report = importSourceYaml(app, actor, changed, { fileName: 'nis2-v2.yaml' });
		expect(report.requirements).toEqual({ created: 1, updated: 1, restored: 0, unchanged: 11 });
		expect(report.notInFile).toEqual(['Art. 21(2)(j)']);
		const src = getSourceByCode(app, 'nis2')!;
		const b = findRequirement(app, src.id, 'Art. 21(2)(b)')!;
		expect(b).toMatchObject({ text: 'incident handling, including reporting;', version: 2 });
		const note = app.sqlite
			.prepare('SELECT note FROM revision WHERE entity_id = ? AND version = 2')
			.get(b.id) as { note: string };
		expect(note.note).toBe('Imported from nis2-v2.yaml');
		expect(findRequirement(app, src.id, 'Art. 21(2)(j)')).not.toBeNull();
	});

	it('restores a deleted requirement when the file still has it', () => {
		importSourceYaml(app, actor, nis2Yaml);
		const src = getSourceByCode(app, 'nis2')!;
		const j = findRequirement(app, src.id, 'Art. 21(2)(j)')!;
		deleteEntity(app, actor, requirementDefinition, j.id, 1);
		const report = importSourceYaml(app, actor, nis2Yaml);
		expect(report.requirements.restored).toBe(1);
		expect(listSources(app)[0]!.requirementCount).toBe(13);
	});
});

describe('import of links, guidance, criteria and translations', () => {
	const iso = `
id: iso27001-sample
title: ISO/IEC 27001:2022 Annex A (codes and titles)
type: standard
language: en
licence_note: Codes and titles only
requirements:
  - id: A.5.18
    title: Access rights
    links:
      - {type: implements, to: "nis2:Art. 21(2)(i)", coverage: partial}
      - {type: details, to: A.5.15}
      - {type: shadows, to: A.5.15}
      - {type: details, to: "nope:X"}
    guidance: Ask for the last access review and pick five leavers.
    criteria:
      - Access rights are reviewed at a defined interval
      - text: Review results are acted on
        expected_evidence: [review records for two cycles, list of changes]
  - id: A.5.15
    title: Access control
`;
	const lv = `
id: nis2-lv
title: NIS 2 direktīva
type: law
language: lv
requirements:
  - id: "Art. 21(2)(b)"
    title: Incidentu apstrāde
    translation_of: {source: nis2, id: "Art. 21(2)(b)"}
`;

	it('creates links across sources, guidance and criteria, and warns about what it cannot resolve', () => {
		importSourceYaml(app, actor, nis2Yaml);
		const report = importSourceYaml(app, actor, iso);
		expect(report.links).toEqual({ created: 2, existing: 0 });
		expect(report.guidance).toEqual({ created: 1, updated: 0 });
		expect(report.criteria).toEqual({ created: 2 });
		expect(report.warnings).toHaveLength(2);
		const src = getSourceByCode(app, 'iso27001-sample')!;
		const a518 = findRequirement(app, src.id, 'A.5.18')!;
		expect(
			linksOf(app, a518.id).map((l) => `${l.label} ${l.other.refCode} ${l.coverage ?? ''}`.trim())
		).toEqual(['Implements Art. 21(2)(i) partial', 'Details A.5.15']);
		expect(getGuidance(app, a518.id)?.body).toContain('five leavers');
		expect(criteriaOf(app, a518.id)[1]).toMatchObject({
			expectedEvidence: ['review records for two cycles', 'list of changes']
		});

		const again = importSourceYaml(app, actor, iso);
		expect(again.links).toEqual({ created: 0, existing: 2 });
		expect(again.criteria.created).toBe(0);
		expect(again.guidance).toEqual({ created: 0, updated: 0 });
	});

	it('pairs a Latvian source with the English one through translation_of', () => {
		importSourceYaml(app, actor, nis2Yaml);
		importSourceYaml(app, actor, lv);
		const en = findRequirement(app, getSourceByCode(app, 'nis2')!.id, 'Art. 21(2)(b)')!;
		expect(translationsOf(app, en.id)).toMatchObject([{ language: 'lv', title: 'Incidentu apstrāde' }]);
	});

	it('accepts children listed before their parent', () => {
		importSourceYaml(
			app,
			actor,
			'id: x\ntitle: X\nrequirements:\n  - {id: "1.1", parent: "1", title: Child}\n  - {id: "1", title: Parent}'
		);
		const tree = requirementTree(app, getSourceByCode(app, 'x')!.id);
		expect(tree.map((n) => n.refCode)).toEqual(['1']);
		expect(tree[0]!.children.map((n) => n.refCode)).toEqual(['1.1']);
	});

	it('is all or nothing: an error part way leaves the database untouched', () => {
		const before = revisions();
		const broken = `
id: broken
title: Broken
language: en
requirements:
  - {id: A, title: Fine}
  - {id: B, title: Bad language, language: "english!"}
`;
		expect(() => importSourceYaml(app, actor, broken)).toThrow(ValidationError);
		expect(listSources(app)).toEqual([]);
		expect(revisions()).toBe(before);
	});

	it('explains what is wrong with a file that is not a source', () => {
		expect(() => importSourceYaml(app, actor, 'id: [unclosed')).toThrow(/not valid YAML/);
		expect(() => importSourceYaml(app, actor, '- a\n- b')).toThrow(/one source/);
		expect(() => importSourceYaml(app, actor, 'id: x\ntitle: X\nrequirements:\n  - {id: A}')).toThrow(
			/A has no title/
		);
		expect(() =>
			importSourceYaml(
				app,
				actor,
				'id: x\ntitle: X\nrequirements:\n  - {id: A, title: a}\n  - {id: A, title: b}'
			)
		).toThrow(/appears twice/);
	});
});
