import { expect, joinLink, loginAs, mailTo, test, virtualAuthenticator } from '../helpers';
import { OPERATOR_TOKEN, PROFILE_ADMIN, PROFILE_INSTANCE, PROFILE_OPERATOR } from '../tenant-profile.mjs';

/**
 * #91: an instance started with TENANT_PROFILE and nothing else about itself in its settings. By the
 * time its first person arrives it has its name, its library, its AI and its sign-in method.
 */
test('an instance set up from a profile is ready when its first admin joins', async ({
	page,
	context,
	baseURL
}) => {
	// The invitation went out when the instance started. Nobody typed a set-up code.
	const invitations = (await mailTo(page.request, PROFILE_ADMIN.email)).filter(
		(m) => m.kind === 'invitation'
	);
	const mail = invitations.at(-1)!;
	expect(mail.subject).toBe(`Your instance is ready (${PROFILE_INSTANCE})`);
	expect(mail.text).toContain(`${PROFILE_INSTANCE} was set up with you as its first admin`);
	// The invitation is also the welcome (#100): what the app is, what is set up, the guide, who runs it.
	expect(mail.text).toContain('mcp-audit is an app for planning and running audits');
	expect(mail.text).toContain(`${PROFILE_INSTANCE} is your own instance, at ${new URL(baseURL!).origin}`);
	expect(mail.text).toContain('the AI buttons are ready to use, within a budget');
	expect(mail.text).toContain(`${new URL(baseURL!).origin}/welcome/guide`);
	expect(mail.text).toContain(
		`go to ${PROFILE_OPERATOR.name} (${PROFILE_OPERATOR.contact}), who runs it for you`
	);

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

/**
 * #98: whoever runs the instance asks it for its numbers with the instance's operator token. No
 * person's sign-in gives them, and they hold counts and dates only.
 */
test('the operator endpoint gives numbers to the operator token only, and no content', async ({
	page,
	playwright,
	baseURL
}) => {
	const anonymous = await playwright.request.newContext({ baseURL });
	const url = '/api/operator/status';
	const missing = await anonymous.get(url);
	expect(missing.status()).toBe(401);
	expect(await missing.json()).toEqual({
		message: 'The operator token is missing or wrong.',
		code: 'unauthenticated'
	});
	expect((await anonymous.get(url, { headers: { authorization: 'Bearer wrong-token' } })).status()).toBe(401);

	// A signed-in admin of the instance is not the operator: their session opens nothing here.
	await loginAs(page, PROFILE_ADMIN.email);
	expect((await page.request.get(url)).status()).toBe(401);

	const res = await anonymous.get(url, { headers: { authorization: `Bearer ${OPERATOR_TOKEN}` } });
	expect(res.status()).toBe(200);
	expect(res.headers()['cache-control']).toBe('no-store');
	const body = (await res.json()) as Record<string, unknown>;
	expect(Object.keys(body).sort()).toEqual([
		'database_bytes',
		'engagements',
		'files_bytes',
		'invited',
		'last_activity',
		'last_sign_in',
		'users',
		'version'
	]);
	expect(body.users).toBeGreaterThanOrEqual(1);
	// The admin signed in a moment ago: the time is there, the person is not.
	expect(String(body.last_sign_in)).toMatch(/^\d{4}-\d\d-\d\dT/);
	const text = JSON.stringify(body);
	expect(text).not.toContain(PROFILE_ADMIN.name);
	expect(text).not.toContain(PROFILE_ADMIN.email);
	expect(text).not.toContain(PROFILE_INSTANCE);
	await anonymous.dispose();
});

/**
 * #100: the guide the welcome links to. Anyone with the link can read it, before joining; it has
 * this instance's own MCP address in it, and it works as a page: its tabs are its own script.
 */
test('the guide with the instance’s own MCP address is a public page that works', async ({
	browser,
	baseURL
}) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	const blocked: string[] = [];
	page.on('console', (m) => {
		if (/Content Security Policy/i.test(m.text())) blocked.push(m.text());
	});
	const opened = await page.goto(`${baseURL}/welcome/guide`);
	expect(opened!.status()).toBe(200);
	expect(new URL(page.url()).pathname).toBe('/welcome/guide');
	const policy = opened!.headers()['content-security-policy']!;
	expect(policy).toContain("default-src 'none'");
	expect(policy).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
	await expect(page).toHaveTitle(`${PROFILE_INSTANCE} Guide`);
	await expect(page.getByRole('heading', { name: 'Run an audit in five steps' })).toBeVisible();
	await expect(page.getByLabel('Your mcp-audit MCP address')).toHaveValue(`${new URL(baseURL!).origin}/mcp`);
	// Its own script runs under that policy: choosing a step shows that step.
	const tabs = page.getByRole('tablist', { name: 'Steps' }).getByRole('tab');
	await tabs.nth(2).click();
	await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
	await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
	expect(blocked).toEqual([]);
	// Nothing of the instance but its name and address: no people, no engagements.
	const html = await page.content();
	expect(html).not.toContain(PROFILE_ADMIN.email);
	expect(html).not.toContain(PROFILE_ADMIN.name);
	// The rest of the instance still needs a sign-in.
	await page.goto(`${baseURL}/guide`);
	await expect(page).toHaveURL(/\/login/);
	await context.close();
});
