import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';
import { createMcpServer } from './server';

const SKILLS = path.resolve(import.meta.dirname, '../../../skills');
const TOOL_NAME = /`((?:list|get|upsert|select|set|register|search|link|add)(?:_[a-z]+)+|revert)`/g;

/** The app-mode part of a skill: from "## Where ..." up to the next "## " heading after it. */
function appModeSection(text: string): string | null {
	const start = text.search(/^## Where /m);
	if (start < 0) return null;
	const rest = text.slice(start + 3);
	const end = rest.search(/^## /m);
	return end < 0 ? rest : rest.slice(0, end);
}

describe('skills in MCP mode (#34, #44)', () => {
	it('name only tools the MCP server offers', async () => {
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

		const migrated = [
			'audit-library-curator',
			'audit-engagement-setup',
			'audit-document-analysis',
			'audit-role-discovery'
		];
		for (const skill of readdirSync(SKILLS)) {
			const section = appModeSection(readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8'));
			if (!migrated.includes(skill)) continue;
			expect(section, `${skill} has an app-mode section`).toBeTruthy();
			const named = [...section!.matchAll(TOOL_NAME)].map((m) => m[1]!);
			expect(named.length, skill).toBeGreaterThan(2);
			expect(
				named.filter((n) => !tools.has(n)),
				skill
			).toEqual([]);
		}
	});
});
