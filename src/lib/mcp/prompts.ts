import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppDatabase } from '#lib/db/client.ts';
import { effectiveSkill, frontMatter, skillNames, withoutFrontMatter } from '#lib/domain/skills.ts';
import { SKILLS_DIR } from '#lib/reports/template.ts';

/** "audit-plan-builder" → "Audit plan builder". */
const titleOf = (name: string) => name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Each connector skill as an MCP prompt (#80), so an auditor's Claude can start one without installing
 * it, and always gets the version saved on this instance. A prompt cannot carry files, so the shared
 * rules from `references/audit-rules.md` follow the instructions.
 */
export function registerSkillPrompts(server: McpServer, app: AppDatabase): void {
	for (const name of skillNames()) {
		const description = frontMatter(effectiveSkill(app, 'connector', name)).description ?? titleOf(name);
		server.registerPrompt(name, { title: titleOf(name), description }, () => {
			const rulesFile = path.join(SKILLS_DIR(), name, 'references', 'audit-rules.md');
			const rules = existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8').trim() : '';
			const text = [
				withoutFrontMatter(effectiveSkill(app, 'connector', name)),
				rules ? `---\n\nThe skill refers to references/audit-rules.md. Here it is:\n\n${rules}` : ''
			]
				.filter(Boolean)
				.join('\n\n');
			return {
				description,
				messages: [{ role: 'user', content: { type: 'text', text } }]
			};
		});
	}
}
