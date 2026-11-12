import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AppDatabase } from '#lib/db/client.ts';
import { NotFoundError, ValidationError } from './errors';
import {
	addCriterion,
	addLink,
	criteriaOf,
	findRequirement,
	getGuidance,
	getSourceByCode,
	LINK_TYPES,
	requirementDefinition,
	setGuidance,
	sourceDefinition
} from './library';
import { createEntity, readRow, write, type Actor, type Row } from './write';

/**
 * Import a source from a YAML file in the shape the audit skills use (library/sources/<id>.yaml):
 *
 *   id, title, type, edition, language, licence_note,
 *   requirements: [{ id, parent, title, text, locator, language, translation_of,
 *                    links: [{ type, to, coverage, note }], guidance, criteria }]
 *
 * Matching is by source `id` (code) and requirement `id` (reference code), so re-importing the same
 * file changes nothing, and a changed requirement becomes a new version. Requirements missing from
 * the file are left alone and reported. The whole import is one transaction: all or nothing.
 */

export interface ImportReport {
	source: { id: string; code: string; title: string; created: boolean; updated: boolean };
	requirements: { created: number; updated: number; restored: number; unchanged: number };
	notInFile: string[];
	links: { created: number; existing: number };
	guidance: { created: number; updated: number };
	criteria: { created: number };
	warnings: string[];
}

interface FileLink {
	type?: unknown;
	to?: unknown;
	coverage?: unknown;
	note?: unknown;
}
interface FileRequirement {
	id?: unknown;
	parent?: unknown;
	title?: unknown;
	text?: unknown;
	locator?: unknown;
	language?: unknown;
	translation_of?: unknown;
	links?: unknown;
	guidance?: unknown;
	criteria?: unknown;
}

const s = (v: unknown) => (v == null ? '' : String(v).trim());

function parseFile(text: string): Record<string, unknown> {
	let doc: unknown;
	try {
		doc = parseYaml(text);
	} catch (e) {
		throw new ValidationError(
			`The file is not valid YAML: ${e instanceof Error ? e.message.split('\n')[0] : e}`
		);
	}
	if (!doc || typeof doc !== 'object' || Array.isArray(doc))
		throw new ValidationError('The file must describe one source (id, title, requirements).');
	const d = doc as Record<string, unknown>;
	if (!s(d.id)) throw new ValidationError('The source needs an id, for example "nis2".');
	if (!s(d.title)) throw new ValidationError('The source needs a title.');
	if (!Array.isArray(d.requirements)) throw new ValidationError('The source needs a list of requirements.');
	const seen = new Set<string>();
	for (const [i, r] of (d.requirements as FileRequirement[]).entries()) {
		if (!r || typeof r !== 'object') throw new ValidationError(`Requirement ${i + 1} is not a mapping.`);
		const id = s(r.id);
		if (!id) throw new ValidationError(`Requirement ${i + 1} has no id.`);
		if (!s(r.title)) throw new ValidationError(`Requirement ${id} has no title.`);
		if (seen.has(id)) throw new ValidationError(`Requirement ${id} appears twice in the file.`);
		seen.add(id);
	}
	return d;
}

