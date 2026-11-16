import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { ACTION_TOOLS } from '#lib/ai/runner.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { AI_ACTION_KEYS, AI_ACTIONS } from '#lib/domain/ai-settings.ts';
import { frontMatter, skillNames } from '#lib/domain/skills.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';
import { createMcpServer } from './server';

const SKILLS = path.resolve(import.meta.dirname, '../../../skills');
const TOOL_NAME =
	/`((?:list|get|upsert|select|set|register|search|link|add|propose|render)(?:_[a-z]+)+|revert)`/g;
const read = (skill: string, file: string) => readFileSync(path.join(SKILLS, skill, file), 'utf8');
const named = (text: string) => [...new Set([...text.matchAll(TOOL_NAME)].map((m) => m[1]!))];

async function serverTools(): Promise<Set<string>> {
	const app = createTestDatabase();
	const admin = await createFirstAdmin(app, {
		name: 'A',
		email: 'a@example.test',
		password: 'correct horse battery'
	});
	const server = createMcpServer(app, { ...admin, mustChangePassword: false } as never);
	const [c, s] = InMemoryTransport.createLinkedPair();
	await server.connect(s);
	const client = new Client({ name: 't', version: '1' });
	await client.connect(c);
	const tools = new Set((await client.listTools()).tools.map((t) => t.name));
	await client.close();
	app.close();
	return tools;
}

describe('the two skill sets (#80)', () => {
	it('ships seven skills, each with a connector SKILL.md and an in-app APP.md, without files mode', () => {
		expect(skillNames()).toEqual([
			'audit-assurance-review',
			'audit-document-analysis',
			'audit-engagement-setup',
			'audit-event-debrief',
			'audit-library-curator',
			'audit-plan-builder',
			'audit-role-discovery'
		]);
		for (const skill of skillNames()) {
			const connector = read(skill, 'SKILL.md');
			expect(frontMatter(connector).name, skill).toBe(skill);
			expect(frontMatter(connector).description?.length, skill).toBeGreaterThan(100);
			expect(connector, skill).toContain('references/audit-rules.md');
			for (const file of ['SKILL.md', 'APP.md'])
				expect(read(skill, file), `${skill}/${file}`).not.toMatch(/files mode|\.ya?ml\b|engagement-files/i);
		}
		// Every in-app action has its skill.
		for (const a of AI_ACTION_KEYS) expect(skillNames()).toContain(AI_ACTIONS[a].skill);
	});

	it('connector skills name only tools the MCP server offers', async () => {
		const tools = await serverTools();
		for (const skill of skillNames()) {
			const names = named(read(skill, 'SKILL.md'));
			expect(names.length, skill).toBeGreaterThan(2);
			expect(
				names.filter((n) => !tools.has(n)),
				skill
			).toEqual([]);
		}
	});

	it('in-app skills name only tools their actions are given', () => {
		for (const skill of skillNames()) {
			const allowed = new Set(
				AI_ACTION_KEYS.filter((a) => AI_ACTIONS[a].skill === skill).flatMap((a) => ACTION_TOOLS[a])
			);
			const names = named(read(skill, 'APP.md'));
			expect(names.length, skill).toBeGreaterThan(1);
			expect(
				names.filter((n) => !allowed.has(n)),
				skill
			).toEqual([]);
		}
	});
});
