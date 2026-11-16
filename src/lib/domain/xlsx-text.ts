/**
 * Text of an .xlsx workbook for search and AI reading (#78): each sheet becomes a page headed with its
 * name, each row a line with its non-empty cells separated by " | ". Values as stored (numbers and
 * dates as numbers); formulas give their last calculated value. Reads the Open XML parts directly.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
		e[0] === '#'
			? String.fromCodePoint(
					e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
				)
			: ENTITIES[e.toLowerCase()]!
	);
}

/** The text of every <t> element in a fragment (a shared string can be split into rich-text runs). */
function texts(fragment: string): string {
	return [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');
}

function attr(tag: string, name: string): string | null {
	return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

/** "AB12" → 27 (zero-based column index). */
function column(ref: string): number {
	const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
	let n = 0;
	for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
	return n - 1;
}

export interface SheetText {
	name: string;
	text: string;
}

export async function xlsxSheets(bytes: Uint8Array): Promise<SheetText[]> {
	const JSZip = (await import('jszip')).default;
	const zip = await JSZip.loadAsync(bytes);
	const read = async (p: string) => (await zip.file(p)?.async('string')) ?? null;

	const shared: string[] = [];
	const sst = await read('xl/sharedStrings.xml');
	if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]!));

	const workbook = (await read('xl/workbook.xml')) ?? '';
	const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
	const target = new Map<string, string>();
	for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
		const id = attr(m[0], 'Id');
		const t = attr(m[0], 'Target');
		if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
	}

	const sheets: SheetText[] = [];
	for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
		const name = decode(attr(m[0], 'name') ?? 'Sheet');
		const rid = attr(m[0], 'r:id');
		const xml = rid && target.get(rid) ? await read(target.get(rid)!) : null;
		if (!xml) continue;
		const lines: string[] = [];
		for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
			const cells: string[] = [];
			for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
				const open = c[1]!;
				const body = c[2] ?? '';
				const type = attr(` ${open}`, 't');
				let value: string;
				if (type === 'inlineStr') value = texts(body);
				else {
					const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
					if (v == null) continue;
					value =
						type === 's'
							? (shared[Number(v)] ?? '')
							: type === 'b'
								? v === '1'
									? 'TRUE'
									: 'FALSE'
								: decode(v);
				}
				value = value.replace(/\s+/g, ' ').trim();
				if (!value) continue;
				const ref = attr(` ${open}`, 'r');
				const at = ref ? column(ref) : cells.length;
				while (cells.length < at) cells.push('');
				cells[at] = value;
			}
			while (cells.length && !cells.at(-1)) cells.pop();
			if (cells.length) lines.push(cells.join(' | '));
		}
		if (lines.length) sheets.push({ name, text: `Sheet: ${name}\n${lines.join('\n')}` });
	}
	return sheets;
}
