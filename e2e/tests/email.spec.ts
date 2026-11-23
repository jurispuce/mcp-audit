import { ADMIN, AUDITOR, expect, loginAs, mailTo, seed, test, waitForMail } from '../helpers';

/** #86: outbound email, against the scripted mail server (e2e/fake-smtp.mjs). */
test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('an admin sees the email settings without the password and sends a test email', async ({ page }) => {
	await loginAs(page, ADMIN);
	await page.goto('/settings');
	await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Email' }).click();
	await expect(page).toHaveURL('/settings/email');
	await expect(page.getByTestId('email-state')).toHaveText('Set up');
	const settings = page.getByTestId('email-settings');
	await expect(settings).toContainText('mcp-audit tests <audit@example.test>');
	await expect(settings).toContainText(':2525');
	await expect(settings).toContainText('Not set');

	const before = (await mailTo(page.request, ADMIN)).filter((m) => m.kind === 'test').length;
	await page.getByRole('button', { name: 'Send test email' }).click();
	await expect(page.getByRole('status')).toContainText(`Test email sent to ${ADMIN}.`);
	const mail = await waitForMail(page.request, ADMIN, 'test', before);
	expect(mail.subject).toBe('Test email (mcp-audit)');
	expect(mail.from).toBe('audit@example.test');
	expect(mail.text).toContain('this is the test email you asked for on Settings, Email');
	// The message names the instance by the address it is reached at.
	expect(mail.text).toContain(`Sent by mcp-audit at ${new URL(page.url()).origin}.`);

	const log = page.getByTestId('email-log').first();
	await expect(log).toContainText(`Test email to ${ADMIN}`);
	await expect(log).toContainText('Sent');
});

test('email settings are for admins only', async ({ page }) => {
	await loginAs(page, AUDITOR);
	await page.goto('/settings');
	await expect(
		page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Email' })
	).toHaveCount(0);
	const res = await page.goto('/settings/email');
	expect(res?.status()).toBe(403);
});
