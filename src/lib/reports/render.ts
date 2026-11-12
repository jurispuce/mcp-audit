import { createRequire } from 'node:module';
import path from 'node:path';
import {
	AlignmentType,
	BorderStyle,
	Document,
	HeadingLevel,
	Packer,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType
} from 'docx';
import { Marked, type Token, type Tokens } from 'marked';
import PDFDocument from 'pdfkit';

/**
 * One Markdown source, three outputs: HTML for the preview, DOCX and PDF for the auditee. Supports
 * what the report templates use: headings, paragraphs with bold and italics, bullet lists, tables.
 * Used by the audit plan (#50), post-event report (#56) and findings report (#59).
 */

const escapeHtml = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const marked = new Marked({
	gfm: true,
	renderer: {
		// Raw HTML in a report is shown as text, never rendered.
		html: ({ text }) => escapeHtml(text),
		link: ({ text }) => escapeHtml(text)
	}
});

export function markdownToHtml(source: string): string {
	return marked.parse(source, { async: false }) as string;
}

interface Run {
	text: string;
	bold?: boolean;
	italic?: boolean;
}

/** Flatten inline tokens to styled text runs. */
function runs(tokens: Token[] | undefined, style: Omit<Run, 'text'> = {}): Run[] {
	const out: Run[] = [];
	for (const t of tokens ?? []) {
		switch (t.type) {
			case 'strong':
				out.push(...runs((t as Tokens.Strong).tokens, { ...style, bold: true }));
				break;
			case 'em':
				out.push(...runs((t as Tokens.Em).tokens, { ...style, italic: true }));
				break;
			case 'text':
				if ((t as Tokens.Text).tokens?.length) out.push(...runs((t as Tokens.Text).tokens, style));
				else out.push({ text: decode((t as Tokens.Text).text), ...style });
				break;
			case 'escape':
				out.push({ text: (t as Tokens.Escape).text, ...style });
				break;
			case 'codespan':
				out.push({ text: decode((t as Tokens.Codespan).text), ...style });
				break;
			case 'br':
				out.push({ text: '\n', ...style });
				break;
			case 'link':
				out.push(...runs((t as Tokens.Link).tokens, style));
				break;
			default:
				if ('text' in t) out.push({ text: decode(String(t.text)), ...style });
		}
	}
	return out;
}

const decode = (s: string) =>
	s.replace(
		/&(amp|lt|gt|quot|#39);/g,
		(_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!
	);

const plain = (rs: Run[]) => rs.map((r) => r.text).join('');

// ---- DOCX

export async function markdownToDocx(
	source: string,
	options: { title: string; language?: string }
): Promise<Buffer> {
	const tokens = marked.lexer(source);
	const children: (Paragraph | Table)[] = [];
	const textRuns = (rs: Run[], extra: { size?: number } = {}) =>
		rs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, ...extra }));
	const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };

	for (const t of tokens) {
		if (t.type === 'heading') {
			const h = t as Tokens.Heading;
			const level = [
				HeadingLevel.TITLE,
				HeadingLevel.HEADING_1,
				HeadingLevel.HEADING_2,
				HeadingLevel.HEADING_3
			][Math.min(h.depth, 4) - 1];
			children.push(new Paragraph({ heading: level, children: textRuns(runs(h.tokens)) }));
		} else if (t.type === 'paragraph') {
			// Lines of "**Label:** value" stay separate lines, as in the template.
			const rs = runs((t as Tokens.Paragraph).tokens);
			const lines: Run[][] = [[]];
			for (const r of rs) {
				const parts = r.text.split('\n');
				parts.forEach((p, i) => {
					if (i > 0) lines.push([]);
					if (p) lines[lines.length - 1]!.push({ ...r, text: p });
				});
			}
			for (const l of lines) children.push(new Paragraph({ children: textRuns(l), spacing: { after: 80 } }));
		} else if (t.type === 'list') {
			for (const item of (t as Tokens.List).items)
				children.push(
					new Paragraph({
						bullet: { level: 0 },
						children: textRuns(runs(item.tokens.flatMap((x) => ('tokens' in x && x.tokens ? x.tokens : [x]))))
					})
				);
		} else if (t.type === 'table') {
			const tb = t as Tokens.Table;
			const cell = (rs: Run[], header: boolean) =>
				new TableCell({
					children: [
						new Paragraph({
							children: textRuns(header ? rs.map((r) => ({ ...r, bold: true })) : rs, { size: 18 })
						})
					],
					shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1F4' } : undefined,
					borders: { top: border, bottom: border, left: border, right: border }
				});
			children.push(
				new Table({
					width: { size: 100, type: WidthType.PERCENTAGE },
					rows: [
						new TableRow({ tableHeader: true, children: tb.header.map((h) => cell(runs(h.tokens), true)) }),
						...tb.rows.map((row) => new TableRow({ children: row.map((c) => cell(runs(c.tokens), false)) }))
					]
				}),
				new Paragraph({ children: [] })
			);
		} else if (t.type === 'hr') {
			children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('—')] }));
		}
	}
	const doc = new Document({
		title: options.title,
		creator: 'mcp-audit',
		styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
		sections: [{ children }]
	});
	return Packer.toBuffer(doc);
}

