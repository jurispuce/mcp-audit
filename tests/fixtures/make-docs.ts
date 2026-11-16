import JSZip from 'jszip';

/** A minimal, valid PDF with one text line per page, for extraction tests. */
export function makePdf(pages: string[]): Uint8Array {
	const objects: string[] = [];
	const n = pages.length;
	// 1 catalog, 2 pages, 3 font, then per page: page object and content stream.
	objects.push('<< /Type /Catalog /Pages 2 0 R >>');
	const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
	objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
	objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	pages.forEach((text, i) => {
		const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`;
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`
		);
		objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	});
	let out = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}

/** A minimal DOCX with one paragraph per line. */
export async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
	);
	zip.file(
		'_rels/.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
	);
	const body = paragraphs
		.map(
			(p) =>
				`<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`
		)
		.join('');
	zip.file(
		'word/document.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
	);
	return zip.generateAsync({ type: 'uint8array' });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A minimal .xlsx workbook: one entry per sheet, rows of cells. Strings go to the shared string table,
 * numbers stay numbers, null leaves the cell empty (to test gaps).
 */
export async function makeXlsx(sheets: Record<string, (string | number | null)[][]>): Promise<Uint8Array> {
	const zip = new JSZip();
	const names = Object.keys(sheets);
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`
	);
	zip.file(
		'_rels/.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
	);
	zip.file(
		'xl/workbook.xml',
		`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
	);
	zip.file(
		'xl/_rels/workbook.xml.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
	);
	const strings: string[] = [];
	const col = (i: number) => {
		let s = '';
		for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
		return s;
	};
	names.forEach((n, si) => {
		const rows = sheets[n]!.map(
			(cells, r) =>
				`<row r="${r + 1}">${cells
					.map((v, c) => {
						if (v === null) return '';
						const ref = `${col(c)}${r + 1}`;
						if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
						strings.push(v);
						return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
					})
					.join('')}</row>`
		).join('');
		zip.file(
			`xl/worksheets/sheet${si + 1}.xml`,
			`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
		);
	});
	zip.file(
		'xl/sharedStrings.xml',
		`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`
	);
	return zip.generateAsync({ type: 'uint8array' });
}
