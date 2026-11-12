import { makePdf } from '../../tests/fixtures/make-docs';
import { ADMIN, expect, loginAs, seed, test, unique } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('upload a law, import it through Claude, review, edit and publish it, then map it with a person in the loop (#69-#74)', async ({
	page,
	baseURL
}) => {
	const code = unique('law').toLowerCase();
	// 1. Upload the document on Library, Import.
	await page.goto('/library/import');
	await page.getByLabel('Upload a law or standard').setInputFiles({
		name: `${code}.pdf`,
		mimeType: 'application/pdf',
		buffer: Buffer.from(
			makePdf(['5. Risk management', '5.1 Risks are assessed once a year. 6. Access control.'])
		)
	});
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('1 document added.');
	await expect(page.getByTestId(`libdoc-${code}.pdf`)).toContainText('Text read');
	await page.getByTestId(`libdoc-${code}.pdf`).getByRole('button', { name: 'Use in the prompt' }).click();
	await page.getByLabel('Source code for the import').fill(code);
	await page.getByLabel('Map it to').selectOption('nis2');
	await expect(page.getByTestId('import-prompt')).toHaveValue(new RegExp(`code "${code}"`));
	await expect(page.getByTestId('map-prompt')).toHaveValue(/\(source nis2\)/);

	// 2. What Claude does with the import prompt, over MCP.
	const client = await mcpClient(baseURL!, await createToken(page, unique('Claude')));
	const docs = await call(client, 'list_library_documents', {});
	const doc = docs.documents.find((d: { filename: string }) => d.filename === `${code}.pdf`);
	const text = await call(client, 'get_library_document_text', { document_id: doc.id });
	expect(text.text).toContain('Access control');
	await call(client, 'upsert_sources', {
		sources: [{ code, title: `Regulation ${code}`, type: 'law', language: 'en', document_id: doc.id }]
	});
	await call(client, 'upsert_requirements', {
		source: code,
		requirements: [
			{ ref: '5', title: 'Risk management' },
			{
				ref: '5.1',
				title: 'Risk assesment once a year',
				parent: '5',
				text: 'Risks are assessed once a year.'
			},
			{ ref: '6', title: 'Access control' },
			{ ref: '7', title: 'Invented by mistake' }
		]
	});
	await client.close();

	// 3. Review: preview the tree, fix a typo, reject a wrong one, publish.
	await page.goto('/library');
	await expect(page.getByTestId('sources')).not.toContainText(`Regulation ${code}`);
	await expect(page.getByTestId('review-count')).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Library tabs' })
		.getByRole('link', { name: /Review/ })
		.click();
	const card = page.getByTestId(`import-${code}`);
	await expect(card).toContainText('4 requirements, 4 still proposed');
	await expect(card).toContainText('Claude on behalf of Ada Admin');
	// The preview starts closed when other imports wait too (tests share the library).
	const preview = card.locator('details');
	if ((await preview.getAttribute('open')) === null)
		await card.getByText('Preview and edit the requirements').click();
	const r51 = card.getByTestId('proposed-5.1');
	await r51.getByRole('button', { name: 'Edit 5.1' }).click();
	await r51.getByLabel('Title').fill('Risk assessment once a year');
	await r51.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('status')).toHaveText('5.1 saved. It is still proposed until you accept it.');
	await expect(page.getByTestId(`import-${code}`).getByTestId('proposed-5.1')).toContainText(
		'Risk assessment once a year'
	);
	await page.getByTestId(`import-${code}`).getByRole('button', { name: 'Reject 7' }).click();
	await expect(page.getByTestId(`import-${code}`)).toContainText('3 requirements');
	await page.getByTestId(`import-${code}`).getByRole('button', { name: 'Accept all and publish' }).click();
	await expect(page.getByRole('status')).toHaveText(`Regulation ${code} is published with 3 requirements.`);
	await page.goto(`/library?source=${code}`);
	await expect(page.getByTestId('source-tree').locator('.au-tree__row')).toHaveCount(3);

	// 4. Mapping: Claude proposes with reasons; a person edits, rejects, accepts, and maps by hand.
	const client2 = await mcpClient(baseURL!, await createToken(page, unique('Claude')));
	await call(client2, 'link_requirements', {
		links: [
			{
				from: `${code}:6`,
				to: 'nis2:Art. 21(2)(i)',
				type: 'implements',
				coverage: 'full',
				note: 'Both require access control rules'
			},
			{
				from: `${code}:5.1`,
				to: 'nis2:Art. 21(2)(a)',
				type: 'details',
				note: 'Annual risk assessment details risk analysis'
			},
			{
				from: `${code}:5`,
				to: 'nis2:Art. 21(2)(j)',
				type: 'details',
				note: 'Low confidence: only a shared word'
			}
		]
	});
	await client2.close();
	await page.goto('/library/review');
	await page.getByTestId(`mapping-${code}-nis2`).getByRole('link', { name: 'Review mapping' }).click();
	await expect(page.getByTestId('mapping-summary')).toHaveText(
		`0 of 3 requirements mapped to nis2, 3 proposed links wait`
	);
	const six = page.getByTestId('map-6');
	await expect(six).toContainText('Reason: Both require access control rules');
	await six.getByRole('button', { name: 'Edit link 6 to Art. 21(2)(i)' }).click();
	await six.getByLabel('Coverage').selectOption('partial');
	await six.getByRole('button', { name: 'Save link' }).click();
	await expect(page.getByTestId('map-6')).toContainText('partial coverage');
	await page.getByTestId('map-5').getByRole('button', { name: 'Reject link 5 to Art. 21(2)(j)' }).click();
	await page.getByRole('button', { name: 'Accept all proposed links' }).click();
	await expect(page.getByRole('status')).toHaveText('2 proposed links accepted.');
	await expect(page.getByTestId('mapping-summary')).toHaveText('2 of 3 requirements mapped to nis2');

	const five = page.getByTestId('map-5');
	await five.getByRole('button', { name: 'Map 5 by hand' }).click();
	await five.getByLabel('Find in NIS 2 Directive (EU) 2022/2555').fill('risk analysis');
	await five.getByRole('button', { name: /Art\. 21\(2\)\(a\)/ }).click();
	await five.getByLabel('Type').selectOption('details');
	await five.getByLabel('Reason').fill('Risk management covers risk analysis');
	await five.getByRole('button', { name: 'Add link' }).click();
	await expect(page.getByTestId('mapping-summary')).toHaveText('3 of 3 requirements mapped to nis2');
});

