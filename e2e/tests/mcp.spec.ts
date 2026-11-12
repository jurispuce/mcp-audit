import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type Page } from '@playwright/test';
import { AUDITOR, loginAs, seed, unique } from '../helpers';

async function createToken(page: Page, name: string) {
	await page.goto('/settings/tokens');
	await page.getByLabel('Token name').fill(name);
	await page.getByRole('button', { name: 'Create token' }).click();
	return (await page.getByTestId('new-token').locator('.au-secret').textContent())!.trim();
}

async function mcpClient(baseURL: string, token: string) {
	const client = new Client({ name: 'e2e', version: '1.0.0' });
	await client.connect(
		new StreamableHTTPClientTransport(new URL('/mcp', baseURL), {
			requestInit: { headers: { authorization: `Bearer ${token}` } }
		})
	);
	return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
	const res = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { text: string }[];
	};
	expect(res.isError, res.content[0]?.text).toBeFalsy();
	return JSON.parse(res.content[0]!.text);
}

test('the MCP endpoint refuses requests without a valid token', async ({ request }) => {
	const res = await request.post('/mcp', {
		data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
		headers: { accept: 'application/json, text/event-stream' }
	});
	expect(res.status()).toBe(401);
	expect(res.headers()['www-authenticate']).toContain('Bearer');
	const bad = await request.post('/mcp', {
		data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
		headers: { authorization: 'Bearer mcpa_not-a-token', accept: 'application/json, text/event-stream' }
	});
	expect(bad.status()).toBe(401);
});

test('a library-curator run through MCP shows in the UI as written by Claude on behalf of the user (#30, #34)', async ({
	page,
	baseURL
}) => {
	await seed(page.request);
	await loginAs(page, AUDITOR);
	const token = await createToken(page, unique('Claude Desktop'));
	const client = await mcpClient(baseURL!, token);

	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name)).toEqual(
		expect.arrayContaining(['search_requirements', 'set_guidance', 'link_requirements'])
	);

	// What the audit-library-curator skill does: find the requirement, add guidance, link it across sources.
	const code = unique('iso');
	const guidance = `Ask for the supplier register and two supplier security reviews (${code}).`;
	const found = await call(client, 'search_requirements', { query: 'supply chain', source: 'nis2' });
	expect(found.results[0]).toMatchObject({ ref: 'Art. 21(2)(d)' });
	await call(client, 'upsert_sources', {
		sources: [{ code, title: `ISO sample ${code}`, type: 'standard' }]
	});
	await call(client, 'upsert_requirements', {
		source: code,
		requirements: [{ ref: 'A.5.19', title: `Information security in supplier relationships ${code}` }]
	});
	const linked = await call(client, 'link_requirements', {
		links: [{ from: `${code}:A.5.19`, to: 'nis2:Art. 21(2)(d)', type: 'implements', coverage: 'partial' }]
	});
	expect(linked.links[0].status).toBe('created');
	const current = await call(client, 'get_requirement', { requirement: 'nis2:Art. 21(2)(d)' });
	await call(client, 'set_guidance', {
		requirement: found.results[0].id,
		body: guidance,
		...(current.guidance ? { base_version: current.guidance.version } : {})
	});
	await client.close();

	// The auditor sees it in the library, marked as AI work.
	await page.goto('/library?source=nis2');
	await page
		.getByTestId('source-tree')
		.getByRole('link', { name: /Supply chain security/ })
		.click();
	const sheet = page.getByTestId('item-sheet');
	await expect(sheet.getByLabel('How to audit this requirement')).toHaveValue(guidance);
	await expect(sheet.getByTestId('guidance-meta')).toContainText('Claude on behalf of Ari Auditor');
	await sheet.getByRole('tab', { name: /Links/ }).click();
	const row = sheet.getByTestId('link-row').filter({ hasText: code });
	await expect(row).toContainText('Partial coverage');
	await expect(row.getByTestId('link-by')).toHaveText('by Claude on behalf of Ari Auditor');
});

test('a revoked token stops working at once', async ({ page, baseURL }) => {
	await seed(page.request);
	await loginAs(page, AUDITOR);
	const name = unique('Revoke me');
	const token = await createToken(page, name);
	const client = await mcpClient(baseURL!, token);
	await client.close();

	await page.reload();
	page.once('dialog', (d) => d.accept());
	await page.locator('.au-item', { hasText: name }).getByRole('button', { name: 'Revoke token' }).click();
	await expect(page.locator('.au-item', { hasText: name })).toContainText('Revoked');
	await expect(mcpClient(baseURL!, token)).rejects.toThrow();
});
