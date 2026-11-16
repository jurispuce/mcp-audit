import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '#lib/db/client.ts';
import { SKILLS_DIR } from '#lib/reports/template.ts';
import { NotFoundError, ValidationError } from './errors';
import { registerEntity } from './registry';
import { requireAdmin } from './users';
import {
	createEntity,
	deleteEntity,
	updateEntity,
	type Actor,
	type EntityDefinition,
	type Row
} from './write';

/**
 * The two skill sets (#80). Each skill in `skills/<name>/` has:
 * - `SKILL.md`: for the auditor's own Claude with the mcp-audit connector (conversational, asks first,
 *   may research), shipped as an Agent Skill with its `references/` and `assets/`;
 * - `APP.md`: for the in-app AI buttons (one-shot, inputs from the screen, never asks).
 * Admins edit either in Settings, Skills; an edit is shared by the whole instance and versioned.
 */

export const SKILL_SETS = ['app', 'connector'] as const;
export type SkillSet = (typeof SKILL_SETS)[number];
export const SKILL_SET_LABELS: Record<SkillSet, string> = {
	app: 'In the app',
	connector: 'For your Claude'
};
const FILE: Record<SkillSet, string> = { app: 'APP.md', connector: 'SKILL.md' };
const MAX_BODY = 100_000;

export function isSkillSet(v: unknown): v is SkillSet {
	return typeof v === 'string' && (SKILL_SETS as readonly string[]).includes(v);
}

/** The skills shipped with the app: every folder of `skills/` with both files. */
export function skillNames(): string[] {
	const dir = SKILLS_DIR();
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && SKILL_SETS.every((s) => existsSync(path.join(dir, d.name, FILE[s]))))
		.map((d) => d.name)
		.sort();
}

function assertSkill(set: SkillSet, name: string): void {
	if (!isSkillSet(set)) throw new ValidationError('Unknown skill set.');
	if (!skillNames().includes(name)) throw new NotFoundError(`No skill ${name}.`);
}

export function defaultSkill(set: SkillSet, name: string): string {
	assertSkill(set, name);
	return readFileSync(path.join(SKILLS_DIR(), name, FILE[set]), 'utf8');
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** The YAML front matter's `name` and `description`, read without a YAML parser. */
export function frontMatter(body: string): { name: string | null; description: string | null } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
	const field = (k: string) => {
		const v = m ? new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1]!)?.[1]?.trim() : undefined;
		return v ? v.replace(/^["']|["']$/g, '') : null;
	};
	return { name: field('name'), description: field('description') };
}

/** The instructions without the front matter. */
export function withoutFrontMatter(body: string): string {
	return body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

export const skillDefinition: EntityDefinition = registerEntity({
	type: 'skill_override',
	table: 'skill_override',
	columns: ['skill_set', 'name', 'body', 'default_hash'],
	detailColumns: ['skill_set', 'name'],
	fieldLabels: { skill_set: 'Set', name: 'Skill', body: 'Instructions', default_hash: 'Based on default' },
	formatValue(column, value) {
		if (column === 'skill_set') return SKILL_SET_LABELS[value as SkillSet] ?? String(value ?? '');
		if (column === 'default_hash') return String(value ?? '').slice(0, 12);
		if (column === 'deleted') return Number(value) === 1 ? 'Yes (default restored)' : 'No';
		return value == null ? '' : String(value);
	},
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.skill_set = String(input.skill_set);
			out.name = String(input.name);
		}
		if ('body' in input || !existing) {
			const body = String(input.body ?? '').replace(/\r\n/g, '\n');
			if (!body.trim()) throw new ValidationError('The skill has no instructions.', { body: 'Required' });
			if (body.length > MAX_BODY)
				throw new ValidationError('At most 100,000 characters.', { body: 'Too long' });
			const set = (existing?.skill_set ?? out.skill_set) as SkillSet;
			if (set === 'connector') {
				const fm = frontMatter(body);
				const name = String(existing?.name ?? out.name);
				if (fm.name !== name || !fm.description)
					throw new ValidationError(
						`Keep the front matter at the top: name: ${name} and a description of when to use the skill. Claude uses them to pick the skill.`,
						{ body: 'Front matter' }
					);
			}
			out.body = body;
		}
		if ('default_hash' in input) out.default_hash = String(input.default_hash);
		return out;
	},
	authorize(app, actor) {
		requireAdmin(app, actor);
	},
	label: (row) => `${row.name} (${SKILL_SET_LABELS[row.skill_set as SkillSet] ?? row.skill_set})`,
	refLine: () => 'Skill'
});

