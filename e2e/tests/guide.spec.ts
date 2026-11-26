import { ADMIN, AUDITOR, expect, loginAs, sampleCopy, seed, signIn, test, unique } from '../helpers';

/** #84: the guide, connecting an assistant, the first-time welcome and the standalone copy. */
test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('a new person is welcomed once: any choice dismisses it, and the guide can show it again', async ({
	page,
	browser
}) => {
	const email = `${unique('guide')}@example.test`;
	await loginAs(page, ADMIN);
	// Seeded people are not first-timers.
	await page.goto('/');
	await expect(page.getByTestId('welcome')).toHaveCount(0);
	await page.goto('/settings/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Name').fill('Gita Guide');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Add user' }).click();
	const temp = (await page.getByTestId('one-time-password').locator('.au-secret').textContent())!.trim();

	const other = await browser.newPage();
	await signIn(other, email, temp);
	await other.getByLabel('Current password').fill(temp);
	await other.getByLabel('New password', { exact: true }).fill('gita-own-password');
	await other.getByLabel('Repeat new password').fill('gita-own-password');
	await other.getByRole('button', { name: 'Change password' }).click();
	await expect(other).toHaveURL('/');

	const welcome = other.getByTestId('welcome');
	await expect(welcome).toContainText('Welcome to mcp-audit');
	await expect(welcome.getByRole('list', { name: 'The five steps' }).getByRole('listitem')).toHaveText([
		'1Set up',
		"2The auditee's own rules",
		'3Plan',
		'4Run',
		'5Conclude'
	]);
	await welcome.getByRole('button', { name: 'Open the guide' }).click();
	await expect(other).toHaveURL('/guide');
	await expect(other.getByRole('heading', { name: 'Guide', level: 1 })).toBeVisible();
	await other.goto('/');
	await expect(other.getByTestId('welcome')).toHaveCount(0);

	await other.goto('/guide');
	await other.getByRole('button', { name: 'Show the welcome again' }).click();
	await expect(other.getByRole('status')).toContainText('The welcome shows again');
	await other.goto('/');
	await other.getByTestId('welcome').getByRole('button', { name: 'Hide this welcome' }).click();
	await expect(other.getByTestId('welcome')).toHaveCount(0);
	await other.reload();
	await expect(other.getByTestId('welcome')).toHaveCount(0);
	await other.close();
});

