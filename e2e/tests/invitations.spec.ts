import {
	ADMIN,
	expect,
	invite,
	joinLink,
	mailTo,
	seed,
	signIn,
	test,
	unique,
	virtualAuthenticator,
	waitForMail
} from '../helpers';

/** #90: invitations by email, against the scripted mail server. This instance has passwords. */
const local = (baseURL: string) => baseURL.replace('127.0.0.1', 'localhost');

test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('an admin invites by email; the invitee joins with a passkey and lands on the welcome', async ({
	page,
	browser,
	baseURL
}) => {
	// At localhost, where the browser allows passkeys; the link in the email carries the same address.
	const base = local(baseURL!);
	const email = `${unique('invitee')}@example.test`;
	expect((await page.request.post(`${base}/api/test/login`, { data: { email: ADMIN } })).ok()).toBeTruthy();
	const mail = await invite(page, base, 'Ina Novak', email);
	expect(mail.subject).toContain('Ada Admin invited you');
	expect(mail.text).toContain('The link works once and for 7 days');
	const link = joinLink(mail);
	expect(new URL(link).origin).toBe(base);

	const row = page.getByTestId(`user-${email}`);
	await expect(row).toContainText('Invited');
	await expect(row).toContainText('Has not joined yet. The link works until');
	await expect(row.getByRole('button', { name: 'Reset password' })).toHaveCount(0);

	const theirs = await browser.newContext();
	const invitee = await theirs.newPage();
	await virtualAuthenticator(theirs, invitee);
	await invitee.goto(link);
	await expect(invitee.getByRole('heading', { name: 'Join mcp-audit' })).toBeVisible();
	await expect(invitee.getByTestId('invitation')).toContainText(`invited you as Ina Novak (${email})`);
	await invitee.getByLabel('Name for the passkey').fill('Ina’s laptop');
	await invitee.getByRole('button', { name: 'Create passkey and join' }).click();
	await expect(invitee).toHaveURL(`${base}/`);
	await expect(invitee.getByTestId('welcome')).toContainText('Welcome to mcp-audit');
	await expect(invitee.locator('nav.au-rail')).toContainText('Signed in as Ina Novak');
	const notice = await waitForMail(invitee.request, email, 'security_notice');
	expect(notice.subject).toContain('A passkey was added to your account');
	expect(notice.text).toContain('Ina’s laptop');

	// They have no password. On an instance with passwords they may set one, with no current one to give.
	await invitee.goto(`${base}/settings`);
	await expect(invitee.getByText('You have no password.')).toBeVisible();
	await expect(invitee.getByLabel('Current password')).toHaveCount(0);
	await invitee.getByLabel('New password', { exact: true }).fill('a-password-of-my-own');
	await invitee.getByLabel('Repeat new password').fill('a-password-of-my-own');
	await invitee.getByRole('button', { name: 'Set password' }).click();
	await expect(invitee.getByRole('status')).toContainText('Your password was saved.');
	await expect(invitee.getByLabel('Current password')).toBeVisible();

	// The passkey signs them in from then on.
	await invitee.locator('nav.au-rail').getByRole('button', { name: 'Sign out' }).click();
	await invitee.goto(`${base}/login`);
	await invitee.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(invitee).toHaveURL(`${base}/`);
	// A used link says so.
	await invitee.goto(link);
	await expect(invitee.getByTestId('invitation-problem')).toHaveText(
		'This invitation was already used. Sign in instead.'
	);
	await theirs.close();

	// The admin sees a member, and the history says who invited them and that they joined.
	await page.goto(`${base}/settings/users`);
	await expect(row).not.toContainText('Invited');
	await expect(row.getByRole('button', { name: 'Send invitation again' })).toHaveCount(0);
	await row.getByRole('link', { name: 'Ina Novak' }).click();
	await page.getByRole('tab', { name: 'History' }).click();
	const history = page.getByRole('tabpanel');
	await expect(history).toContainText('Joined by invitation');
	await expect(history).toContainText('Invited by email');
});

