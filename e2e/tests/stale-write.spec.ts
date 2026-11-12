import { ADMIN, expect, loginAs, seed, test, unique } from '../helpers';

test('a save based on an old version is refused, the newer version is shown, and the change can be redone', async ({
	page,
	browser
}) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
	const email = `${unique('stale')}@example.test`;
	await page.goto('/settings/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Name').fill('Sam Original');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Add user' }).click();
	await expect(page.getByTestId('one-time-password')).toBeVisible();

	// Two admins open the same user for editing at version 1.
	const other = await browser.newPage();
	await loginAs(other, ADMIN);
	await other.goto('/settings/users');
	const mine = page.getByTestId(`user-${email}`);
	const theirs = other.getByTestId(`user-${email}`);
	await mine.getByRole('button', { name: 'Edit user' }).click();
	await theirs.getByRole('button', { name: 'Edit user' }).click();

	// The other admin saves first.
	await theirs.getByLabel('Name').fill('Sam Theirs');
	await theirs.getByRole('button', { name: 'Save user' }).click();
	await expect(theirs).toContainText('Sam Theirs');
	await expect(theirs).toContainText('v2');

	// My save is based on version 1: refused, and I see their version.
	await mine.getByLabel('Name').fill('Sam Mine');
	await mine.getByRole('button', { name: 'Save user' }).click();
	const notice = page.getByTestId('stale-notice');
	await expect(notice).toContainText('Someone else saved version 2');
	await expect(notice).toContainText('Sam Theirs');
	await expect(notice).toContainText('Sam Mine');
	await expect(mine.getByLabel('Name')).toHaveValue('Sam Theirs');

	// Redo my change on top of version 2 and save.
	await notice.getByRole('button', { name: 'Redo my change' }).click();
	await expect(mine.getByLabel('Name')).toHaveValue('Sam Mine');
	await mine.getByRole('button', { name: 'Save user' }).click();
	await expect(mine).toContainText('Sam Mine');
	await expect(mine).toContainText('v3');
	await other.close();
});
