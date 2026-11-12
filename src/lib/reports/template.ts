import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Fill a report template from `skills/<skill>/assets/` (Markdown with {{placeholders}}). The skills
 * and the app share the same templates, so a report looks the same whichever produced it.
 *
 * Rules, applied line by line:
 * - `{{key}}` inside a line is replaced by `values[key]` (escaped for Markdown).
 * - A line that is only a placeholder (an instruction such as `{{One or two sentences: ...}}`) is
 *   replaced by `blocks[<current ## heading>]`, raw Markdown the caller built.
 * - A table row with placeholders is repeated for each item of `rows[<current ## heading>]`.
 * - A `###` heading with placeholders starts a block repeated for each item of
 *   `sections[<current ## heading>]`; a `- {{...}}` line inside it repeats for each of the item's `items`.
 * - Before filling, lines found in `translations` are swapped for the report language's version.
 */

export const SKILLS_DIR = () => path.resolve(process.env.SKILLS_DIR ?? 'skills');

export function readTemplate(skill: string, file: string): string {
	const p = path.join(SKILLS_DIR(), skill, 'assets', file);
	if (!existsSync(p)) throw new Error(`Report template ${skill}/assets/${file} is missing.`);
	return readFileSync(p, 'utf8');
}

export interface TemplateData {
	values: Record<string, string>;
	blocks?: Record<string, string>;
	rows?: Record<string, Record<string, string>[]>;
	sections?: Record<string, { values: Record<string, string>; items: string[] }[]>;
	/** English template line -> line in the report language. */
	translations?: Record<string, string>;
}

const PLACEHOLDER = /\{\{([^}]+)\}\}/g;

/** Escape text so it reads literally in Markdown (and never turns into HTML). */
export function md(text: string | null | undefined): string {
	return String(text ?? '')
		.replace(/\r?\n/g, ' ')
		.replace(/[\\`*_[\]<>|#]/g, (c) => `\\${c}`)
		.trim();
}

export function fillTemplate(template: string, data: TemplateData): string {
	const tr = data.translations ?? {};
	const lines = template.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let section = '';
	const fill = (line: string, values: Record<string, string>) =>
		line.replace(PLACEHOLDER, (_, key: string) => md(values[key.trim()] ?? data.values[key.trim()] ?? ''));

	for (let i = 0; i < lines.length; i++) {
		const english = lines[i]!;
		const line = tr[english] ?? english;
		const h2 = english.match(/^## (.+)$/);
		if (h2) section = h2[1]!.trim();

		if (/^### .*\{\{/.test(english)) {
			// Repeated block: this heading and its lines up to the next heading.
			let end = i + 1;
			while (end < lines.length && !/^#{1,3} /.test(lines[end]!)) end++;
			const body = lines.slice(i + 1, end);
			for (const item of data.sections?.[section] ?? []) {
				out.push(fill(line, item.values));
				for (const b of body) {
					const bl = tr[b] ?? b;
					if (/^- .*\{\{/.test(b)) for (const text of item.items) out.push(`- ${md(text)}`);
					else out.push(fill(bl, item.values));
				}
			}
			i = end - 1;
			continue;
		}
		if (/^\|.*\{\{/.test(english)) {
			for (const row of data.rows?.[section] ?? []) out.push(fill(line, row));
			continue;
		}
		if (/^\{\{[^}]+\}\}$/.test(english.trim())) {
			out.push(data.blocks?.[section] ?? '');
			continue;
		}
		out.push(fill(line, data.values));
	}
	return (
		out
			.join('\n')
			.replace(/[ \t]+$/gm, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim() + '\n'
	);
}
