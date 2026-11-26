import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { ValidationError } from './errors';
import { getHistory } from './history';
import {
	addSourceRole,
	appliesToRole,
	cleanSourceRoles,
	createImportSource,
	removeSourceRole,
	updateSourceRole,
	requirementIdsFor,
	findRequirement,
	getSourceByCode,
	requirementDefinition,
	roleKey,
	searchRequirements,
	sourceDefinition,
	upsertSources
} from './library';
import { importSourceYaml, upsertRequirements } from './library-import';
import { editRequirement, publishSource } from './library-review';
import { createFirstAdmin } from './users';
import { updateEntity, type Actor } from './write';

/** Roles of a source, and each requirement's roles and source text (#108). */

let app: AppDatabase;
let human: Actor;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
});
afterEach(() => app.close());

const YAML = `id: nkdl
title: Nacionālās kiberdrošības likums
type: law
language: lv
roles:
  - { key: essential, label: Būtiskais subjekts, description: "1. panta 3. punkts" }
  - { key: important, label: Svarīgais subjekts }
requirements:
  - { id: "11", title: Pārvaldības pasākumi }
  - id: "11(1)"
    parent: "11"
    title: Riska pārvaldība
    text: Subjekts nosaka, novērtē un apstrādā riskus tīklu un informācijas sistēmām.
    source_text: Subjekts pārvalda šā likuma 10. pantā minētos riskus.
    roles: [essential, important]
  - { id: "12(2) [important]", parent: "11", title: Ziņošana, roles: [important] }
`;

describe('roles of a source (#108)', () => {
	it('keeps them in order, makes a key from the label, and refuses duplicates and bad keys', () => {
		expect(roleKey('Būtiskais subjekts')).toBe('butiskais-subjekts');
		expect(
			JSON.parse(cleanSourceRoles([{ label: 'Provider' }, { key: 'deployer', label: 'Deployer' }])!)
		).toEqual([
			{ key: 'provider', label: 'Provider', description: null },
			{ key: 'deployer', label: 'Deployer', description: null }
		]);
		expect(cleanSourceRoles([])).toBeNull();
		expect(() => cleanSourceRoles([{ label: 'A' }, { key: 'a', label: 'Another' }])).toThrow(ValidationError);
		expect(() => cleanSourceRoles([{ key: 'Not ok!', label: 'X' }])).toThrow(/Role key/);
		expect(() => cleanSourceRoles([{ key: 'x' }])).toThrow(/needs a label/);
	});

	it('are versioned and shown in history by their labels', () => {
		const [s] = upsertSources(app, human, [
			{ code: 'ai-act', title: 'AI Act', roles: [{ label: 'Provider' }] }
		]);
		upsertSources(app, human, [
			{ code: 'ai-act', title: 'AI Act', roles: [{ label: 'Provider' }, { label: 'Deployer' }] }
		]);
		const [latest] = getHistory(app, sourceDefinition, s!.id);
		expect(latest!.changes).toEqual([
			{ field: 'roles', label: 'Applies to', from: 'Provider', to: 'Provider, Deployer' }
		]);
	});
});

describe('requirements with roles and source text (#108)', () => {
	it('import from YAML, are searchable by the original passage, and keep both through a partial upsert', () => {
		const report = importSourceYaml(app, human, YAML);
		expect(report.requirements.created).toBe(3);
		const src = getSourceByCode(app, 'nkdl')!;
		expect(src.roles.map((r) => r.key)).toEqual(['essential', 'important']);
		const r = findRequirement(app, src.id, '11(1)')!;
		expect(r).toMatchObject({
			roles: ['essential', 'important'],
			sourceText: 'Subjekts pārvalda šā likuma 10. pantā minētos riskus.'
		});
		expect(findRequirement(app, src.id, '11')!.roles).toEqual([]);
		expect(searchRequirements(app, 'minētos').map((x) => x.refCode)).toEqual(['11(1)']);

		upsertRequirements(app, human, 'nkdl', [{ ref: '11(1)', title: 'Riska pārvaldības pasākumi' }]);
		expect(findRequirement(app, src.id, '11(1)')).toMatchObject({
			title: 'Riska pārvaldības pasākumi',
			roles: ['essential', 'important'],
			sourceText: 'Subjekts pārvalda šā likuma 10. pantā minētos riskus.'
		});
		const [latest] = getHistory(app, requirementDefinition, r.id);
		expect(latest!.changes.map((c) => c.label)).toEqual(['Title']);
	});

	it('refuses a role the source does not have', () => {
		importSourceYaml(app, human, YAML);
		expect(() =>
			upsertRequirements(app, human, 'nkdl', [{ ref: '13', title: 'X', roles: ['provider'] }])
		).toThrow(/Unknown role "provider".*essential, important/);
		expect(() =>
			importSourceYaml(
				app,
				human,
				'id: plain\ntitle: Plain\nrequirements:\n  - { id: "1", title: A, roles: [x] }\n'
			)
		).toThrow(/which has none yet/);
	});

	it('can be edited in review: roles and source text', () => {
		upsertSources(app, { ...human, channel: 'mcp', agent: 'Claude' }, [
			{
				code: 'nkdl',
				title: 'NKDL',
				roles: [{ key: 'essential', label: 'Essential' }, { label: 'Important' }]
			}
		]);
		upsertRequirements(app, { ...human, channel: 'mcp', agent: 'Claude' }, 'nkdl', [
			{ ref: '11', title: 'Risk', text: 'Manage risks.', roles: ['essential'] }
		]);
		const src = getSourceByCode(app, 'nkdl')!;
		const r = findRequirement(app, src.id, '11')!;
		expect(r.status).toBe('proposed');
		const edited = editRequirement(app, human, r.id, r.version, {
			roles: ['essential', 'important'],
			source_text: 'Original wording.'
		});
		expect(edited).toMatchObject({ roles: ['essential', 'important'], sourceText: 'Original wording.' });
		expect(editRequirement(app, human, r.id, edited.version, { roles: [], source_text: '' })).toMatchObject({
			roles: [],
			sourceText: null
		});
		publishSource(app, human, src.id);
		expect(getSourceByCode(app, 'nkdl')!.status).toBe('active');
	});
});

