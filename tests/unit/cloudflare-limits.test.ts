import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { MODEL_CHECK_TIMEOUT_MS, MODEL_LIST_TIMEOUT_MS } from '#lib/ai/llm.ts';
import { extractText } from '#lib/domain/artifacts.ts';

/**
 * #92: behind Cloudflare a request must start answering within 100 seconds, or the visitor gets an
 * error page. What a person waits for inside one request therefore has to stay well below that.
 * (AI actions run as background jobs and are polled; MCP calls answer as JSON, one request each.)
 */
const CLOUDFLARE_MS = 100_000;

function pdf(pages: number): Promise<Uint8Array> {
	const doc = new PDFDocument({ compress: false });
	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const done = new Promise<Uint8Array>((resolve) =>
		doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
	);
	const paragraph =
		'The organisation shall establish, implement and maintain an information security policy. '.repeat(40);
	for (let i = 0; i < pages; i++) {
		if (i) doc.addPage();
		doc.fontSize(9).text(`Page ${i + 1}. ${paragraph}`);
	}
	doc.end();
	return done;
}

describe('requests stay under Cloudflare’s 100 seconds (#92)', () => {
	it('calls to the AI gateway that a person waits for give up long before', () => {
		expect(MODEL_LIST_TIMEOUT_MS).toBeLessThanOrEqual(CLOUDFLARE_MS / 2);
		expect(MODEL_CHECK_TIMEOUT_MS).toBeLessThanOrEqual(CLOUDFLARE_MS * 0.6);
	});

	it('reading the text of a large upload takes seconds, not minutes', async () => {
		// 800 pages of dense text, about 9 MB: larger than nearly any policy document.
		const bytes = await pdf(800);
		expect(bytes.length).toBeGreaterThan(5_000_000);
		const started = Date.now();
		const out = await extractText(bytes, 'large.pdf', 'application/pdf');
		const seconds = (Date.now() - started) / 1000;
		expect(JSON.stringify(out).length).toBeGreaterThan(1_000_000);
		// Measured: about 3 s here, and 11 s for 3,000 pages (35 MB). The margin allows a slow server.
		expect(seconds).toBeLessThan(30);
	}, 60_000);
});