export function importSourceYaml(
	app: AppDatabase,
	actor: Actor,
	yamlText: string,
	options: { fileName?: string } = {}
): ImportReport {
	const doc = parseFile(yamlText);
	const note = `Imported from ${options.fileName ?? 'file'}`;
	const run = app.sqlite.transaction((): ImportReport => {
		const code = s(doc.id).toLowerCase();
		const sourceData: Record<string, unknown> = {
			code,
			type: s(doc.type) || 'standard',
			title: s(doc.title),
			edition: doc.edition ?? null,
			language: s(doc.language) || 'en',
			licence_note: doc.licence_note ?? null
		};

		const existingSource = app.sqlite.prepare('SELECT * FROM source WHERE code = ?').get(code) as
			Row | undefined;
		if (existingSource?.auditee_id)
			throw new ValidationError(`${code} is an internal source and cannot be replaced from a library file.`);
		let sourceRow: Row;
		let sourceCreated = false;
		let sourceUpdated = false;
		if (!existingSource) {
			sourceRow = createEntity(app, actor, sourceDefinition, sourceData, { note }).row;
			sourceCreated = true;
		} else {
			const restore = Number(existingSource.deleted) === 1 ? { deleted: false } : {};
			const res = write(app, actor, sourceDefinition, {
				op: 'update',
				id: String(existingSource.id),
				baseVersion: Number(existingSource.current_version),
				data: { ...sourceData, ...restore },
				note
			});
			sourceRow = res.row;
			sourceUpdated = res.changed;
		}
		const sourceId = String(sourceRow.id);
		const language = String(sourceRow.language);

		const report: ImportReport = {
			source: {
				id: sourceId,
				code,
				title: String(sourceRow.title),
				created: sourceCreated,
				updated: sourceUpdated
			},
			requirements: { created: 0, updated: 0, restored: 0, unchanged: 0 },
			notInFile: [],
			links: { created: 0, existing: 0 },
			guidance: { created: 0, updated: 0 },
			criteria: { created: 0 },
			warnings: []
		};

		const items = doc.requirements as FileRequirement[];
		const idByRef = new Map<string, string>();
		const status = new Map<string, 'created' | 'updated' | 'restored' | 'unchanged'>();
		const positions = new Map<string, number>();

		// Pass 1: requirements, with their parent when it is already known.
		for (const r of items) {
			const ref = s(r.id);
			const parentRef = s(r.parent);
			const pos = positions.get(parentRef) ?? 0;
			positions.set(parentRef, pos + 1);
			const data: Record<string, unknown> = {
				source_id: sourceId,
				ref_code: ref,
				title: s(r.title),
				text: r.text == null ? null : String(r.text).trim(),
				language: s(r.language) || language,
				locator: r.locator ?? null,
				origin: 'external',
				status: 'confirmed',
				position: pos
			};
			// Set the parent now when it is already known (usual case: parents come first in the file).
			const knownParent = parentRef
				? (idByRef.get(parentRef) ?? findRequirement(app, sourceId, parentRef)?.id ?? null)
				: null;
			if (!parentRef || knownParent) data.parent_id = knownParent;
			const existing = app.sqlite
				.prepare('SELECT * FROM requirement WHERE source_id = ? AND ref_code = ?')
				.get(sourceId, ref) as Row | undefined;
			if (!existing) {
				idByRef.set(ref, String(createEntity(app, actor, requirementDefinition, data, { note }).row.id));
				status.set(ref, 'created');
			} else {
				const restoring = Number(existing.deleted) === 1;
				const res = write(app, actor, requirementDefinition, {
					op: 'update',
					id: String(existing.id),
					baseVersion: Number(existing.current_version),
					data: restoring ? { ...data, deleted: false } : data,
					note
				});
				idByRef.set(ref, String(existing.id));
				status.set(ref, restoring ? 'restored' : res.changed ? 'updated' : 'unchanged');
			}
		}

		// Pass 2: parents that came later in the file than their children.
		for (const r of items) {
			const id = idByRef.get(s(r.id))!;
			const parentRef = s(r.parent);
			let parentId: string | null = null;
			if (parentRef) {
				parentId = idByRef.get(parentRef) ?? findRequirement(app, sourceId, parentRef)?.id ?? null;
				if (!parentId) report.warnings.push(`${s(r.id)}: parent ${parentRef} not found; placed at the top.`);
			}
			const current = readRow(app, requirementDefinition, id)!;
			if ((current.parent_id ?? null) !== parentId) {
				write(app, actor, requirementDefinition, {
					op: 'update',
					id,
					baseVersion: Number(current.current_version),
					data: { parent_id: parentId },
					note
				});
				if (status.get(s(r.id)) === 'unchanged') status.set(s(r.id), 'updated');
			}
		}

		// Pass 3: translations, links, guidance and criteria.
		const resolve = (target: unknown): string | null => {
			let srcCode = code;
			let ref: string;
			if (target && typeof target === 'object') {
				const t = target as Record<string, unknown>;
				srcCode = s(t.source || code).toLowerCase();
				ref = s(t.id ?? t.ref);
			} else {
				ref = s(target);
				const at = ref.indexOf(':');
				if (at > 0 && getSourceByCode(app, ref.slice(0, at))) {
					srcCode = ref.slice(0, at).toLowerCase();
					ref = ref.slice(at + 1).trim();
				}
			}
			if (!ref) return null;
			if (srcCode === code) return idByRef.get(ref) ?? findRequirement(app, sourceId, ref)?.id ?? null;
			const other = getSourceByCode(app, srcCode);
			return other ? (findRequirement(app, other.id, ref)?.id ?? null) : null;
		};

		for (const r of items) {
			const ref = s(r.id);
			const id = idByRef.get(ref)!;

			if (r.translation_of) {
				const target = resolve(r.translation_of);
				if (!target)
					report.warnings.push(`${ref}: translation_of ${JSON.stringify(r.translation_of)} not found.`);
				else {
					const current = readRow(app, requirementDefinition, id)!;
					const other = readRow(app, requirementDefinition, target)!;
					const root = (other.translation_of as string | null) ?? target;
					if (current.translation_of !== root) {
						write(app, actor, requirementDefinition, {
							op: 'update',
							id,
							baseVersion: Number(current.current_version),
							data: { translation_of: root },
							note
						});
					}
				}
			}

			for (const l of Array.isArray(r.links) ? (r.links as FileLink[]) : []) {
				const type = s(l.type);
				if (!(LINK_TYPES as readonly string[]).includes(type)) {
					report.warnings.push(`${ref}: unknown link type ${type || '(none)'}; skipped.`);
					continue;
				}
				const to = resolve(l.to);
				if (!to) {
					report.warnings.push(`${ref}: link target ${JSON.stringify(l.to)} not found; skipped.`);
					continue;
				}
				const dup = app.sqlite
					.prepare(
						'SELECT id FROM requirement_link WHERE from_id = ? AND to_id = ? AND type = ? AND deleted = 0'
					)
					.get(id, to, type);
				if (dup) {
					report.links.existing++;
					continue;
				}
				addLink(app, actor, {
					fromId: id,
					toId: to,
					type,
					coverage: l.coverage == null ? (type === 'implements' ? 'full' : null) : s(l.coverage),
					note: l.note == null ? null : s(l.note)
				});
				report.links.created++;
			}

			const body = s(r.guidance);
			if (body) {
				const current = getGuidance(app, id);
				if (!current) {
					setGuidance(app, actor, id, body);
					report.guidance.created++;
				} else if (current.body !== body) {
					setGuidance(app, actor, id, body, current.version);
					report.guidance.updated++;
				}
			}

			const have = new Set(criteriaOf(app, id).map((c) => c.text));
			for (const c of Array.isArray(r.criteria) ? r.criteria : []) {
				const text = typeof c === 'object' && c ? s((c as Record<string, unknown>).text) : s(c);
				if (!text || have.has(text)) continue;
				const evidence =
					typeof c === 'object' && c ? (c as Record<string, unknown>).expected_evidence : undefined;
				addCriterion(app, actor, id, {
					text,
					expectedEvidence: Array.isArray(evidence) ? evidence.map(String) : s(evidence)
				});
				have.add(text);
				report.criteria.created++;
			}
		}

		for (const v of status.values()) report.requirements[v]++;

		const inFile = new Set(items.map((r) => s(r.id)));
		report.notInFile = (
			app.sqlite
				.prepare('SELECT ref_code FROM requirement WHERE source_id = ? AND deleted = 0')
				.all(sourceId) as { ref_code: string }[]
		)
			.map((r) => r.ref_code)
			.filter((r) => !inFile.has(r));
		return report;
	});
	return run();
}

// ---- Sources that ship with the app

export function seedDirectory(): string {
	return path.resolve(process.env.SEED_DIR ?? 'seed/library');
}

export interface BuiltInSource {
	file: string;
	code: string;
	title: string;
	requirements: number;
}

/** YAML sources bundled with the app (seed/library), offered on the Library screen. */
export function builtInSources(dir = seedDirectory()): BuiltInSource[] {
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
	} catch {
		return [];
	}
	return files.sort().map((file) => {
		const doc = parseFile(readFileSync(path.join(dir, file), 'utf8'));
		return {
			file,
			code: s(doc.id).toLowerCase(),
			title: s(doc.title),
			requirements: (doc.requirements as unknown[]).length
		};
	});
}

export function importBuiltInSource(
	app: AppDatabase,
	actor: Actor,
	file: string,
	dir = seedDirectory()
): ImportReport {
	const known = builtInSources(dir).find((b) => b.file === file);
	if (!known) throw new NotFoundError(`No bundled source ${file}`);
	return importSourceYaml(app, actor, readFileSync(path.join(dir, known.file), 'utf8'), {
		fileName: known.file
	});
}