test('the guide is an overview, a video and a page per step, with the engagement’s progress', async ({
	page
}) => {
	await loginAs(page, ADMIN);
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}`);
	await page.getByTestId('guide-link').click();
	await expect(page).toHaveURL(`/guide?e=${e.id}`);
	// The shell stays on the engagement, with Guide as the current place.
	await expect(page.getByTestId('engagement-switcher')).toContainText(e.name);
	await expect(page.locator('nav.au-rail').getByRole('link', { name: 'Guide' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByTestId('guide-progress')).toContainText(/: \d of 5 steps done/);
	await expect(page.getByRole('list', { name: 'Three rules' }).getByRole('listitem')).toHaveCount(3);

	// The video, served by the instance, with captions and chapters.
	const video = page.getByTestId('explainer-video');
	await expect(video.locator('video')).toHaveAttribute('src', '/media/explainer.mp4');
	await expect(video.locator('track[kind="captions"]')).toHaveAttribute('src', '/media/explainer.en.vtt');
	await expect(video.getByRole('list', { name: 'Chapters' }).getByRole('listitem')).toHaveCount(10);

	// Five tiles; exactly one is next, and Continue opens it.
	const tiles = page.locator('[data-testid^="guide-tile-"]');
	await expect(tiles).toHaveCount(5);
	await expect(page.locator('[data-testid^="guide-tile-"][data-state="current"]')).toHaveCount(1);
	const next = (await page
		.locator('[data-testid^="guide-tile-"][data-state="current"]')
		.getAttribute('data-testid'))!.replace('guide-tile-', '');
	await page.getByTestId('guide-continue').click();
	await expect(page).toHaveURL(`/guide/${next}?e=${e.id}`);
	await expect(page.getByTestId(`guide-step-${next}`)).toHaveAttribute('data-state', 'current');

	// Any step opens directly; the stepper and Previous/Next move along.
	await page.goto(`/guide/plan?e=${e.id}`);
	const plan = page.getByTestId('guide-step-plan');
	await expect(plan.getByRole('heading', { name: 'Plan' })).toBeVisible();
	await expect(plan).toContainText('Step 3 of 5');
	await expect(plan).toContainText('No AI can change the plan status.');
	await expect(plan.getByRole('list', { name: /^Progress in / })).toBeVisible();
	const stepper = page.getByTestId('guide-stepper');
	await expect(stepper.getByRole('link')).toHaveCount(5);
	await expect(stepper.getByRole('link', { name: /Plan/ })).toHaveAttribute('aria-current', 'step');
	// The step's own part of the video.
	await expect(plan.getByTestId('explainer-video')).toHaveAttribute('data-chapter', 'plan');
	await expect(plan.locator('video')).toHaveAttribute('src', '/media/explainer.mp4#t=102.2,117.2');
	await page.getByRole('link', { name: 'Next: 4. Run' }).click();
	await expect(page).toHaveURL(`/guide/run?e=${e.id}`);
	await page.getByRole('link', { name: 'Previous: 3. Plan' }).click();
	await page
		.getByTestId('guide-stepper')
		.getByRole('link', { name: /Conclude/ })
		.click();
	await expect(page).toHaveURL(`/guide/conclude?e=${e.id}`);
	expect((await page.goto('/guide/nonsense'))!.status()).toBe(404);

	// Without an engagement: the steps read the same, and a step asks which engagement to work in.
	await page.goto('/guide/plan');
	await expect(page.getByTestId('guide-choose')).toContainText('Choose the engagement to work in');
	await expect(page.getByTestId('guide-step-plan').getByRole('link', { name: /^Go:/ })).toHaveCount(0);
	await page.getByTestId('guide-choose').getByRole('link', { name: e.name }).click();
	await expect(page).toHaveURL(`/guide/plan?e=${e.id}`);
	await expect(page.getByTestId('guide-step-plan').getByRole('link', { name: /^Go:/ }).first()).toBeVisible();

	// Before you start: admin items link for an admin only.
	await page.goto('/guide');
	await expect(page.getByTestId('guide-start')).toHaveAttribute('href', '/guide/setup');
	await page.getByTestId('guide-prepare').locator('summary').click();
	await expect(
		page.getByTestId('guide-prepare').getByRole('link', { name: 'Settings, Users' })
	).toBeVisible();
	await loginAs(page, AUDITOR);
	await page.goto('/guide');
	await page.getByTestId('guide-prepare').locator('summary').click();
	await expect(page.getByTestId('guide-prepare')).toContainText('Add your colleagues');
	await expect(page.getByTestId('guide-prepare').getByRole('link', { name: 'Settings, Users' })).toHaveCount(
		0
	);
	await expect(page.getByTestId('guide-prepare').getByRole('link', { name: 'Library' })).toBeVisible();
});

test('Go from a step opens its screen with the guide bar, which stays until it is closed', async ({
	page
}) => {
	await loginAs(page, ADMIN);
	const e = await sampleCopy(page.request);
	await page.goto(`/guide/plan?e=${e.id}`);
	const actions = page.getByTestId('guide-action');
	await expect(actions).toHaveCount(4);
	await actions.nth(2).getByRole('link', { name: 'Go: Plan, Coverage' }).click();
	await expect(page).toHaveURL(`/e/${e.id}/plan/coverage?guide=plan`);

	const bar = page.getByTestId('guide-bar');
	await expect(bar).toHaveAttribute('data-step', 'plan');
	await expect(bar).toContainText('Guide · Step 3 of 5');
	await expect(bar.getByTestId('guide-bar-hint')).toContainText('make sure every requirement is in an event');
	// The next action is on another screen.
	await bar.getByTestId('guide-bar-next').click();
	await expect(page).toHaveURL(`/e/${e.id}/plan/document`);
	await expect(page.getByTestId('guide-bar').getByTestId('guide-bar-hint')).toContainText(
		'Export the audit plan'
	);

	// It stays on the engagement's other screens, and after a reload, with what belongs there.
	await page.goto(`/e/${e.id}/plan/events`);
	await expect(page.getByTestId('guide-bar-hint')).toContainText('Enter the planning inputs first');
	await page.goto(`/e/${e.id}/findings/matrix`);
	await expect(page.getByTestId('guide-bar-hint')).toContainText("This step's work is on Plan, Events");
	await page.reload();
	await expect(page.getByTestId('guide-bar')).toBeVisible();

	// Back to the guide, at the step.
	await page.getByTestId('guide-bar').getByRole('link', { name: 'Back to the guide' }).click();
	await expect(page).toHaveURL(`/guide/plan?e=${e.id}`);

	// Another engagement has no bar: it belongs to the one it was started in.
	const other = await sampleCopy(page.request);
	await page.goto(`/e/${other.id}/plan/coverage`);
	await expect(page.getByTestId('guide-bar')).toHaveCount(0);

	// Another step's Go switches it; Close removes it, and it stays away.
	await page.goto(`/guide/run?e=${e.id}`);
	await page.getByRole('link', { name: 'Go: Run, Today' }).click();
	await expect(page.getByTestId('guide-bar')).toHaveAttribute('data-step', 'run');
	await page.getByTestId('guide-bar').getByRole('button', { name: 'Close the guide bar' }).click();
	await expect(page.getByTestId('guide-bar')).toHaveCount(0);
	await expect(page).toHaveURL(`/e/${e.id}/run/today`);
	await page.goto(`/e/${e.id}/run/inbox`);
	await expect(page.getByTestId('guide-bar')).toHaveCount(0);
});

test('the explainer video and its captions are served by the instance, to anyone', async ({
	playwright,
	baseURL
}) => {
	const anonymous = await playwright.request.newContext({ baseURL });
	const video = await anonymous.get('/media/explainer.mp4', { headers: { range: 'bytes=0-1023' } });
	// Seeking needs ranges.
	expect(video.status()).toBe(206);
	expect(video.headers()['content-type']).toBe('video/mp4');
	expect((await video.body()).length).toBe(1024);
	const captions = await anonymous.get('/media/explainer.en.vtt');
	expect(captions.ok()).toBe(true);
	expect(await captions.text()).toMatch(/^WEBVTT/);
	expect((await anonymous.get('/media/explainer-poster.jpg')).ok()).toBe(true);
	await anonymous.dispose();
});

test('Connect your AI: this instance’s address, one assistant at a time, ChatGPT marked as not verified', async ({
	page,
	baseURL,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await loginAs(page, ADMIN);
	await page.goto('/guide');
	await page
		.getByRole('navigation', { name: 'Guide' })
		.getByRole('link', { name: 'Connect your AI' })
		.click();
	await expect(page).toHaveURL('/guide/connect');
	const mcp = `${new URL(baseURL!).origin}/mcp`;
	const address = page.getByTestId('mcp-address');
	await expect(address).toContainText(mcp);
	await address.getByRole('button', { name: 'Copy MCP address' }).click();
	await expect(address.getByRole('button', { name: 'Copy MCP address' })).toHaveText('Copied');
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mcp);

	// The test server is plain http: connectors cannot reach it, so a token client comes first.
	await expect(page.getByTestId('not-public')).toContainText('need a public https address');
	const code = page.getByTestId('client-claude-code');
	await expect(code).toContainText(`claude mcp add --transport http mcp-audit ${mcp}`);
	await expect(code.getByRole('link', { name: 'Open Settings, Access tokens' })).toBeVisible();

	const tabs = page.getByRole('tablist', { name: 'Assistant' });
	await expect(tabs.getByRole('tab')).toHaveText([
		'Claude',
		'ChatGPT',
		'Claude Code',
		'Claude Desktop, private network'
	]);
	await tabs.getByRole('tab', { name: 'ChatGPT' }).click();
	const chatgpt = page.getByTestId('client-chatgpt');
	await expect(chatgpt.getByTestId('unverified')).toContainText('Not yet verified with ChatGPT');
	await expect(chatgpt).toContainText('Add custom MCP server');
	await expect(chatgpt).toContainText(mcp);
	await expect(page.getByTestId('client-claude-code')).toHaveCount(0);

	await tabs.getByRole('tab', { name: 'Claude', exact: true }).click();
	await expect(page.getByTestId('client-claude')).toContainText('Add custom connector');
	await expect(page.getByTestId('client-claude').getByTestId('unverified')).toHaveCount(0);
	await tabs.getByRole('tab', { name: 'Claude Desktop, private network' }).click();
	await expect(page.getByTestId('client-claude-desktop')).toContainText('"--allow-http"');

	await expect(page.getByRole('heading', { name: 'After connecting' })).toBeVisible();
	await expect(page.getByText('What it can never do')).toBeVisible();
});

test('Download guide: one self-contained page with this instance’s address, which works on its own', async ({
	page,
	baseURL,
	playwright
}) => {
	await loginAs(page, ADMIN);
	await page.goto('/guide');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('guide-download').click()
	]);
	expect(download.suggestedFilename()).toBe('mcp-audit-guide.html');
	const res = await page.request.get('/guide/download');
	expect(res.headers()['content-type']).toContain('text/html');
	const html = await res.text();
	const mcp = `${new URL(baseURL!).origin}/mcp`;
	expect(html).toContain('<title>mcp-audit Guide</title>');
	expect(html).toContain(`value="${mcp}"`);

	// Not for someone who is not signed in.
	const anonymous = await playwright.request.newContext({ baseURL });
	const denied = await anonymous.get('/guide/download', { maxRedirects: 0 });
	expect(denied.status()).not.toBe(200);
	await anonymous.dispose();

	// The file works with no server behind it.
	await page.goto('about:blank');
	await page.setContent(html);
	const panels = page.locator('[data-step]');
	await expect(panels).toHaveCount(5);
	await expect(page.locator('[data-step]:visible')).toHaveCount(1);
	await page.getByRole('tab', { name: 'Step 3: Plan' }).click();
	const plan = page.locator('#step-plan');
	await expect(plan).toBeVisible();
	await expect(page.locator('#step-setup')).toBeHidden();
	await plan.getByLabel('I have done this step').check();
	await expect(page.getByRole('tab', { name: 'Step 3: Plan' })).toHaveClass(/done/);
	await plan.getByRole('button', { name: 'Next step' }).click();
	await expect(page.locator('#step-run')).toBeVisible();

	// The instructions follow the address the reader enters.
	await expect(page.locator('#mcp-note')).toBeVisible();
	await page.getByLabel('Your mcp-audit MCP address').fill('https://audit.example.com/mcp');
	await expect(page.locator('#mcp-note')).toBeHidden();
	await page.getByRole('tab', { name: 'ChatGPT' }).click();
	await expect(page.locator('#client-chatgpt')).toContainText('https://audit.example.com/mcp');
	await expect(page.locator('#client-chatgpt')).toContainText('Not yet verified with ChatGPT');
	await page.getByRole('tab', { name: 'Claude Desktop, private network' }).click();
	await expect(page.locator('#client-claude-desktop')).not.toContainText('--allow-http');
});
