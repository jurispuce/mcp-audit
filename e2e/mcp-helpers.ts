import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, type Page } from '@playwright/test';

/** Create a personal access token through the Settings screen. */
export async function createToken(page: Page, name: string) {
	await page.goto('/settings/tokens');
	await page.getByLabel('Token name').fill(name);
	await page.getByRole('button', { name: 'Create token' }).click();
	return (await page.getByTestId('new-token').locator('.au-secret').textContent())!.trim();
}

/** Connect to /mcp the way Claude Code or Claude Desktop does. */
export async function mcpClient(baseURL: string, token: string) {
	const client = new Client({ name: 'e2e', version: '1.0.0' });
	await client.connect(
		new StreamableHTTPClientTransport(new URL('/mcp', baseURL), {
			requestInit: { headers: { authorization: `Bearer ${token}` } }
		})
	);
	return client;
}

/** Call a tool and expect it to succeed. */
export async function call(client: Client, name: string, args: Record<string, unknown>) {
	const res = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { text: string }[];
	};
	expect(res.isError, res.content[0]?.text).toBeFalsy();
	return JSON.parse(res.content[0]!.text);
}
