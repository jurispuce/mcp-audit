import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { ValidationError } from './errors';
import { getHistory } from './history';
import {
	cleanSourceRoles,
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
import type { Actor } from './write';

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