function overrideOf(app: AppDatabase, set: SkillSet, name: string): Row | null {
	return (
		(app.sqlite
			.prepare('SELECT * FROM skill_override WHERE skill_set = ? AND name = ? AND deleted = 0')
			.get(set, name) as Row | undefined) ?? null
	);
}

export interface SkillView {
	set: SkillSet;
	name: string;
	description: string | null;
	body: string;
	defaultBody: string;
	/** Edited in the app; otherwise the shipped default. */
	edited: boolean;
	/** Edited, and the shipped default changed since (a release updated it). */
	newerDefault: boolean;
	/** The override's id and version, for history and safe saves. */
	id: string | null;
	version: number | null;
}

export function getSkill(app: AppDatabase, set: SkillSet, name: string): SkillView {
	const defaultBody = defaultSkill(set, name);
	const o = overrideOf(app, set, name);
	const body = o ? String(o.body) : defaultBody;
	return {
		set,
		name,
		description: frontMatter(set === 'connector' ? body : defaultSkill('connector', name)).description,
		body,
		defaultBody,
		edited: !!o,
		newerDefault: !!o && o.default_hash !== sha(defaultBody),
		id: o ? String(o.id) : null,
		version: o ? Number(o.current_version) : null
	};
}

export function listSkills(app: AppDatabase, set: SkillSet): SkillView[] {
	return skillNames().map((n) => getSkill(app, set, n));
}

/** What a skill says now: the edit if there is one, else the default. */
export function effectiveSkill(app: AppDatabase, set: SkillSet, name: string): string {
	const o = overrideOf(app, set, name);
	return o ? String(o.body) : defaultSkill(set, name);
}

/** Save an edit (admins). The first edit creates the override; later ones are new versions. */
export function saveSkill(
	app: AppDatabase,
	actor: Actor,
	set: SkillSet,
	name: string,
	body: string,
	baseVersion?: number | null
): SkillView {
	requireAdmin(app, actor);
	const def = defaultSkill(set, name);
	const o = overrideOf(app, set, name);
	const defaultHash = sha(def);
	if (!o) {
		if (body.replace(/\r\n/g, '\n') === def) return getSkill(app, set, name);
		createEntity(app, actor, skillDefinition, { skill_set: set, name, body, default_hash: defaultHash });
	} else {
		updateEntity(app, actor, skillDefinition, String(o.id), baseVersion ?? Number(o.current_version), {
			body,
			default_hash: defaultHash
		});
	}
	return getSkill(app, set, name);
}

/** Back to the shipped default. The edit stays in history and can be restored from there. */
export function resetSkill(app: AppDatabase, actor: Actor, set: SkillSet, name: string): SkillView {
	requireAdmin(app, actor);
	assertSkill(set, name);
	const o = overrideOf(app, set, name);
	if (o)
		deleteEntity(app, actor, skillDefinition, String(o.id), Number(o.current_version), 'Reset to default');
	return getSkill(app, set, name);
}

/** The files of a connector skill as an Agent Skill folder: SKILL.md (as edited) and its resources. */
export function connectorSkillFiles(app: AppDatabase, name: string): { path: string; content: Buffer }[] {
	assertSkill('connector', name);
	const root = path.join(SKILLS_DIR(), name);
	const files: { path: string; content: Buffer }[] = [
		{ path: `${name}/SKILL.md`, content: Buffer.from(effectiveSkill(app, 'connector', name)) }
	];
	for (const sub of ['references', 'assets']) {
		const dir = path.join(root, sub);
		if (!existsSync(dir)) continue;
		for (const f of readdirSync(dir).sort())
			files.push({ path: `${name}/${sub}/${f}`, content: readFileSync(path.join(dir, f)) });
	}
	return files;
}
