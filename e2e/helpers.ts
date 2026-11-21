import {
	expect,
	test as base,
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	type Page
} from '@playwright/test';

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

/**
 * A fresh copy of the sample engagement (scopes, requirements, roles, risks, documents and a draft
 * plan of two events with evidence), with its own auditee, for a test that changes things.
 */
export async function sampleCopy(request: APIRequestContext, name = unique('Sample')) {
	const res = await request.post('/api/test/engagement', { data: { name } });
	expect(res.ok(), await res.text()).toBeTruthy();
	return (await res.json()) as {
		id: string;
		name: string;
		auditeeId: string;
		events: { id: string; title: string }[];
	};
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

export interface TestMail {
	to: string;
	from: string;
	subject: string;
	text: string;
	html: string;
	kind: string | null;
}

const MAIL_URL = process.env.E2E_MAIL_URL ?? 'http://127.0.0.1:2526';

/** The emails the app sent to an address, newest last (read from e2e/fake-smtp.mjs). */
export async function mailTo(request: APIRequestContext, address: string): Promise<TestMail[]> {
	const res = await request.get(`${MAIL_URL}/messages?to=${encodeURIComponent(address.toLowerCase())}`);
	expect(res.ok(), await res.text()).toBeTruthy();
	return (await res.json()) as TestMail[];
}

/** Wait for the next email of a kind to an address. */
export async function waitForMail(
	request: APIRequestContext,
	address: string,
	kind: string,
	after = 0
): Promise<TestMail> {
	let found: TestMail | undefined;
	await expect
		.poll(
			async () => {
				found = (await mailTo(request, address)).filter((m) => m.kind === kind)[after];
				return !!found;
			},
			{ message: `a ${kind} email to ${address}`, timeout: 10_000 }
		)
		.toBe(true);
	return found!;
}

/** A software authenticator in the browser, so a test can make and use passkeys. */
export async function virtualAuthenticator(context: BrowserContext, page: Page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
}

/** The invitation link in an email (#90). */
export const joinLink = (mail: TestMail) => /(https?:\/\/\S+\/join\?t=[\w-]+)/.exec(mail.text)![1]!;

/** An admin invites a person on Settings, Users; resolves to the email that went out. */
export async function invite(page: Page, origin: string, name: string, email: string): Promise<TestMail> {
	await page.goto(`${origin}/settings/users`);
	await page.getByRole('button', { name: 'Invite user' }).click();
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
	await expect(page.getByRole('status')).toContainText(`Invitation sent to ${email}`);
	return waitForMail(page.request, email, 'invitation');
}

/**
 * A person of their own for a test, added by the admin and past the one-time password, so tests
 * that send email or change sign-in do not share a mailbox or lock-outs with the seeded users.
 */
export async function addUser(
	browser: Browser,
	name = 'Nora New'
): Promise<{ name: string; email: string; password: string }> {
	const email = `${unique('person')}@example.test`;
	const password = 'own-password-123';
	const context = await browser.newContext();
	const page = await context.newPage();
	await loginAs(page, ADMIN);
	await page.goto('/settings/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Add user' }).click();
	const temp = (await page.getByTestId('one-time-password').locator('.au-secret').textContent())!.trim();
	await context.clearCookies();
	await signIn(page, email, temp);
	await page.getByLabel('Current password').fill(temp);
	await page.getByLabel('New password', { exact: true }).fill(password);
	await page.getByLabel('Repeat new password').fill(password);
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page).toHaveURL('/');
	await context.close();
	return { name, email, password };
}
