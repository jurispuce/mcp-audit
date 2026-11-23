import { expect, joinLink, loginAs, mailTo, test, virtualAuthenticator } from '../helpers';
import { PROFILE_ADMIN, PROFILE_INSTANCE } from '../tenant-profile.mjs';

/**
 * #91: an instance started with TENANT_PROFILE and nothing else about itself in its settings. By the
 * time its first person arrives it has its name, its library, its AI and its sign-in method.
 */
test('an instance set up from a profile is ready when its first admin joins', async ({ page, context }) => {
	// The invitation went out when the instance started. Nobody typed a set-up code.
	const invitations = (await mailTo(page.request, PROFILE_ADMIN.email)).filter(
		(m) => m.kind === 'invitation'
	);
	const mail = invitations.at(-1)!;
	expect(mail.subject).toBe(`Your instance is ready (${PROFILE_INSTANCE})`);
	expect(mail.text).toContain(`${PROFILE_INSTANCE} was set up with you as its first admin`);

	// No set-up page to claim the instance with, and the sign-in method the profile chose.
	await page.goto('/setup');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page).toHaveTitle(`Sign in · ${PROFILE_INSTANCE}`);
	await expect(page.locator('input[type=password]')).toHaveCount(0);

	await virtualAuthenticator(context, page);
	await page.goto(joinLink(mail));
	if (await page.getByTestId('invitation-problem').count()) {
		// A second run against the same instance: the link was used the first time.
		await loginAs(page, PROFILE_ADMIN.email);
		await page.goto('/');
	} else {
		await expect(page.getByRole('heading', { name: `Join ${PROFILE_INSTANCE}` })).toBeVisible();
		await expect(page.getByTestId('invitation')).toContainText(
			`${PROFILE_ADMIN.name} (${PROFILE_ADMIN.email}), as its first admin`
		);
		await page.getByRole('button', { name: 'Create passkey and join' }).click();
	}
	await expect(page).toHaveURL('/');

	// The name: in the shell and in the page title.
	await expect(page.getByTestId('instance-name')).toHaveText(PROFILE_INSTANCE);
	await expect(page).toHaveTitle(`Engagements · ${PROFILE_INSTANCE}`);
	await expect(page.locator('nav.au-rail')).toContainText(`Signed in as ${PROFILE_ADMIN.name}`);

	// The library source the profile listed.
	await page.goto('/library');
	await expect(page.getByTestId('sources')).toContainText('NIS 2');
	await expect(page.getByTestId('library-empty')).toHaveCount(0);

	// AI: the gateway saved, the default model checked against it and running the actions.
	await page.goto('/settings/ai');
	await expect(page.getByLabel('Gateway address')).toHaveValue(/:4999$/);
	await expect(page.getByLabel('Gateway key')).toHaveAttribute('placeholder', /A key is set/);
	await expect(page.locator('body')).not.toContainText('sk-profile-test');
	await expect(page.getByTestId('model-fake-tools')).toHaveAttribute('data-ok', 'true');
	await expect(page.getByLabel('Default for all actions')).toHaveValue('fake-tools');
	await expect(page.locator('input[name=web_search]')).toBeChecked();

	// People join by invitation only, and the guide carries the instance's name.
	await page.goto('/settings/users');
	await expect(page.getByRole('button', { name: 'Invite user' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(0);
	const guide = await (await page.request.get('/guide/download')).text();
	expect(guide).toContain(`<title>${PROFILE_INSTANCE} Guide</title>`);
});