test('sending again makes the earlier link useless; expired and withdrawn links say so', async ({
	page,
	browser
}) => {
	const email = `${unique('invitee')}@example.test`;
	expect((await page.request.post('/api/test/login', { data: { email: ADMIN } })).ok()).toBeTruthy();
	const first = joinLink(await invite(page, '', 'Rob Resent', email));
	const row = page.getByTestId(`user-${email}`);

	await row.getByRole('button', { name: 'Send invitation again' }).click();
	await expect(page.getByRole('status')).toContainText(`Invitation sent to ${email}`);
	const second = joinLink(await waitForMail(page.request, email, 'invitation', 1));
	expect(second).not.toBe(first);

	const elsewhere = await browser.newContext();
	const invitee = await elsewhere.newPage();
	await invitee.goto(first);
	await expect(invitee.getByTestId('invitation-problem')).toContainText(
		'A newer invitation replaced this one. Use the link in the latest email'
	);
	await expect(invitee.getByLabel('New password')).toHaveCount(0);
	await invitee.goto(second);
	await expect(invitee.getByTestId('invitation')).toContainText('invited you as Rob Resent');

	// Seven days later.
	expect((await page.request.post('/api/test/expire-invitation', { data: { email } })).ok()).toBeTruthy();
	await invitee.goto(second);
	await expect(invitee.getByTestId('invitation-problem')).toHaveText(
		'This invitation has expired. Ask Ada Admin to send it again.'
	);
	await page.reload();
	await expect(row).toContainText('The link no longer works; send the invitation again.');

	await row.getByRole('button', { name: 'Send invitation again' }).click();
	await expect(page.getByRole('status')).toContainText(`Invitation sent to ${email}`);
	const third = joinLink(await waitForMail(page.request, email, 'invitation', 2));
	page.once('dialog', (d) => d.accept());
	await row.getByRole('button', { name: 'Withdraw invitation' }).click();
	await expect(page.getByRole('status')).toContainText('Invitation withdrawn.');
	await expect(row).toContainText('Invitation withdrawn');
	await expect(row.getByRole('button', { name: 'Withdraw invitation' })).toHaveCount(0);
	await invitee.goto(third);
	await expect(invitee.getByTestId('invitation-problem')).toContainText(
		'This invitation was withdrawn. Ask Ada Admin'
	);
	// Nothing opens for a link nobody sent, and no sign-in code goes to someone who has not joined.
	await invitee.goto('/join?t=nonsense');
	await expect(invitee.getByTestId('invitation-problem')).toContainText('This invitation link is not valid.');
	await elsewhere.close();
	expect((await mailTo(page.request, email)).filter((m) => m.kind === 'sign_in_code')).toEqual([]);
});

test('where the instance has passwords, the invitee sets their own and no one-time password is passed on', async ({
	page,
	browser
}) => {
	// At 127.0.0.1 the browser has no passkeys, so the password is the way to join.
	const email = `${unique('invitee')}@example.test`;
	expect((await page.request.post('/api/test/login', { data: { email: ADMIN } })).ok()).toBeTruthy();
	const link = joinLink(await invite(page, '', 'Pia Password', email));
	await expect(page.getByTestId('one-time-password')).toHaveCount(0);

	const theirs = await browser.newContext();
	const invitee = await theirs.newPage();
	await invitee.goto(link);
	await expect(invitee.getByText('Set a password to join.')).toBeVisible();
	await expect(invitee.getByRole('button', { name: 'Create passkey and join' })).toHaveCount(0);
	await expect(invitee.getByRole('button', { name: 'Join without a passkey' })).toHaveCount(0);
	await invitee.getByLabel('New password', { exact: true }).fill('their-own-password-1');
	await invitee.getByLabel('Repeat new password').fill('something-else-entirely');
	await invitee.getByRole('button', { name: 'Set password and join' }).click();
	await expect(invitee.getByRole('alert')).toContainText('The two passwords are not the same.');
	await invitee.getByLabel('New password', { exact: true }).fill('their-own-password-1');
	await invitee.getByLabel('Repeat new password').fill('their-own-password-1');
	await invitee.getByRole('button', { name: 'Set password and join' }).click();
	await expect(invitee).toHaveURL('/');
	await expect(invitee.getByTestId('welcome')).toBeVisible();

	await theirs.clearCookies();
	await signIn(invitee, email, 'their-own-password-1');
	await expect(invitee).toHaveURL('/');
	await expect(invitee.locator('nav.au-rail')).toContainText('Signed in as Pia Password');
	await theirs.close();
});
