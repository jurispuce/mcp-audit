import type { BrowserContext, Page } from '@playwright/test';
import { ADMIN, addUser, expect, loginAs, mailTo, seed, signIn, test, unique, waitForMail } from '../helpers';

/** #88: sign-in with a one-time code by email, against the scripted mail server. */
const local = (baseURL: string) => baseURL.replace('127.0.0.1', 'localhost');
const codeIn = (text: string) => /^\s{4}(\d{6})$/m.exec(text)![1]!;

async function virtualAuthenticator(context: BrowserContext, page: Page) {
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

async function askForCode(page: Page, base: string, email: string) {
	await page.goto(`${base}/login`);
	await page.getByRole('link', { name: 'Email me a sign-in code' }).click();
	// The sign-in page has an Email field too: wait for the new page before filling.
	await expect(page.getByRole('heading', { name: 'Sign in with a code' })).toBeVisible();
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
	await expect(page.getByTestId('code-sent')).toContainText(`If ${email} has an account here`);
}

test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('sign in with a code by email, add a passkey, and come back by code when it is lost', async ({
	page,
	context,
	browser,
	baseURL
}) => {
	const base = local(baseURL!);
	const user = await addUser(browser, 'Rita Recover');
	await virtualAuthenticator(context, page);

	await askForCode(page, base, user.email);
	const first = await waitForMail(page.request, user.email, 'sign_in_code');
	expect(first.subject).toContain('Your sign-in code is');
	expect(first.text).toContain('only in the browser that asked');
	await page.getByLabel('Sign-in code').fill(codeIn(first.text));
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();

	// No passkey on this device yet: the app offers one.
	await expect(page).toHaveURL(`${base}/add-passkey?next=%2F`);
	await expect(page.getByRole('heading', { name: 'Add a passkey to this device' })).toBeVisible();
	await page.getByLabel('Name for the passkey').fill('First laptop');
	await page.getByRole('button', { name: 'Add passkey' }).click();
	await expect(page).toHaveURL(`${base}/`);
	// The account is told about both.
	expect((await waitForMail(page.request, user.email, 'security_notice', 0)).subject).toContain(
		'Someone signed in with a code sent to this address'
	);
	const added = await waitForMail(page.request, user.email, 'security_notice', 1);
	expect(added.subject).toContain('A passkey was added to your account');
	expect(added.text).toContain('First laptop');

	// The device is gone. A wrong code is refused; the right one signs in, and the offer comes again.
	await context.clearCookies();
	await askForCode(page, base, user.email);
	const second = await waitForMail(page.request, user.email, 'sign_in_code', 1);
	const code = codeIn(second.text);
	await page.getByLabel('Sign-in code').fill(code === '000000' ? '111111' : '000000');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText('That code is not correct.');
	await page.getByLabel('Sign-in code').fill(code);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(`${base}/add-passkey?next=%2F`);
	await expect(page.getByText('You have 1 passkey on other devices')).toBeVisible();
	await page.getByRole('link', { name: 'Continue without a passkey' }).click();
	await expect(page).toHaveURL(`${base}/`);
	await expect(page.locator('nav.au-rail')).toContainText('Signed in as Rita Recover');
	// Removing the passkey is announced too. The mailbox is the other way in, so the last one may go.
	await page.goto(`${base}/settings`);
	await page.getByRole('button', { name: 'Remove passkey First laptop' }).click();
	await expect(page.getByRole('region', { name: 'Passkeys' }).getByRole('status')).toContainText(
		'Passkey removed.'
	);
	const removed = await waitForMail(page.request, user.email, 'security_notice', 3);
	expect(removed.subject).toContain('A passkey was removed from your account');
	expect(removed.text).toContain('First laptop');
	// A used code is gone.
	await context.clearCookies();
	await page.goto(`${base}/login/code`);
	await expect(page.getByLabel('Email')).toBeVisible();
});

test('an address without an account gets the same screen and no email; the link works only where it was asked for', async ({
	page,
	browser
}) => {
	const user = await addUser(browser, 'Lina Link');
	const nobody = `${unique('nobody')}@example.test`;
	await askForCode(page, '', nobody);
	await page.getByLabel('Sign-in code').fill('123456');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText('That code is not correct.');
	expect(await mailTo(page.request, nobody)).toEqual([]);

	await page.getByRole('button', { name: 'Use another address' }).click();
	await page.getByLabel('Email').fill(user.email);
	await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
	await expect(page.getByTestId('code-sent')).toContainText(user.email);
	const mail = await waitForMail(page.request, user.email, 'sign_in_code');
	const link = /(https?:\/\/\S+\/login\/code\?t=[\w-]+)/.exec(mail.text)![1]!;
	expect(new URL(link).origin).toBe(new URL(page.url()).origin);

	// Opened in another browser (a mail app, another device): it says where to go, and opens nothing.
	const elsewhere = await browser.newContext();
	const other = await elsewhere.newPage();
	await other.goto(link);
	await expect(other.getByTestId('other-browser')).toContainText(
		'Open this in the browser where you asked for the code'
	);
	await other.goto('/');
	await expect(other).toHaveURL(/\/login/);
	await elsewhere.close();

	// In the browser that asked, the link signs in. This address cannot have passkeys, so no offer.
	await page.goto(link);
	await expect(page).toHaveURL('/');
	await expect(page.locator('nav.au-rail')).toContainText('Signed in as Lina Link');
});

test('an admin ends a person’s sessions and removes their passkeys when a device is lost', async ({
	page,
	browser
}) => {
	const user = await addUser(browser, 'Dana Device');
	const theirs = await browser.newContext();
	const device = await theirs.newPage();
	await signIn(device, user.email, user.password);
	await expect(device).toHaveURL('/');

	await loginAs(page, ADMIN);
	await page.goto('/settings/users');
	page.once('dialog', (d) => d.accept());
	await page
		.getByTestId(`user-${user.email}`)
		.getByRole('button', { name: 'End sessions and remove passkeys' })
		.click();
	await expect(page.getByRole('status')).toContainText('Sessions ended and 0 passkeys removed.');

	// The lost device is signed out at its next request.
	await device.goto('/settings');
	await expect(device).toHaveURL(/\/login/);
	await theirs.close();
	const notice = await waitForMail(page.request, user.email, 'security_notice');
	expect(notice.subject).toContain('An admin ended your sessions and removed your passkeys');
});
