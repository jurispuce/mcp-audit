import { describe, expect, it } from 'vitest';
import { makeXlsx } from '../../../tests/fixtures/make-docs';
import { extractText, pageOf } from './artifacts';
import { xlsxSheets } from './xlsx-text';

describe('reading .xlsx risk registers (#78)', () => {
	it('gives each sheet as a page and each row as a line, keeping empty cells in place', async () => {
		const bytes = await makeXlsx({
			Risks: [
				['ID', 'Risk', 'Likelihood', 'Impact', 'Owner'],
				['R-1', 'Ransomware encrypts file servers', 4, 5, 'Head of IT'],
				['R-2', 'Backups & restores <untested>', null, 3, 'IT ops']
			],
			'Scale & notes': [['5 = almost certain']]
		});
		expect(await xlsxSheets(bytes)).toEqual([
			{
				name: 'Risks',
				text: 'Sheet: Risks\nID | Risk | Likelihood | Impact | Owner\nR-1 | Ransomware encrypts file servers | 4 | 5 | Head of IT\nR-2 | Backups & restores <untested> |  | 3 | IT ops'
			},
			{ name: 'Scale & notes', text: 'Sheet: Scale & notes\n5 = almost certain' }
		]);
		const ex = await extractText(bytes, 'register.xlsx');
		expect(ex.status).toBe('extracted');
		expect(ex.pageStarts).toHaveLength(2);
		expect(pageOf(ex.text, ex.pageStarts, ex.text.indexOf('Sheet: Scale'), 500).locator).toBe('p. 2');
	});

	it('a file that is not a workbook is marked failed, not thrown', async () => {
		expect((await extractText(new TextEncoder().encode('not a zip'), 'broken.xlsx')).status).toBe('failed');
	});
});