describe('which requirements apply to a role (#110)', () => {
	it('role-specific ones for that role, and shared ones and headings for every role', () => {
		expect(appliesToRole([], 'important')).toBe(true);
		expect(appliesToRole(['essential'], null)).toBe(true);
		expect(appliesToRole(['essential'], 'important')).toBe(false);
		expect(appliesToRole(['essential', 'important'], 'important')).toBe(true);

		importSourceYaml(app, human, YAML);
		const src = getSourceByCode(app, 'nkdl')!;
		const refs = (role: string | null) =>
			requirementIdsFor(app, src.id, role).map(
				(id) =>
					(
						app.sqlite.prepare('SELECT ref_code FROM requirement WHERE id = ?').get(id) as {
							ref_code: string;
						}
					).ref_code
			);
		expect(refs(null)).toEqual(['11', '11(1)', '12(2) [important]']);
		expect(refs('essential')).toEqual(['11', '11(1)']);
		expect(refs('important')).toEqual(['11', '11(1)', '12(2) [important]']);
		expect(searchRequirements(app, 'Ziņošana', { role: 'essential' })).toEqual([]);
		expect(searchRequirements(app, 'Ziņošana', { role: 'important' }).map((r) => r.refCode)).toEqual([
			'12(2) [important]'
		]);
	});
});

describe('correcting the roles (#112)', () => {
	const ai = (): Actor => ({ ...human, channel: 'mcp', agent: 'Claude' });
	const version = (code: string) =>
		(app.sqlite.prepare('SELECT current_version AS v FROM source WHERE code = ?').get(code) as { v: number })
			.v;

	it('a person adds, renames and removes roles; one in use stays, and the message says how many use it', () => {
		importSourceYaml(app, human, YAML);
		const src = getSourceByCode(app, 'nkdl')!;
		const added = addSourceRole(app, human, src.id, version('nkdl'), {
			label: 'Top management',
			description: 'The board'
		});
		expect(added.map((r) => r.key)).toEqual(['essential', 'important', 'top-management']);
		const renamed = updateSourceRole(app, human, src.id, version('nkdl'), 'essential', {
			label: 'Būtiskais subjekts (essential)'
		});
		expect(renamed[0]).toMatchObject({ key: 'essential', label: 'Būtiskais subjekts (essential)' });
		// The requirements keep the key.
		expect(findRequirement(app, src.id, '11(1)')!.roles).toEqual(['essential', 'important']);

		expect(() => removeSourceRole(app, human, src.id, version('nkdl'), 'important')).toThrow(
			'"important" is used by 2 requirements'
		);
		expect(removeSourceRole(app, human, src.id, version('nkdl'), 'top-management').map((r) => r.key)).toEqual(
			['essential', 'important']
		);
		const [latest] = getHistory(app, sourceDefinition, src.id);
		expect(latest!.changes[0]).toMatchObject({ label: 'Applies to' });
	});

	it('AI only adds roles: the ones there stay exactly as they are', () => {
		upsertSources(app, human, [
			{
				code: 'iso27002',
				title: 'ISO 27002',
				roles: [{ key: 'organization', label: 'The organisation (edited)' }]
			}
		]);
		upsertSources(app, ai(), [
			{
				code: 'iso27002',
				title: 'ISO 27002',
				roles: [{ key: 'organization', label: 'Organization' }, { label: 'Supplier' }]
			}
		]);
		expect(getSourceByCode(app, 'iso27002')!.roles).toEqual([
			{ key: 'organization', label: 'The organisation (edited)', description: null },
			{ key: 'supplier', label: 'Supplier', description: null }
		]);
		// Writing the list directly does not get round it.
		const src = getSourceByCode(app, 'iso27002')!;
		expect(() =>
			updateEntity(app, ai(), sourceDefinition, src.id, src.version, { roles: [{ label: 'Supplier' }] })
		).toThrow(/AI can add roles but not remove or change them \(The organisation \(edited\)\)/);
	});

	it('a person can set the roles before any AI run: the proposed source is made with the first one', () => {
		const id = createImportSource(app, human, {
			documentId: 'doc-1',
			code: 'ISO27002',
			title: 'ISO 27002',
			role: { label: 'Организация' }
		});
		const src = getSourceByCode(app, 'iso27002')!;
		expect(src).toMatchObject({ id, status: 'proposed', documentId: 'doc-1' });
		// A label without Latin letters gets a numbered key.
		expect(src.roles).toEqual([{ key: 'role-1', label: 'Организация', description: null }]);
		expect(() =>
			createImportSource(app, human, {
				documentId: 'doc-1',
				code: 'iso27002',
				title: 'X',
				role: { label: 'A' }
			})
		).toThrow('exists already');
	});
});
