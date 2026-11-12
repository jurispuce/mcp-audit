import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Playwright's test, with page.goto waiting until the page has hydrated: buttons that only open a
 * form on the client do nothing when clicked earlier, which made tests flaky under load.
 */
export const test = base.extend({
	page: async ({ page }, use) => {
		const goto = page.goto.bind(page);
		page.goto = async (url, options) => {
			const res = await goto(url, options);
			// A test that asks for waitUntil: 'commit' wants the page before it hydrates.
			if (
				options?.waitUntil !== 'commit' &&
				res &&
				res.ok() &&
				(res.headers()['content-type'] ?? '').includes('text/html')
			)
				await page.waitForSelector('html[data-hydrated]', { state: 'attached' });
			return res;
		};
		await use(page);
	}
});
export { expect };

export const PASSWORD = 'test-password-123';
export const ADMIN = 'admin@example.test';
export const AUDITOR = 'auditor@example.test';

export interface SeedResult {
	users: { id: string; email: string; role: string }[];
	password: string;
	/** The prototype's sample engagement. Shared by tests: change it only in ways other tests do not read. */
	engagement: { id: string; name: string; auditeeId: string };
}

/** Create the seed users, the NIS 2 source and the sample engagement (idempotent). */
export async function seed(request: APIRequestContext): Promise<SeedResult> {
	const res = await request.post('/api/test/seed', { data: {} });
	expect(res.ok(), await res.text()).toBeTruthy();
	return (await res.json()) as SeedResult;
}

/** A new engagement of its own for a test that changes things, created through the real form. */
export async function createEngagement(page: Page, name = unique('Audit'), auditee = unique('Client')) {
	await page.goto('/');
	const create = page.getByRole('button', { name: 'Create engagement' });
	if (await create.isVisible()) await create.click();
	const form = page.locator('form', { has: page.getByRole('heading', { name: 'Create engagement' }) });
	await form.getByLabel('Engagement name').fill(name);
	await form.getByLabel('Auditee').fill(auditee);
	await form.getByRole('button', { name: 'Create engagement' }).click();
	await expect(page).toHaveURL(/\/e\/[0-9a-f-]{36}$/);
	return { id: page.url().split('/e/')[1]!, name, auditee };
}

/** Sign in without the form, through the test-only endpoint. The cookie lands in the page's context. */
export async function loginAs(page: Page, email: string) {
	const res = await page.request.post('/api/test/login', { data: { email } });
	expect(res.ok(), await res.text()).toBeTruthy();
}

/** Sign in through the real form. */
export async function signIn(page: Page, email: string, password: string) {
	await page.goto('/login');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

export const unique = (prefix: string) =>
	`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** POST a form the way a browser would, with the Origin header SvelteKit's CSRF check expects. */
export async function postForm(page: Page, path: string, form: Record<string, string> = {}) {
	const origin = new URL(page.url() === 'about:blank' ? '/' : page.url(), base.info().project.use.baseURL)
		.origin;
	return page.request.post(path, { form, headers: { origin } });
}
