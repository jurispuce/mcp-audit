import {
	ADMIN,
	FIRST_ADMIN,
	expect,
	joinLink,
	loginAs,
	mailTo,
	postForm,
	seed,
	test,
	virtualAuthenticator
} from '../helpers';

/** #89 on an instance started with SIGN_IN_METHOD=passkey: no password anywhere. */
test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('the first admin joins by the invitation sent when the instance started', async ({ page, context }) => {
	const invitations = (await mailTo(page.request, FIRST_ADMIN.email)).filter((m) => m.kind === 'invitation');
	const mail = invitations.at(-1)!;
	expect(mail.subject).toContain('Your instance is ready');
	expect(mail.text).toContain('was set up with you as its first admin');

	await virtualAuthenticator(context, page);
	await page.goto(joinLink(mail));
	await expect(page.getByTestId('invitation')).toContainText(
		`This instance was set up with you, ${FIRST_ADMIN.name} (${FIRST_ADMIN.email}), as its first admin.`
	);
	await expect(page.locator('input[type=password]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Create passkey and join' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByTestId('welcome')).toBeVisible();
	// An admin from the first minute: they invite the others.
	await page.goto('/settings/users');
	await expect(page.getByRole('button', { name: 'Invite user' })).toBeVisible();
	await expect(page.getByTestId(`user-${FIRST_ADMIN.email}`)).toContainText('Admin');
});

test('the sign-in page offers a passkey and a code by email, and no password', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Email me a sign-in code' })).toBeVisible();
	await expect(page.locator('input')).toHaveCount(0);
	await expect(page.getByText('Forgot your password?')).toHaveCount(0);

	// A password posted to the page all the same is refused, whatever it is.
	const res = await postForm(page, '/login', { email: ADMIN, password: 'test-password-123' });
	expect(res.status()).toBe(403);
	expect(await res.text()).toContain('This instance signs in with passkeys. It has no passwords.');
	// And there is no set-up page to claim the instance with.
	await page.goto('/setup');
	await expect(page).toHaveURL(/\/login$/);
});

test('Settings shows no password to change, reset or hand out', async ({ page }) => {
	await loginAs(page, ADMIN);
	await page.goto('/settings');
	await expect(page.getByRole('region', { name: 'Passkeys' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Password' })).toHaveCount(0);
	await expect(page.locator('input[type=password]')).toHaveCount(0);

	await page.goto('/settings/users');
	await expect(page.getByRole('button', { name: 'Invite user' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Reset password' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'End sessions and remove passkeys' }).first()).toBeVisible();
});
