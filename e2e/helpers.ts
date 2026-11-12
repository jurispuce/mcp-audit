import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = 'test-password-123';
export const ADMIN = 'admin@example.test';
export const AUDITOR = 'auditor@example.test';

/** Create the seed users (idempotent). */
export async function seed(request: APIRequestContext) {
	const res = await request.post('/api/test/seed', { data: {} });
	expect(res.ok(), await res.text()).toBeTruthy();
	return (await res.json()) as { users: { id: string; email: string; role: string }[]; password: string };
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
	const origin = new URL(page.url() === 'about:blank' ? '/' : page.url(), test.info().project.use.baseURL)
		.origin;
	return page.request.post(path, { form, headers: { origin } });
}