test('an AI change to a published requirement shows what it was, and rejecting it restores that (#69, #70)', async ({
	page,
	baseURL
}) => {
	const code = unique('std').toLowerCase();
	await page.goto('/library/import');
	await page
		.getByLabel('Or paste the YAML')
		.fill(
			`id: ${code}\ntitle: Standard ${code}\nrequirements:\n  - {id: "1", title: Policy, text: "There is a policy."}\n`
		);
	await page.getByRole('button', { name: 'Import source' }).click();
	await expect(page.getByTestId('import-report')).toBeVisible();
	const client = await mcpClient(baseURL!, await createToken(page, unique('Claude')));
	await call(client, 'upsert_requirements', {
		source: code,
		requirements: [{ ref: '1', text: 'There is an approved policy.' }]
	});
	await client.close();
	await page.goto('/library/review');
	const r = page.getByTestId('proposed-1').filter({ hasText: 'There is an approved policy.' });
	await expect(r).toContainText('There is a policy.');
	await r.getByRole('button', { name: 'Reject 1' }).click();
	await expect(page.getByRole('status')).toHaveText('Proposal rejected.');
	await page.goto(`/library?source=${code}`);
	await page
		.getByTestId('source-tree')
		.getByRole('link', { name: /Policy/ })
		.click();
	await expect(page.getByTestId('item-sheet')).toContainText('There is a policy.');
});
