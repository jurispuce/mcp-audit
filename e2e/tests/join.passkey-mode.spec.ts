import {
	ADMIN,
	expect,
	invite,
	joinLink,
	loginAs,
	seed,
	test,
	unique,
	virtualAuthenticator,
	waitForMail
} from '../helpers';

/** #90 on an instance without passwords (SIGN_IN_METHOD=passkey): people join by invitation only. */
test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('the invitee creates a passkey and is in; no password exists at any point', async ({
	page,
	browser
}) => {
	const email = `${unique('tenant')}@example.test`;
	await loginAs(page, ADMIN);
	await page.goto('/settings/users');
	// No user is added with a one-time password here.
	await expect(page.getByRole('button', { name: 'Invite user' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(0);
	const link = joinLink(await invite(page, '', 'Tia Tenant', email));

	const theirs = await browser.newContext();
	const invitee = await theirs.newPage();
	await virtualAuthenticator(theirs, invitee);
	await invitee.goto(link);
	await expect(invitee.getByTestId('invitation')).toContainText(`invited you as Tia Tenant (${email})`);
	await expect(invitee.locator('input[type=password]')).toHaveCount(0);
	await invitee.getByRole('button', { name: 'Create passkey and join' }).click();
	await expect(invitee).toHaveURL('/');
	await expect(invitee.getByTestId('welcome')).toContainText('Welcome to mcp-audit');
	await expect(invitee.locator('nav.au-rail')).toContainText('Signed in as Tia Tenant');

	await invitee.locator('nav.au-rail').getByRole('button', { name: 'Sign out' }).click();
	await invitee.goto('/login');
	await invitee.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(invitee).toHaveURL('/');
	await theirs.close();
});

test('a device that cannot hold a passkey joins without one and signs in with a code by email', async ({
	page,
	browser
}) => {
	const email = `${unique('tenant')}@example.test`;
	await loginAs(page, ADMIN);
	const link = joinLink(await invite(page, '', 'Cody Code', email));

	const theirs = await browser.newContext();
	const invitee = await theirs.newPage();
	await invitee.goto(link);
	await expect(invitee.locator('input[type=password]')).toHaveCount(0);
	await expect(invitee.getByText(`each time you sign in, a code is sent to ${email}`)).toBeVisible();
	await invitee.getByRole('button', { name: 'Join without a passkey' }).click();
	await expect(invitee).toHaveURL('/');
	await expect(invitee.getByTestId('welcome')).toBeVisible();

	// Next time: a code by email.
	await theirs.clearCookies();
	await invitee.goto('/login/code');
	await invitee.getByLabel('Email').fill(email);
	await invitee.getByRole('button', { name: 'Email me a sign-in code' }).click();
	const mail = await waitForMail(invitee.request, email, 'sign_in_code');
	await invitee.getByLabel('Sign-in code').fill(/^\s{4}(\d{6})$/m.exec(mail.text)![1]!);
	await invitee.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(invitee).toHaveURL(/\/add-passkey\?next=%2F$/);
	await invitee.getByRole('link', { name: 'Continue without a passkey' }).click();
	await expect(invitee.locator('nav.au-rail')).toContainText('Signed in as Cody Code');
	await theirs.close();
});
