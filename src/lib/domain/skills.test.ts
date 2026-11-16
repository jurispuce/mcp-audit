import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { skillInstructions } from '#lib/ai/runner.ts';
import { createMcpServer } from '#lib/mcp/server.ts';
import './entities';
import { ForbiddenError, ValidationError } from './errors';
import { getItemHistory } from './items';
import {
	connectorSkillFiles,
	defaultSkill,
	effectiveSkill,
	getSkill,
	listSkills,
	resetSkill,
	saveSkill
} from './skills';
import { createFirstAdmin, createUser } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let admin: Actor;
let auditor: Actor;
let dir: string;
const previous = process.env.SKILLS_DIR;

beforeEach(async () => {
	// A copy of the shipped skills, so a test can play "a release changed the default".
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-skills-'));
	cpSync(path.resolve(import.meta.dirname, '../../../skills'), dir, { recursive: true });
	process.env.SKILLS_DIR = dir;
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
	const { user: u } = await createUser(app, admin, {
		name: 'Ben',
		email: 'ben@example.test',
		role: 'auditor'
	});
	auditor = { userId: u.id, channel: 'ui' };
});
afterEach(() => {
	app.close();
	rmSync(dir, { recursive: true, force: true });
	process.env.SKILLS_DIR = previous;
});

describe('skills edited in the app (#80)', () => {
	it('uses the default until an admin edits it; the edit is shared and versioned; reset restores the default', () => {
		const name = 'audit-plan-builder';
		expect(listSkills(app, 'app').map((s) => [s.name, s.edited])).toContainEqual([name, false]);
		const def = defaultSkill('app', name);
		expect(() => saveSkill(app, auditor, 'app', name, `${def}\nExtra.`)).toThrow(ForbiddenError);

		saveSkill(app, admin, 'app', name, `${def}\n- Never plan meetings on Fridays after 13:00.`);
		const edited = getSkill(app, 'app', name);
		expect(edited).toMatchObject({ edited: true, newerDefault: false, version: 1 });
		expect(effectiveSkill(app, 'app', name)).toContain('Fridays after 13:00');
		// The in-app AI follows the edit.
		expect(skillInstructions(app, 'draft_plan')).toContain('Fridays after 13:00');
		expect(skillInstructions(app, 'draft_plan')).not.toMatch(/^---/);

		saveSkill(app, admin, 'app', name, `${def}\n- Never plan meetings on Fridays.`, edited.version);
		expect(getSkill(app, 'app', name).version).toBe(2);
		expect(getItemHistory(app, 'skill_override', edited.id!)).toHaveLength(2);

		resetSkill(app, admin, 'app', name);
		expect(getSkill(app, 'app', name)).toMatchObject({ edited: false, body: def });
		expect(getItemHistory(app, 'skill_override', edited.id!)[0]!.note).toBe('Reset to default');
		// Saving the default text unchanged creates nothing.
		expect(saveSkill(app, admin, 'app', name, def).edited).toBe(false);
	});

	it('a connector skill keeps its front matter, which Claude uses to pick the skill', () => {
		const name = 'audit-role-discovery';
		expect(() => saveSkill(app, admin, 'connector', name, 'Just some text.')).toThrow(ValidationError);
		expect(() =>
			saveSkill(app, admin, 'connector', name, '---\nname: something-else\ndescription: x\n---\nText')
		).toThrow(/name: audit-role-discovery/);
		const ok = `---\nname: ${name}\ndescription: "Find who is responsible for what at the auditee."\n---\n\n# Roles\n\nOur way.`;
		expect(saveSkill(app, admin, 'connector', name, ok).description).toBe(
			'Find who is responsible for what at the auditee.'
		);
		expect(() => saveSkill(app, admin, 'nope' as never, name, ok)).toThrow(ValidationError);
		expect(() => getSkill(app, 'app', 'audit-unknown')).toThrow(/No skill/);
	});

	it('says when a release brought a newer default for an edited skill', () => {
		const name = 'audit-event-debrief';
		saveSkill(app, admin, 'app', name, `${defaultSkill('app', name)}\nOurs.`);
		expect(getSkill(app, 'app', name).newerDefault).toBe(false);
		writeFileSync(path.join(dir, name, 'APP.md'), `${defaultSkill('app', name)}\nNew in this release.`);
		expect(getSkill(app, 'app', name)).toMatchObject({ edited: true, newerDefault: true });
		expect(effectiveSkill(app, 'app', name)).toContain('Ours.');
	});

	it('packs a connector skill as an Agent Skill folder with its references and assets', () => {
		saveSkill(
			app,
			admin,
			'connector',
			'audit-plan-builder',
			defaultSkill('connector', 'audit-plan-builder').replace('# Audit plan builder', '# Our plan builder')
		);
		const files = connectorSkillFiles(app, 'audit-plan-builder');
		expect(files.map((f) => f.path)).toEqual([
			'audit-plan-builder/SKILL.md',
			'audit-plan-builder/references/audit-rules.md',
			'audit-plan-builder/assets/audit-plan-template.md'
		]);
		expect(files[0]!.content.toString()).toContain('# Our plan builder');
	});

	it('offers every connector skill as an MCP prompt, as saved on this instance', async () => {
		saveSkill(
			app,
			admin,
			'connector',
			'audit-assurance-review',
			defaultSkill('connector', 'audit-assurance-review') +
				'\n\nHouse rule: cite the ISO clause in every rationale.'
		);
		const server = createMcpServer(app, {
			id: admin.userId,
			name: 'Ada',
			email: 'ada@example.test',
			role: 'admin',
			mustChangePassword: false
		});
		const [c, s] = InMemoryTransport.createLinkedPair();
		await server.connect(s);
		const client = new Client({ name: 't', version: '1' });
		await client.connect(c);
		const prompts = (await client.listPrompts()).prompts;
		expect(prompts.map((p) => p.name)).toHaveLength(7);
		expect(prompts.find((p) => p.name === 'audit-plan-builder')).toMatchObject({
			title: 'Audit plan builder',
			description: expect.stringContaining('fieldwork time')
		});
		const got = await client.getPrompt({ name: 'audit-assurance-review' });
		const text = (got.messages[0]!.content as { text: string }).text;
		expect(text).toContain('House rule: cite the ISO clause');
		expect(text).not.toMatch(/^---/);
		expect(text).toContain('# Rules every audit skill follows');
		await client.close();
	});
});