// ---- PDF

const require = createRequire(import.meta.url);
function fontPath(file: string): string {
	return path.join(
		path.dirname(require.resolve('@ibm/plex-sans/package.json')),
		'fonts',
		'complete',
		'woff',
		file
	);
}

export function markdownToPdf(
	source: string,
	options: { title: string; language?: string }
): Promise<Buffer> {
	const tokens = marked.lexer(source);
	const doc = new PDFDocument({
		size: 'A4',
		margin: 50,
		info: { Title: options.title, Creator: 'mcp-audit' },
		lang: options.language,
		bufferPages: true
	});
	doc.registerFont('regular', fontPath('IBMPlexSans-Regular.woff'));
	doc.registerFont('bold', fontPath('IBMPlexSans-SemiBold.woff'));
	doc.registerFont('italic', fontPath('IBMPlexSans-Italic.woff'));
	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
	const width = doc.page.width - 100;
	const fontOf = (r: Run) => (r.bold ? 'bold' : r.italic ? 'italic' : 'regular');

	const writeRuns = (rs: Run[], size: number, opts: PDFKit.Mixins.TextOptions = {}) => {
		const list = rs.length ? rs : [{ text: '' }];
		list.forEach((r, i) => {
			doc
				.font(fontOf(r))
				.fontSize(size)
				.text(r.text, { ...opts, continued: i < list.length - 1 });
		});
	};

	for (const t of tokens) {
		if (t.type === 'heading') {
			const h = t as Tokens.Heading;
			const size = [20, 15, 12.5, 11][Math.min(h.depth, 4) - 1]!;
			doc.moveDown(h.depth === 1 ? 0 : 0.6);
			doc
				.font('bold')
				.fontSize(size)
				.fillColor('#111417')
				.text(plain(runs(h.tokens)), { width });
			doc.moveDown(0.3);
		} else if (t.type === 'paragraph') {
			writeRuns(runs((t as Tokens.Paragraph).tokens), 10.5, { width, lineGap: 2 });
			doc.moveDown(0.5);
		} else if (t.type === 'list') {
			for (const item of (t as Tokens.List).items) {
				const y = doc.y;
				doc.font('regular').fontSize(10.5).text('•', 58, y);
				doc.y = y;
				writeRuns(runs(item.tokens.flatMap((x) => ('tokens' in x && x.tokens ? x.tokens : [x]))), 10.5, {
					width: width - 20,
					indent: 0,
					lineGap: 2
				});
				doc.x = 50;
			}
			doc.x = 50;
			doc.moveDown(0.5);
		} else if (t.type === 'table') {
			drawTable(doc, t as Tokens.Table, width);
			doc.moveDown(0.8);
		}
		doc.x = 50;
	}
	// Page numbers.
	const range = doc.bufferedPageRange();
	for (let i = 0; i < range.count; i++) {
		doc.switchToPage(i);
		doc
			.font('regular')
			.fontSize(8)
			.fillColor('#6b7280')
			.text(`${options.title} · ${i + 1}/${range.count}`, 50, doc.page.height - 35, {
				width,
				align: 'center',
				lineBreak: false
			});
	}
	doc.end();
	return done;
}

function drawTable(doc: PDFKit.PDFDocument, tb: Tokens.Table, width: number) {
	const header = tb.header.map((h) => plain(runs(h.tokens)));
	const rows = tb.rows.map((r) => r.map((c) => plain(runs(c.tokens))));
	// Column widths follow content length, within limits.
	const weight = header.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => Math.min((r[i] ?? '').length, 40)), 6)
	);
	const total = weight.reduce((a, b) => a + b, 0);
	const widths = weight.map((w) => (w / total) * width);
	const pad = 4;
	const size = 8.5;
	const rowHeight = (cells: string[], font: string) =>
		Math.max(
			...cells.map((c, i) =>
				doc
					.font(font)
					.fontSize(size)
					.heightOfString(c || ' ', { width: widths[i]! - pad * 2 })
			)
		) +
		pad * 2;
	const drawRow = (cells: string[], font: string, fill?: string) => {
		const h = rowHeight(cells, font);
		if (doc.y + h > doc.page.height - 60) {
			doc.addPage();
			if (font === 'regular') drawRow(header, 'bold', '#eef1f4');
		}
		let x = 50;
		const y = doc.y;
		cells.forEach((c, i) => {
			const w = widths[i]!;
			if (fill) doc.rect(x, y, w, h).fill(fill);
			doc.rect(x, y, w, h).lineWidth(0.5).strokeColor('#bbbbbb').stroke();
			doc
				.fillColor('#111417')
				.font(font)
				.fontSize(size)
				.text(c, x + pad, y + pad, { width: w - pad * 2 });
			x += w;
		});
		doc.x = 50;
		doc.y = y + h;
	};
	drawRow(header, 'bold', '#eef1f4');
	for (const r of rows) drawRow(r, 'regular');
}
