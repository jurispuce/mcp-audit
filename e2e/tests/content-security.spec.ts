import { test as plain } from '@playwright/test';
import { ADMIN, expect, loginAs, sampleCopy, seed, test, unique } from '../helpers';

/**
 * #99: the Content-Security-Policy. Every test in the suite already fails when the policy blocks
 * something the app needs (e2e/helpers.ts). These check the policy itself: what each kind of
 * response carries, that script which is not the app's own does not run, that a person's text is
 * shown as text, and that an uploaded file is only ever a download.
 */
const NOTHING = "default-src 'none'; frame-ancestors 'none'";

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('every response carries a policy: pages their own, everything else one that allows nothing', async ({
	page
}) => {
	const opened = await page.goto('/');
	const policy = opened!.headers()['content-security-policy']!;
	const directive = (name: string) =>
		policy
			.split(';')
			.map((d) => d.trim())
			.find((d) => d.startsWith(`${name} `)) ?? '';
	expect(directive('default-src')).toBe("default-src 'self'");
	// Scripts: the app's own files, and the one start-up script named by a nonce. Nothing inline.
	expect(directive('script-src')).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]+'$/);
	expect(directive('object-src')).toBe("object-src 'none'");
	expect(directive('frame-src')).toBe("frame-src 'none'");
	expect(directive('base-uri')).toBe("base-uri 'self'");
	expect(directive('connect-src')).toBe("connect-src 'self'");
	expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
	// A new nonce for every page.
	const again = (await page.goto('/'))!.headers()['content-security-policy']!;
	expect(again).not.toBe(policy);

	for (const path of [
		'/health',
		'/api/items/user/none',
		'/mcp',
		'/icons/icon.svg',
		'/manifest.webmanifest',
		'/.well-known/oauth-authorization-server',
		'/guide/download'
	]) {
		const res = await page.request.get(path);
		expect(res.headers()['content-security-policy'], path).toBe(NOTHING);
		expect(res.headers()['x-content-type-options'], path).toBe('nosniff');
	}
	// A redirect too.
	const anonymous = await page.context().browser()!.newContext();
	const redirect = await anonymous.request.get(new URL('/settings', page.url()).href, { maxRedirects: 0 });
	expect(redirect.status()).toBe(303);
	expect(redirect.headers()['content-security-policy']).toBe(NOTHING);
	await anonymous.close();
});

// Without the suite's own check for blocked content: here something is meant to be blocked.
plain('script that is not the app’s own does not run in a page', async ({ page }) => {
	const blocked: string[] = [];
	page.on('console', (m) => {
		if (/Content Security Policy/i.test(m.text())) blocked.push(m.text());
	});
	await page.goto('/login');
	await page.waitForSelector('html[data-hydrated]', { state: 'attached' });
	const ran = await page.evaluate(async () => {
		const w = window as unknown as { __inline?: number; __handler?: number };
		const script = document.createElement('script');
		script.textContent = 'window.__inline = 1';
		document.body.append(script);
		const img = document.createElement('img');
		img.setAttribute('onerror', 'window.__handler = 1');
		img.src = '/no-such-image';
		document.body.append(img);
		await new Promise((r) => setTimeout(r, 500));
		return { inline: w.__inline ?? 0, handler: w.__handler ?? 0 };
	});
	expect(ran).toEqual({ inline: 0, handler: 0 });
	expect(blocked.length).toBeGreaterThanOrEqual(2);
	// And a script from somewhere else is not loaded.
	const loaded = await page.evaluate(
		() =>
			new Promise<string>((resolve) => {
				const s = document.createElement('script');
				s.src = 'https://example.com/x.js';
				s.onload = () => resolve('loaded');
				s.onerror = () => resolve('refused');
				document.body.append(s);
			})
	);
	expect(loaded).toBe('refused');
});

test('a person’s text that looks like markup is shown as text, on screens and in generated documents', async ({
	page
}) => {
	const hostile = `${unique('Audit')} <img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
	const e = await sampleCopy(page.request, hostile);
	const ran = () => page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? 0);
	// The suite's check fails this test if the policy had to stop anything: the text must never
	// have become markup in the first place.
	for (const path of ['/', `/e/${e.id}`, `/e/${e.id}/plan/document`, `/e/${e.id}/findings/conclusions`]) {
		await page.goto(path);
		expect(await ran(), path).toBe(0);
		await expect(page.locator('img[src="x"]'), path).toHaveCount(0);
	}
	await page.goto(`/e/${e.id}`);
	await expect(page.getByText('<script>window.__xss=1</script>').first()).toBeVisible();
});

test('an uploaded HTML file is only ever a download: it cannot open as a page of the app', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/setup/documents`);
	await page.getByLabel('Upload documents').setInputFiles({
		name: 'policy.html',
		mimeType: 'text/html',
		buffer: Buffer.from('<html><body><script>document.title = "ran"</script>An access policy.</body></html>')
	});
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('1 document added.')).toBeVisible();
	// The Download link next to the document's own Edit button.
	const row = page.getByRole('button', { name: 'Edit policy.html' }).locator('xpath=..');
	const href = await row.locator('a[href$="/file"]').getAttribute('href');
	const res = await page.request.get(href!);
	expect(res.status()).toBe(200);
	const headers = res.headers();
	expect(headers['content-disposition']).toMatch(/^attachment; /);
	expect(headers['content-security-policy']).toBe(NOTHING);
	expect(headers['x-content-type-options']).toBe('nosniff');
	// Opened as an address, the browser saves it; no page of the app's origin shows it.
	const download = page.waitForEvent('download');
	await page.goto(href!).catch(() => {});
	expect((await download).suggestedFilename()).toBe('policy.html');
	expect(await page.title()).not.toBe('ran');
});
